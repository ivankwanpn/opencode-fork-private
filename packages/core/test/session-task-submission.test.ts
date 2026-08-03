import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Result } from "effect"
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
  completionDelivery: "parent" as const,
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

const runConcurrentPostAdmissionRace = Effect.fn("TaskSubmissionTest.runConcurrentPostAdmissionRace")(function* (
  input: readonly [TaskSubmission.Invocation, TaskSubmission.Invocation],
) {
  const { db } = yield* Database.Service
  const initialFirstReached = yield* Deferred.make<void>()
  const initialSecondReached = yield* Deferred.make<void>()
  const releaseInitial = yield* Deferred.make<void>()
  const thirdLookupReached = yield* Deferred.make<void>()
  const releaseThirdLookup = yield* Deferred.make<void>()
  let invocationFindCount = 0

  const wrapPostFrom = <
    TWhere extends (...args: never[]) => unknown,
    TGet extends Effect.Effect<unknown, unknown, never>,
    T extends { where: TWhere; get: () => TGet },
  >(
    builder: T,
    taskSubmissionFind = false,
  ): T => {
    const wrapped = Object.create(builder) as T & {
      where: TWhere
      get: () => TGet
    }
    wrapped.where = ((...args: Parameters<TWhere>) =>
      wrapPostFrom(builder.where(...args) as T, taskSubmissionFind)) as TWhere
    wrapped.get = (() => {
      if (!taskSubmissionFind) return builder.get()
      invocationFindCount += 1
      if (invocationFindCount === 1)
        return Effect.gen(function* () {
          yield* Deferred.succeed(initialFirstReached, undefined).pipe(Effect.ignore)
          yield* Deferred.await(releaseInitial)
          return undefined
        })
      if (invocationFindCount === 2)
        return Effect.gen(function* () {
          yield* Deferred.succeed(initialSecondReached, undefined).pipe(Effect.ignore)
          yield* Deferred.await(releaseInitial)
          return undefined
        })
      if (invocationFindCount === 3)
        return Effect.gen(function* () {
          yield* Deferred.succeed(thirdLookupReached, undefined).pipe(Effect.ignore)
          yield* Deferred.await(releaseThirdLookup)
          return yield* builder.get()
        })
      return builder.get()
    }) as () => TGet
    return wrapped
  }

  const wrapSelect = <T extends ReturnType<typeof db.select>>(builder: T): T => {
    const wrapped = Object.create(builder) as typeof builder & {
      from: typeof builder.from
    }
    const wrappedFrom = ((table: Parameters<typeof builder.from>[0]) =>
      wrapPostFrom(builder.from(table), table === TaskSubmissionTable)) as typeof builder.from
    wrapped.from = wrappedFrom
    return wrapped
  }

  const originalSelect = db.select.bind(db)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      db.select = originalSelect
    }),
  )
  db.select = ((...args: Parameters<typeof db.select>) => wrapSelect(originalSelect(...args))) as typeof db.select

  const submissions = yield* TaskSubmission.Service
  const first = yield* submissions.submit(input[0]).pipe(Effect.exit, Effect.forkChild)
  const second = yield* submissions.submit(input[1]).pipe(Effect.exit, Effect.forkChild)
  yield* Deferred.await(initialSecondReached).pipe(
    Effect.timeout("5 seconds"),
    Effect.catch(() => Effect.die(new Error("concurrent submit initial lookup timed out"))),
  )
  yield* Deferred.succeed(releaseInitial, undefined)
  yield* Deferred.await(thirdLookupReached).pipe(
    Effect.timeout("5 seconds"),
    Effect.catch(() => Effect.die(new Error("concurrent submit post-admission lookup timed out"))),
  )
  yield* Deferred.succeed(releaseThirdLookup, undefined)

  return {
    first: yield* Fiber.join(first).pipe(Effect.timeout("5 seconds")),
    second: yield* Fiber.join(second).pipe(Effect.timeout("5 seconds")),
  }
})

