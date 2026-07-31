import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Layer, LayerMap, Schema } from "effect"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import {
  SessionAttemptTable,
  SessionInputTable,
  SessionMessageTable,
  SessionTable,
  TaskNotificationOutboxTable,
} from "@opencode-ai/core/session/sql"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node, TaskSubmission.node])),
)

const encodeMessage = Schema.encodeSync(SessionMessage.Message)
const sessionID = SessionSchema.ID.make("ses_terminal_recovery")
const nonTaskSessionID = SessionSchema.ID.make("ses_non_task_recovery")
const parentSessionID = SessionSchema.ID.make("ses_execution_parent")
const childSessionID = SessionSchema.ID.make("ses_execution_child")
const model = ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") })
const invocation = {
  parentSessionID,
  assistantMessageID: SessionMessage.ID.make("msg_execution_parent_assistant"),
  toolCallID: "call_execution_recovery",
  childSessionID,
  description: "Recover background task",
  prompt: Prompt.make({ text: "Recover background task" }),
  agent: "general",
}

const commandLayer = Layer.succeed(
  SessionCommand.Service,
  SessionCommand.Service.of({
    create: () => Effect.die("unused"),
    plan: () => Effect.die("unused"),
    synthetic: () => Effect.die("unused"),
    admitSynthetic: () => Effect.die("unused"),
    switchAgent: () => Effect.die("unused"),
    switchModel: () => Effect.die("unused"),
    admit: () => Effect.die("unused"),
  }),
)

const setupProject = (sessions: Array<{ id: SessionSchema.ID; parentID?: SessionSchema.ID }>) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values(
        sessions.map((session) => ({
          id: session.id,
          project_id: Project.ID.global,
          parent_id: session.parentID,
          slug: session.id,
          directory: "/project",
          title: session.id,
          version: "test",
        })),
      )
      .run()
      .pipe(Effect.orDie)
  })

function messageRow(message: SessionMessage.Message, targetSessionID: SessionSchema.ID, seq: number) {
  const { type, ...data } = encodeMessage(message)
  return {
    id: message.id,
    session_id: targetSessionID,
    type,
    seq,
    time_created: DateTime.toEpochMillis(message.time.created),
    data,
  }
}

const makeLocationLayer = (
  runnerCalls: { count: number },
  onRun?: (sessionID: SessionSchema.ID) => Effect.Effect<void>,
) =>
  Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      () =>
        Layer.succeed(
          SessionRunner.Service,
          SessionRunner.Service.of({
            run: ({ sessionID }) =>
              Effect.sync(() => {
                runnerCalls.count++
              }).pipe(Effect.andThen(onRun ? onRun(sessionID) : Effect.void)),
          }),
        ) as unknown as Layer.Layer<LocationServices>,
      { idleTimeToLive: "1 minute" },
    ),
  )

const startRecovery = (runnerCalls: { count: number }, onRun?: (sessionID: SessionSchema.ID) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    yield* SessionExecution.Service.pipe(
      Effect.provide(
        LayerNode.compile(SessionExecutionLocal.node, [
          [Database.node, Layer.succeed(Database.Service, database)],
          [EventV2.node, Layer.succeed(EventV2.Service, events)],
          [LocationServiceMap.node, makeLocationLayer(runnerCalls, onRun)],
          [SessionCommand.node, commandLayer],
        ]),
      ),
    )
  })

