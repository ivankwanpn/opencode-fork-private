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
  const { id, type, ...data } = encodeMessage(message)
  return {
    id,
    session_id: targetSessionID,
    type,
    seq,
    time_created: DateTime.toEpochMillis(message.time.created),
    data,
  }
}

const makeLocationLayer = (runnerCalls: { count: number }) =>
  Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(
      () =>
        Layer.succeed(
          SessionRunner.Service,
          SessionRunner.Service.of({
            run: () =>
              Effect.sync(() => {
                runnerCalls.count++
              }),
          }),
        ) as unknown as Layer.Layer<LocationServices>,
      { idleTimeToLive: "1 minute" },
    ),
  )

const startRecovery = (runnerCalls: { count: number }) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    yield* SessionExecution.Service.pipe(
      Effect.provide(
        LayerNode.compile(SessionExecutionLocal.node, [
          [Database.node, Layer.succeed(Database.Service, database)],
          [EventV2.node, Layer.succeed(EventV2.Service, events)],
          [LocationServiceMap.node, makeLocationLayer(runnerCalls)],
          [SessionCommand.node, commandLayer],
        ]),
      ),
    )
  })

describe("SessionExecution recovery", () => {
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

  it.effect("marks a responding task as recovery-required when no completed assistant exists", () =>
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

      const runnerCalls = { count: 0 }
      yield* startRecovery(runnerCalls)
      yield* startRecovery(runnerCalls)

      expect(yield* submissions.get(first.id)).toMatchObject({
        outcome: "recovery-required",
      })
      expect(yield* submissions.get(second.id)).toMatchObject({
        status: "accepted",
      })
      expect(runnerCalls.count).toBe(0)
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(1)
      expect(yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, first.childInputID)).get()).toMatchObject({
        terminal_outcome: "recovery-required",
      })
      expect(
        yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, second.childInputID)).get(),
      ).toMatchObject({
        terminal_outcome: null,
      })
    }),
  )
})