describe("TaskSubmission", () => {
  test("derives IDs in a Node runtime without Bun globals", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-task-submission-node-"))
    try {
      const build = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "../src/session/task-submission.ts")],
        format: "esm",
        target: "node",
      })
      expect(build.success).toBe(true)
      const bundle = path.join(directory, "task-submission.mjs")
      await Bun.write(bundle, build.outputs[0]!)
      const runtime = path.join(directory, "runtime")
      const result = Bun.spawnSync(
        [
          "node",
          "--input-type=module",
          "-e",
          `import { TaskSubmission } from ${JSON.stringify(pathToFileURL(bundle).href)}; process.stdout.write(TaskSubmission.inputID(${JSON.stringify(invocation)}))`,
        ],
        {
          env: {
            ...process.env,
            XDG_DATA_HOME: path.join(runtime, "data"),
            XDG_CACHE_HOME: path.join(runtime, "cache"),
            XDG_CONFIG_HOME: path.join(runtime, "config"),
            XDG_STATE_HOME: path.join(runtime, "state"),
            OPENCODE_TEST_HOME: runtime,
          },
        },
      )

      expect(result.stderr.toString()).toBe("")
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toMatch(/^msg_task_[a-f0-9]{32}$/)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

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

  it.effect("persists and recovers an agent path on the submission", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const info = yield* submissions.submit({
        ...invocation,
        childSessionID,
        description: "Agent path task",
        agent: "general",
        agentPath: "/root/researcher",
      })
      const recovered = yield* submissions.get(info.id)
      expect(recovered).toMatchObject({ agentPath: "/root/researcher", completionDelivery: "parent" })
    }),
  )

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

      expect(first.completionDelivery).toBe("parent")
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

      expect(terminal).toMatchObject({ status: "completed", resultText: "done", completionDelivery: "parent" })
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

  it.effect("rejects a retry that changes completion delivery ownership", () =>
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
        .submit({ ...input, completionDelivery: "tool" })
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

  it.live("adopts equivalent serialized model selection during a concurrent first-submit race", () =>
    Effect.gen(function* () {
      yield* setup
      const equivalent = yield* runConcurrentPostAdmissionRace([
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
      ])

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
    }),
  )

  it.live("rejects a different model during a concurrent first-submit race after admission", () =>
    Effect.gen(function* () {
      yield* setup
      const conflict = yield* runConcurrentPostAdmissionRace([
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
      ])

      expect(Exit.isFailure(conflict.second)).toBe(true)
      if (Exit.isFailure(conflict.second)) {
        const failure = Cause.findError(conflict.second.cause)
        expect(Result.isSuccess(failure)).toBe(true)
        if (Result.isSuccess(failure)) expect(failure.success).toBeInstanceOf(TaskSubmission.InvocationConflict)
      }
    }),
  )

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
      expect(first.info.completionDelivery).toBe("parent")
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
          childInputID: submitted.childInputID,
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
          childInputID: submitted.childInputID,
          messages: recoveredMessages,
        }),
      ).toBe(1)
      expect(yield* submissions.get(submitted.id)).toMatchObject({
        outcome: "completed",
        resultText: "recovered result",
        completionDelivery: "parent",
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
          childInputID: second.childInputID,
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

  it.effect("recovers the assistant bound to the provider attempt input", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const first = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_task_attempt_first",
        childSessionID,
        description: "First provider attempt",
        prompt: Prompt.make({ text: "first provider attempt" }),
        agent: "general",
      })
      const second = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_task_attempt_second",
        assistantMessageID: SessionMessage.ID.make("msg_task_attempt_second_assistant"),
        childSessionID,
        description: "Second provider attempt",
        prompt: Prompt.make({ text: "second provider attempt" }),
        agent: "general",
      })
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_task_attempt_first_result"),
        type: "assistant",
        agent: "general",
        model: ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") }),
        content: [{ type: "text", id: "text_attempt_first_result", text: "first result" }],
        time: { created: DateTime.makeUnsafe(3), completed: DateTime.makeUnsafe(4) },
      })

      const recovery = {
        sessionID: childSessionID,
        assistantMessageID: assistant.id,
        childInputID: first.childInputID,
        messages: [
          SessionMessage.User.make({
            id: first.childInputID,
            type: "user",
            text: "first provider attempt",
            time: { created: DateTime.makeUnsafe(1) },
          }),
          SessionMessage.User.make({
            id: second.childInputID,
            type: "user",
            text: "second provider attempt",
            time: { created: DateTime.makeUnsafe(2) },
          }),
          assistant,
        ],
      } as unknown as TaskSubmission.RecoveryInput

      expect(yield* submissions.recoverSession(recovery)).toBe(1)
      expect(yield* submissions.get(first.id)).toMatchObject({
        outcome: "completed",
        resultText: "first result",
      })
      expect(yield* submissions.get(second.id)).toMatchObject({
        status: "accepted",
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