describe("SessionExecution recovery", () => {
  it.effect("settles an accepted task after restart when the child completed normally", () =>
    Effect.gen(function* () {
      yield* setupProject([
        { id: parentSessionID },
        { id: childSessionID, parentID: parentSessionID },
      ])
      const { db } = yield* Database.Service
      const submissions = yield* TaskSubmission.Service
      const submitted = yield* submissions.submit(invocation)
      expect(yield* SessionExecutionLocal.startupCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([childSessionID])
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_execution_accepted_completed_assistant"),
        type: "assistant",
        agent: "general",
        model,
        content: [{ type: "text", id: "text_execution_accepted_completed", text: "accepted result" }],
        time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
      })
      const messages = [
        SessionMessage.User.make({
          id: submitted.childInputID,
          type: "user",
          text: invocation.prompt.text,
          time: { created: DateTime.makeUnsafe(1) },
        }),
        assistant,
      ]
      expect(yield* submissions.recoverCompleted({ sessionID: childSessionID, messages })).toBe(1)
      expect(yield* submissions.get(submitted.id)).toMatchObject({
        outcome: "completed",
        resultText: "accepted result",
      })
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
    }),
  )

  it.effect("does not hide an interrupted newer task behind an older completed submission", () =>
    Effect.gen(function* () {
      yield* setupProject([
        { id: parentSessionID },
        { id: childSessionID, parentID: parentSessionID },
      ])
      const { db } = yield* Database.Service
      const submissions = yield* TaskSubmission.Service
      const first = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_execution_recovery_older",
        assistantMessageID: SessionMessage.ID.make("msg_execution_recovery_older_assistant"),
        prompt: Prompt.make({ text: "Older completed task" }),
        description: "Older completed task",
      })
      const second = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_execution_recovery_newer",
        assistantMessageID: SessionMessage.ID.make("msg_execution_recovery_newer_assistant"),
        prompt: Prompt.make({ text: "Newer interrupted task" }),
        description: "Newer interrupted task",
      })
      yield* submissions.claim(second.id)
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_execution_recovery_older_result"),
        type: "assistant",
        agent: "general",
        model,
        content: [{ type: "text", id: "text_execution_recovery_older_result", text: "older result" }],
        time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
      })

      yield* db
        .insert(SessionMessageTable)
        .values([
          messageRow(
            SessionMessage.User.make({
              id: first.childInputID,
              type: "user",
              text: first.prompt.text,
              time: { created: DateTime.makeUnsafe(1) },
            }),
            childSessionID,
            1,
          ),
          messageRow(assistant, childSessionID, 2),
          messageRow(
            SessionMessage.User.make({
              id: second.childInputID,
              type: "user",
              text: second.prompt.text,
              time: { created: DateTime.makeUnsafe(4) },
            }),
            childSessionID,
            3,
          ),
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.id, first.childInputID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 3 })
        .where(eq(SessionInputTable.id, second.childInputID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionAttemptTable)
        .values({
          session_id: childSessionID,
          attempt_id: EventV2.ID.make("evt_execution_recovery_newer_attempt"),
          assistant_message_id: second.assistantMessageID,
          status: "responding",
          attempt: 1,
          seq: 3,
          time_updated: 3,
        })
        .run()
        .pipe(Effect.orDie)

      yield* startRecovery({ count: 0 })

      expect(yield* submissions.get(first.id)).toMatchObject({
        outcome: "completed",
        resultText: "older result",
      })
      expect(yield* submissions.get(second.id)).toMatchObject({
        outcome: "recovery-required",
      })
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(2)
      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
    }),
  )

  it.effect("does not rediscover or promote terminal inputs that never reached the runner", () =>
    Effect.gen(function* () {
      yield* setupProject([{ id: sessionID }])
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const steerID = SessionMessage.ID.make("msg_terminal_steer")
      const queueID = SessionMessage.ID.make("msg_terminal_queue")

      yield* SessionInput.admit(db, events, {
        id: steerID,
        sessionID,
        prompt: Prompt.make({ text: "terminal steer" }),
        delivery: "steer",
      })
      yield* SessionInput.admit(db, events, {
        id: queueID,
        sessionID,
        prompt: Prompt.make({ text: "terminal queue" }),
        delivery: "queue",
      })
      yield* db
        .update(SessionInputTable)
        .set({
          terminal_outcome: "completed",
          terminal_time: 10,
          terminal_seq: 10,
        })
        .where(eq(SessionInputTable.id, steerID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({
          terminal_outcome: "completed",
          terminal_time: 11,
          terminal_seq: 11,
        })
        .where(eq(SessionInputTable.id, queueID))
        .run()
        .pipe(Effect.orDie)

      expect(yield* SessionInput.hasPending(db, sessionID, "steer")).toBe(false)
      expect(yield* SessionInput.hasPending(db, sessionID, "queue")).toBe(false)
      expect(yield* SessionInput.startupCandidates(db)).toEqual([])
      expect(yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)).toBe(0)
      expect(yield* SessionInput.promoteNextQueued(db, events, sessionID)).toBe(false)
      expect(yield* db.select().from(SessionMessageTable).all()).toHaveLength(0)
    }),
  )

  it.effect("keeps a non-task responding attempt in recovery candidates and out of safe startup dispatch", () =>
    Effect.gen(function* () {
      yield* setupProject([{ id: nonTaskSessionID }])
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const inputID = SessionMessage.ID.make("msg_non_task_prompt")

      yield* SessionInput.admit(db, events, {
        id: inputID,
        sessionID: nonTaskSessionID,
        prompt: Prompt.make({ text: "non task prompt" }),
        delivery: "steer",
      })
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.id, inputID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionAttemptTable)
        .values({
          session_id: nonTaskSessionID,
          attempt_id: EventV2.ID.make("evt_non_task_attempt"),
          assistant_message_id: SessionMessage.ID.make("msg_non_task_assistant"),
          status: "responding",
          attempt: 1,
          seq: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([
        { sessionID: nonTaskSessionID, reason: "response-interrupted" },
      ])
      expect(yield* SessionExecutionLocal.startupCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(
        yield* db
          .select({ status: SessionAttemptTable.status, retryAt: SessionAttemptTable.retry_at })
          .from(SessionAttemptTable)
          .where(eq(SessionAttemptTable.session_id, nonTaskSessionID))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([{ status: "responding", retryAt: null }])

      const runnerCalls = { count: 0 }
      yield* startRecovery(runnerCalls)

      expect(runnerCalls.count).toBe(0)
      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([
        { sessionID: nonTaskSessionID, reason: "response-interrupted" },
      ])
      expect(yield* SessionExecutionLocal.startupCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(
        yield* db
          .select({ status: SessionAttemptTable.status, retryAt: SessionAttemptTable.retry_at })
          .from(SessionAttemptTable)
          .where(eq(SessionAttemptTable.session_id, nonTaskSessionID))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([{ status: "responding", retryAt: null }])
    }),
  )

  it.effect("settles a responding task from an already completed assistant during restart recovery", () =>
    Effect.gen(function* () {
      yield* setupProject([
        { id: parentSessionID },
        { id: childSessionID, parentID: parentSessionID },
      ])
      const { db } = yield* Database.Service
      const submissions = yield* TaskSubmission.Service
      const submitted = yield* submissions.submit(invocation)
      yield* submissions.claim(submitted.id)
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_execution_completed_assistant"),
        type: "assistant",
        agent: "general",
        model,
        content: [{ type: "text", id: "text_execution_completed", text: "recovered result" }],
        time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
      })

      yield* db
        .insert(SessionMessageTable)
        .values([
          messageRow(
            SessionMessage.User.make({
              id: submitted.childInputID,
              type: "user",
              text: invocation.prompt.text,
              time: { created: DateTime.makeUnsafe(1) },
            }),
            childSessionID,
            1,
          ),
          messageRow(assistant, childSessionID, 2),
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.id, submitted.childInputID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionAttemptTable)
        .values({
          session_id: childSessionID,
          attempt_id: EventV2.ID.make("evt_execution_attempt_completed"),
          assistant_message_id: assistant.id,
          status: "responding",
          attempt: 1,
          seq: 2,
          time_updated: 2,
        })
        .run()
        .pipe(Effect.orDie)

      const runnerCalls = { count: 0 }
      yield* startRecovery(runnerCalls)

      expect(yield* submissions.get(submitted.id)).toMatchObject({
        outcome: "completed",
        resultText: "recovered result",
      })
      expect(runnerCalls.count).toBe(0)
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
    }),
  )

  it.effect("clears a stale responding task attempt after the task is already terminal", () =>
    Effect.gen(function* () {
      yield* setupProject([
        { id: parentSessionID },
        { id: childSessionID, parentID: parentSessionID },
      ])
      const { db } = yield* Database.Service
      const submissions = yield* TaskSubmission.Service
      const submitted = yield* submissions.submit(invocation)
      yield* submissions.claim(submitted.id)
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.id, submitted.childInputID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionAttemptTable)
        .values({
          session_id: childSessionID,
          attempt_id: EventV2.ID.make("evt_execution_attempt_stale"),
          assistant_message_id: SessionMessage.ID.make("msg_execution_stale_assistant"),
          status: "responding",
          attempt: 1,
          seq: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)
      yield* submissions.terminalize({
        submissionID: submitted.id,
        outcome: "completed",
        resultMessageID: SessionMessage.ID.make("msg_execution_terminal_result"),
        resultText: "terminal result",
      })

      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([
        { sessionID: childSessionID, reason: "response-interrupted" },
      ])

      const runnerCalls = { count: 0 }
      yield* startRecovery(runnerCalls)

      expect(runnerCalls.count).toBe(0)
      expect(
        yield* db.select().from(SessionAttemptTable).where(eq(SessionAttemptTable.session_id, childSessionID)).get(),
      ).toMatchObject({
        status: "ended",
      })
      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(yield* SessionExecutionLocal.startupCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
    }),
  )

  it.effect("marks a responding task as recovery-required and leaves later safe durable input restartable", () =>
    Effect.gen(function* () {
      yield* setupProject([
        { id: parentSessionID },
        { id: childSessionID, parentID: parentSessionID },
      ])
      const { db } = yield* Database.Service
      const submissions = yield* TaskSubmission.Service
      const first = yield* submissions.submit(invocation)
      yield* submissions.claim(first.id)
      const second = yield* submissions.submit({
        ...invocation,
        toolCallID: "call_execution_followup",
        assistantMessageID: SessionMessage.ID.make("msg_execution_parent_assistant_followup"),
        prompt: Prompt.make({ text: "Later follow-up task" }),
        description: "Later follow-up task",
      })

      yield* db
        .insert(SessionMessageTable)
        .values([
          messageRow(
            SessionMessage.User.make({
              id: first.childInputID,
              type: "user",
              text: invocation.prompt.text,
              time: { created: DateTime.makeUnsafe(1) },
            }),
            childSessionID,
            1,
          ),
        ])
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({ promoted_seq: 1 })
        .where(eq(SessionInputTable.id, first.childInputID))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionAttemptTable)
        .values({
          session_id: childSessionID,
          attempt_id: EventV2.ID.make("evt_execution_attempt_missing"),
          assistant_message_id: SessionMessage.ID.make("msg_execution_missing_assistant"),
          status: "responding",
          attempt: 1,
          seq: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      yield* startRecovery({ count: 0 })

      expect(yield* submissions.get(first.id)).toMatchObject({
        outcome: "recovery-required",
      })
      expect(yield* submissions.get(second.id)).toMatchObject({
        status: "accepted",
      })
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
      expect(yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, first.childInputID)).get()).toMatchObject({
        terminal_outcome: "recovery-required",
      })
      expect(
        yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, second.childInputID)).get(),
      ).toMatchObject({
        terminal_outcome: null,
      })
      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(yield* SessionExecutionLocal.startupCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([childSessionID])

      yield* db
        .update(SessionInputTable)
        .set({
          terminal_outcome: "completed",
          terminal_time: 2,
          terminal_seq: 2,
        })
        .where(eq(SessionInputTable.id, second.childInputID))
        .run()
        .pipe(Effect.orDie)
      yield* startRecovery({ count: 0 })

      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
      expect(yield* SessionExecutionLocal.startupCandidates(db, Number.MAX_SAFE_INTEGER)).toEqual([])
    }),
  )
})
