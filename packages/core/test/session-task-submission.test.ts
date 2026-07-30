import { describe, expect, test } from "bun:test"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Layer, Result } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Prompt } from "@opencode-ai/core/session/prompt"
import {
  SessionInputTable,
  SessionTable,
  TaskNotificationOutboxTable,
  TaskSubmissionTable,
} from "@opencode-ai/core/session/sql"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node, TaskSubmission.node])),
)

const invocation = {
  parentSessionID: SessionSchema.ID.make("ses_task_parent"),
  assistantMessageID: SessionMessage.ID.make("msg_task_assistant"),
  toolCallID: "call_task_1",
  prompt: Prompt.make({ text: "inspect the lifecycle" }),
}

const childSessionID = SessionSchema.ID.make("ses_task_child")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: invocation.parentSessionID,
        project_id: Project.ID.global,
        slug: "task-parent",
        directory: "/project",
        title: "task parent",
        version: "test",
      },
      {
        id: childSessionID,
        project_id: Project.ID.global,
        parent_id: invocation.parentSessionID,
        slug: "task-child",
        directory: "/project",
        title: "task child",
        version: "test",
      },
    ])
    .run()
    .pipe(Effect.orDie)
})

const taskSubmissionLayer = (database: Database.Interface) =>
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node, TaskSubmission.node]), [
    [Database.node, Layer.succeed(Database.Service, database)],
  ])

const withStepTimeout = <A>(effect: Effect.Effect<A, unknown>, steps: string[], label: string) =>
  effect.pipe(
    Effect.timeout("5 seconds"),
    Effect.catch((error) =>
      Effect.die(
        new Error(
          `${label} timed out after steps: ${steps.join(" -> ")} (${typeof error === "object" && error && "_tag" in error ? String(error._tag) : String(error)})`,
        ),
      ),
    ),
  )

const runConcurrentFirstSubmitRace = Effect.fn("TaskSubmissionTest.runConcurrentFirstSubmitRace")(function* (
  input: readonly [TaskSubmission.Invocation, TaskSubmission.Invocation],
) {
  const firstEntered = yield* Deferred.make<void>()
  const secondEntered = yield* Deferred.make<void>()
  const releaseFirst = yield* Deferred.make<void>()
  const releaseSecond = yield* Deferred.make<void>()
  let invocationFindCount = 0
  const run = Effect.gen(function* () {
    const baseDatabase = yield* Database.Service
    const wrapFrom = <
      T extends {
        where: (...args: never[]) => unknown
        get: () => unknown
      },
    >(
      builder: T,
      taskSubmissionFind = false,
    ) => {
      const wrapped = Object.create(builder) as T & {
        where: T["where"]
        get: T["get"]
      }
      wrapped.where = ((...args: Parameters<T["where"]>) =>
        wrapFrom(builder.where(...args) as T, taskSubmissionFind)) as T["where"]
      wrapped.get = (() => {
        if (!taskSubmissionFind) return builder.get()
        invocationFindCount += 1
        if (invocationFindCount === 1)
          return Effect.gen(function* () {
            yield* Deferred.succeed(firstEntered, undefined).pipe(Effect.ignore)
            yield* Deferred.await(releaseFirst)
            return undefined
          })
        if (invocationFindCount === 2)
          return Effect.gen(function* () {
            yield* Deferred.succeed(secondEntered, undefined).pipe(Effect.ignore)
            yield* Deferred.await(releaseSecond)
            return undefined
          })
        return builder.get()
      }) as T["get"]
      return wrapped
    }
    const wrapSelect = (builder: ReturnType<typeof baseDatabase.db.select>) => {
      const wrapped = Object.create(builder) as typeof builder & {
        from: typeof builder.from
      }
      wrapped.from = ((table: Parameters<typeof builder.from>[0]) =>
        wrapFrom(builder.from(table), table === TaskSubmissionTable)) as typeof builder.from
      return wrapped
    }
    const database = {
      db: Object.assign(Object.create(baseDatabase.db), {
        select: (...args: Parameters<typeof baseDatabase.db.select>) => wrapSelect(baseDatabase.db.select(...args)),
      }),
    } satisfies Database.Interface
    yield* setup.pipe(Effect.provide(taskSubmissionLayer(database)))
    const submit = (invocation: TaskSubmission.Invocation) =>
      TaskSubmission.Service.pipe(
        Effect.flatMap((submissions) => submissions.submit(invocation)),
        Effect.provide(taskSubmissionLayer(database)),
      )
    const first = yield* submit(input[0]).pipe(Effect.exit, Effect.forkChild)
    const second = yield* submit(input[1]).pipe(Effect.exit, Effect.forkChild)
    yield* withStepTimeout(Deferred.await(firstEntered), ["await-first-entered"], "await first entered")
    yield* withStepTimeout(
      Deferred.await(secondEntered),
      ["await-first-entered", "await-second-entered"],
      "await second entered",
    )
    yield* Deferred.succeed(releaseFirst, undefined)
    const winner = yield* Effect.raceFirst(
      Fiber.await(first).pipe(Effect.as("first")),
      Fiber.await(second).pipe(Effect.as("second")),
    ).pipe(Effect.timeout("5 seconds"), Effect.exit)
    if (Exit.isFailure(winner)) {
      const firstExit = yield* Fiber.join(first).pipe(Effect.timeout("1 second"), Effect.exit)
      const secondExit = yield* Fiber.join(second).pipe(Effect.timeout("1 second"), Effect.exit)
      return yield* Effect.die(
        new Error(
          `await winner timed out; first=${JSON.stringify(firstExit)} second=${JSON.stringify(secondExit)}`,
        ),
      )
    }
    yield* Deferred.succeed(releaseSecond, undefined)
    const firstResult = yield* withStepTimeout(
      Fiber.join(first),
      ["await-first-entered", "await-second-entered", "release-first", "await-winner", "release-second", "join-first"],
      "join first",
    )
    const secondResult = yield* withStepTimeout(
      Fiber.join(second),
      [
        "await-first-entered",
        "await-second-entered",
        "release-first",
        "await-winner",
        "release-second",
        "join-first",
        "join-second",
      ],
      "join second",
    )
    return { first: firstResult, second: secondResult }
  })
  return yield* run.pipe(Effect.provide(AppNodeBuilder.build(Database.node)))
})

describe("TaskSubmission", () => {
  test("derives stable IDs from the invocation identity", () => {
    expect(TaskSubmission.inputID(invocation)).toBe(TaskSubmission.inputID({ ...invocation }))
    expect(TaskSubmission.notificationID("sub_task_1")).toBe(TaskSubmission.notificationID("sub_task_1"))
    expect(TaskSubmission.inputID(invocation)).toMatch(/^msg_/)
    expect(TaskSubmission.notificationID("sub_task_1")).toMatch(/^msg_/)
  })

  test("changes the child input identity when the tool call changes", () => {
    expect(TaskSubmission.inputID(invocation)).not.toBe(
      TaskSubmission.inputID({ ...invocation, toolCallID: "call_task_2" }),
    )
  })

  it.effect("adopts exact retries and terminalizes the child input once", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service
      const first = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Inspect lifecycle",
        agent: "general",
      })
      const retry = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Inspect lifecycle",
        agent: "general",
      })

      expect(retry).toEqual(first)
      const terminal = yield* submissions.terminalize({
        submissionID: first.id,
        outcome: "completed",
        resultMessageID: SessionMessage.ID.make("msg_task_result"),
        resultText: "done",
      })
      const duplicate = yield* submissions.terminalize({
        submissionID: first.id,
        outcome: "error",
        error: { message: "late failure" },
      })

      expect(terminal).toMatchObject({ status: "completed", resultText: "done" })
      expect(duplicate).toEqual(terminal)
      const inputRow = (yield* db.select().from(SessionInputTable).all())[0]
      expect(inputRow).toMatchObject({
        terminal_outcome: "completed",
        terminal_message_id: "msg_task_result",
        terminal_error: null,
      })
      expect(typeof inputRow?.terminal_seq).toBe("number")
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
    }),
  )

  it.effect("coalesces concurrent first submissions for one invocation", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service
      const input = {
        ...invocation,
        childSessionID,
        description: "Inspect lifecycle",
        agent: "general",
      }

      const results = yield* Effect.all([submissions.submit(input), submissions.submit(input)], {
        concurrency: "unbounded",
      })

      expect(results[0]).toEqual(results[1])
      expect(yield* db.select().from(TaskSubmissionTable).all()).toHaveLength(1)
      expect(yield* db.select().from(SessionInputTable).all()).toHaveLength(1)
    }),
  )

  it.effect("rejects a conflicting retry for the same invocation identity", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const input = {
        ...invocation,
        childSessionID,
        description: "Inspect lifecycle",
        agent: "general",
      }
      yield* submissions.submit(input)

      const conflict = yield* submissions
        .submit({
          ...input,
          description: "Different lifecycle",
        })
        .pipe(Effect.catchTag("TaskSubmission.InvocationConflict", (error) => Effect.succeed(error)))

      expect(conflict).toBeInstanceOf(TaskSubmission.InvocationConflict)
    }),
  )

  it.effect("adopts equivalent serialized model selection and rejects a different model for the same invocation", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") })
      const first = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Inspect lifecycle",
        agent: "general",
        model,
      })

      const retry = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Inspect lifecycle",
        agent: "general",
        model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
      })
      expect(retry).toEqual(first)

      const conflict = yield* submissions
        .submit({
          ...invocation,
          childSessionID,
          description: "Inspect lifecycle",
          agent: "general",
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("other"), providerID: ProviderV2.ID.make("test") }),
        })
        .pipe(Effect.catchTag("TaskSubmission.InvocationConflict", (error) => Effect.succeed(error)))

      expect(conflict).toBeInstanceOf(TaskSubmission.InvocationConflict)
    }),
  )

  test("adopts equivalent serialized model selection during a concurrent first-submit race", async () => {
    const equivalent = await Effect.runPromise(
      runConcurrentFirstSubmitRace([
        {
          ...invocation,
          assistantMessageID: SessionMessage.ID.make("msg_task_equivalent_first"),
          toolCallID: "call_task_equivalent_first",
          childSessionID,
          description: "Inspect lifecycle",
          agent: "general",
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
        },
        {
          ...invocation,
          assistantMessageID: SessionMessage.ID.make("msg_task_equivalent_first"),
          toolCallID: "call_task_equivalent_first",
          childSessionID,
          description: "Inspect lifecycle",
          agent: "general",
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
        },
      ]).pipe(Effect.scoped),
    )

    expect(Exit.isSuccess(equivalent.first)).toBe(true)
    expect(Exit.isSuccess(equivalent.second)).toBe(true)
    if (Exit.isSuccess(equivalent.first) && Exit.isSuccess(equivalent.second))
      expect(equivalent.second.value).toMatchObject({
        id: equivalent.first.value.id,
        childInputID: equivalent.first.value.childInputID,
        childSessionID: equivalent.first.value.childSessionID,
        model: equivalent.first.value.model,
        toolCallID: equivalent.first.value.toolCallID,
      })
  })

  test("rejects a different model during a concurrent first-submit race after admission", async () => {
    const conflict = await Effect.runPromise(
      runConcurrentFirstSubmitRace([
        {
          ...invocation,
          assistantMessageID: SessionMessage.ID.make("msg_task_conflict_first"),
          toolCallID: "call_task_conflict_first",
          childSessionID,
          description: "Inspect lifecycle",
          agent: "general",
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
        },
        {
          ...invocation,
          assistantMessageID: SessionMessage.ID.make("msg_task_conflict_first"),
          toolCallID: "call_task_conflict_first",
          childSessionID,
          description: "Inspect lifecycle",
          agent: "general",
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("other"), providerID: ProviderV2.ID.make("test") }),
        },
      ]).pipe(Effect.scoped),
    )

    expect(Exit.isFailure(conflict.second)).toBe(true)
    if (Exit.isFailure(conflict.second)) {
      const failure = Cause.findError(conflict.second.cause)
      expect(Result.isSuccess(failure)).toBe(true)
      if (Result.isSuccess(failure)) expect(failure.success).toBeInstanceOf(TaskSubmission.InvocationConflict)
    }
  })

  it.effect("claims an accepted input at most once", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const submitted = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Claim once",
        agent: "general",
      })

      const first = yield* submissions.claim(submitted.id)
      const second = yield* submissions.claim(submitted.id)

      expect(first.acquired).toBe(true)
      expect(first.info.status).toBe("running")
      expect(second.acquired).toBe(false)
      expect(second.info).toEqual(first.info)
    }),
  )

  it.effect("recovers a completed assistant for the exact child input after a restart", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service
      const submitted = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Recover task",
        agent: "general",
      })
      yield* submissions.claim(submitted.id)
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_task_recovered_result"),
        type: "assistant",
        agent: "general",
        model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
        content: [{ type: "text", id: "text_recovered", text: "recovered result" }],
        time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
      })

      expect(
        yield* submissions.recoverSession({
          sessionID: childSessionID,
          assistantMessageID: assistant.id,
          messages: [assistant],
        }),
      ).toBe(0)
      const recoveredMessages = [
        SessionMessage.User.make({
          id: submitted.childInputID,
          type: "user",
          text: invocation.prompt.text,
          time: { created: DateTime.makeUnsafe(1) },
        }),
        assistant,
      ]
      expect(
        yield* submissions.recoverSession({
          sessionID: childSessionID,
          assistantMessageID: assistant.id,
          messages: recoveredMessages,
        }),
      ).toBe(1)
      expect(yield* submissions.get(submitted.id)).toMatchObject({
        outcome: "completed",
        resultText: "recovered result",
      })
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
    }),
  )

  it.effect("binds recovery results to the exact child input instead of the latest completed assistant", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const first = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_task_first",
        childSessionID,
        description: "Inspect first lifecycle",
        prompt: Prompt.make({ text: "first prompt" }),
        agent: "general",
      })
      const second = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_task_second",
        childSessionID,
        description: "Inspect second lifecycle",
        prompt: Prompt.make({ text: "second prompt" }),
        agent: "general",
      })
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_task_second_result"),
        type: "assistant",
        agent: "general",
        model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
        content: [{ type: "text", id: "text_second_result", text: "second result" }],
        time: { created: DateTime.makeUnsafe(3), completed: DateTime.makeUnsafe(4) },
      })

      expect(
        yield* submissions.recoverSession({
          sessionID: childSessionID,
          assistantMessageID: assistant.id,
          messages: [
            SessionMessage.User.make({
              id: first.childInputID,
              type: "user",
              text: "first prompt",
              time: { created: DateTime.makeUnsafe(1) },
            }),
            SessionMessage.User.make({
              id: second.childInputID,
              type: "user",
              text: "second prompt",
              time: { created: DateTime.makeUnsafe(2) },
            }),
            assistant,
          ],
        }),
      ).toBe(1)
      expect(yield* submissions.get(first.id)).toMatchObject({
        status: "accepted",
      })
      expect(yield* submissions.get(second.id)).toMatchObject({
        outcome: "completed",
        resultText: "second result",
      })
    }),
  )

  it.effect("terminalizes an ambiguous provider attempt as recovery-required", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service
      const submitted = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Recover ambiguous task",
        agent: "general",
      })
      yield* submissions.claim(submitted.id)

      expect(
        yield* submissions.markRecoveryRequired({
          sessionID: childSessionID,
          childInputID: submitted.childInputID,
          reason: "response-interrupted",
        }),
      ).toBe(1)
      expect(yield* submissions.get(submitted.id)).toMatchObject({
        status: "recovery-required",
        outcome: "recovery-required",
      })
      expect(yield* db.select().from(SessionInputTable).all()).toMatchObject([
        { terminal_outcome: "recovery-required" },
      ])
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
    }),
  )

  it.effect("marks only the matching child input as recovery-required", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const first = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Recover interrupted task",
        agent: "general",
      })
      const second = yield* submissions.submit({
        ...invocation,
        childSessionID,
        toolCallID: "call_task_followup",
        assistantMessageID: SessionMessage.ID.make("msg_task_followup_assistant"),
        prompt: Prompt.make({ text: "follow up prompt" }),
        description: "Follow up task",
        agent: "general",
      })

      expect(
        yield* submissions.markRecoveryRequired({
          sessionID: childSessionID,
          childInputID: first.childInputID,
          reason: "response-interrupted",
        }),
      ).toBe(1)
      expect(yield* submissions.get(first.id)).toMatchObject({
        outcome: "recovery-required",
      })
      expect(yield* submissions.get(second.id)).toMatchObject({
        status: "accepted",
      })
    }),
  )
})
