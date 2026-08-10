import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionInput } from "@opencode-ai/core/session/input"
import {
  SessionAttemptTable,
  SessionCancellationTable,
  SessionInputTable,
  SessionMessageTable,
  SessionTable,
} from "@opencode-ai/core/session/sql"
import { SessionAttempt } from "@opencode-ai/core/session/attempt"
import { testEffect } from "./lib/effect"
import { Snapshot } from "@opencode-ai/core/snapshot"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))
const sessionsLayer = AppNodeBuilder.build(SessionV2.node, [[SessionExecution.node, SessionExecution.noopLayer]])
const sessionID = SessionV2.ID.make("ses_projector_test")
const created = DateTime.makeUnsafe(0)
const model = { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") }
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

const assistantRow = (
  id: SessionMessage.ID,
  seq: number,
  time: { created: DateTime.Utc; completed?: DateTime.Utc } = { created },
) => {
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(SessionMessage.Assistant.make({ id, type: "assistant", agent: "build", model, content: [], time }))
  return { id, session_id: sessionID, type, seq, time_created: DateTime.toEpochMillis(time.created), data }
}

describe("SessionProjector", () => {
  it.effect("projects staged, cleared, and committed reverts", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
      const boundary = SessionMessage.ID.make("msg_boundary")
      yield* db
        .insert(SessionMessageTable)
        .values([assistantRow(boundary, 1), assistantRow(SessionMessage.ID.make("msg_later"), 2)])
        .run()
      const events = yield* EventV2.Service
      yield* events.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        revert: { messageID: boundary, snapshot: Snapshot.ID.make("tree"), diff: "patch", files: [] },
      })
      expect((yield* db.select({ revert: SessionTable.revert }).from(SessionTable).get())?.revert).toMatchObject({
        messageID: boundary,
        snapshot: "tree",
        files: [],
      })
      yield* events.publish(SessionEvent.RevertEvent.Cleared, { sessionID, timestamp: DateTime.makeUnsafe(2) })
      expect((yield* db.select({ revert: SessionTable.revert }).from(SessionTable).get())?.revert).toBeNull()
      yield* events.publish(SessionEvent.RevertEvent.Staged, {
        sessionID,
        timestamp: DateTime.makeUnsafe(3),
        revert: { messageID: boundary, files: [] },
      })
      yield* events.publish(SessionEvent.RevertEvent.Committed, {
        sessionID,
        messageID: boundary,
        timestamp: DateTime.makeUnsafe(4),
      })
      expect(
        (yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).all()).map((row) => row.id),
      ).toEqual([boundary])
    }),
  )

  it.effect("orders projected messages and context by durable aggregate sequence", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service

      yield* events.publish(
        SessionEvent.Prompted,
        {
          sessionID,
          messageID: SessionMessage.ID.make("msg_first"),
          timestamp: created,
          prompt: Prompt.make({ text: "first" }),
          delivery: "steer",
        },
        { id: EventV2.ID.make("evt_z") },
      )
      yield* events.publish(
        SessionEvent.Prompted,
        {
          sessionID,
          messageID: SessionMessage.ID.make("msg_second"),
          timestamp: created,
          prompt: Prompt.make({ text: "second" }),
          delivery: "steer",
        },
        { id: EventV2.ID.make("evt_a") },
      )

      const sessions = yield* SessionV2.Service
      const firstPage = yield* sessions.messages({ sessionID, limit: 1, order: "asc" })
      expect(firstPage.map((message) => (message.type === "user" ? message.text : message.type))).toEqual(["first"])
      const secondPage = yield* sessions.messages({
        sessionID,
        limit: 1,
        order: "asc",
        cursor: { id: firstPage[0]!.id, direction: "next" },
      })
      expect(secondPage.map((message) => (message.type === "user" ? message.text : message.type))).toEqual(["second"])
      expect(
        (yield* sessions.messages({
          sessionID,
          limit: 1,
          order: "asc",
          cursor: { id: secondPage[0]!.id, direction: "previous" },
        })).map((message) => (message.type === "user" ? message.text : message.type)),
      ).toEqual(["first"])
      expect(
        (yield* sessions.context(sessionID)).map((message) => (message.type === "user" ? message.text : message.type)),
      ).toEqual(["first", "second"])
    }).pipe(Effect.provide(sessionsLayer)),
  )

  it.effect("marks an inbox row promoted with the Prompted event sequence", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.make("msg_admitted")
      const admitted = yield* SessionInput.admit(db, events, {
        id,
        sessionID,
        prompt: Prompt.make({ text: "promote me" }),
        delivery: "steer",
      })
      if (!admitted) return yield* Effect.die("Prompt admission failed")

      const event = yield* events.publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: admitted.timeCreated,
        messageID: id,
        prompt: Prompt.make({ text: "promote me" }),
        delivery: "steer",
      })

      expect(
        yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie),
      ).toMatchObject({ promoted_seq: event.durable?.seq })
    }),
  )

  it.effect("projects durable context messages supported by the updater", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service

      yield* events.publish(SessionEvent.AgentSwitched, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: created,
        agent: "build",
      })
      yield* events.publish(SessionEvent.ModelSwitched, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: created,
        model,
      })
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: created,
        text: "synthetic context",
      })
      yield* events.publish(SessionEvent.Shell.Started, {
        sessionID,
        messageID: SessionMessage.ID.create(),
        timestamp: created,
        callID: "shell-1",
        command: "pwd",
      })
      yield* events.publish(SessionEvent.Shell.Ended, {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        callID: "shell-1",
        output: "/project",
      })
      const compactionID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.Compaction.Started, {
        sessionID,
        messageID: compactionID,
        timestamp: created,
        reason: "manual",
      })
      yield* events.publish(SessionEvent.Compaction.Delta, {
        sessionID,
        messageID: compactionID,
        timestamp: created,
        text: "partial",
      })
      expect(
        yield* db
          .select({ id: EventTable.id })
          .from(EventTable)
          .where(eq(EventTable.type, SessionEvent.Compaction.Delta.type))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([])
      expect(
        yield* db
          .select({ id: SessionMessageTable.id })
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.type, "compaction"))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([])
      yield* events.publish(SessionEvent.Compaction.Ended, {
        sessionID,
        messageID: compactionID,
        timestamp: DateTime.makeUnsafe(1),
        reason: "manual",
        text: "summary",
        recent: "recent context",
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
      )

      expect(messages.map((message) => message.type)).toEqual([
        "agent-switched",
        "model-switched",
        "synthetic",
        "shell",
        "compaction",
      ])
      expect(messages.find((message) => message.type === "shell")).toMatchObject({
        output: "/project",
        time: { completed: DateTime.makeUnsafe(1) },
      })
      expect(messages.find((message) => message.type === "compaction")).toMatchObject({
        summary: "summary",
        recent: "recent context",
      })
      expect(
        yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie),
      ).toMatchObject({
        agent: "build",
        model,
        time_updated: DateTime.toEpochMillis(created),
      })
    }),
  )

  it.effect("rejects distinct creator events that reuse one projected message ID", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.make("msg_creator_collision")

      yield* events.publish(SessionEvent.Synthetic, { sessionID, messageID: id, timestamp: created, text: "keep me" })
      const exit = yield* events
        .publish(SessionEvent.Step.Started, {
          sessionID,
          assistantMessageID: id,
          timestamp: created,
          agent: "build",
          model,
        })
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      expect(
        yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, id)).get().pipe(Effect.orDie),
      ).toMatchObject({ type: "synthetic" })
    }),
  )

  it.effect("does not revive a stale incomplete in-memory assistant projection", () =>
    Effect.gen(function* () {
      const stale = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_assistant_stale"),
        type: "assistant",
        agent: "build",
        model,
        content: [],
        time: { created },
      })
      const completed = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_assistant_completed"),
        type: "assistant",
        agent: "build",
        model,
        content: [],
        time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
      })

      expect(
        yield* SessionMessageUpdater.memory({ messages: [stale, completed] }).getCurrentAssistant(),
      ).toBeUndefined()
    }),
  )

  it.effect("updates only the newest incomplete assistant projection", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistantRow(SessionMessage.ID.make("msg_assistant_1"), 0),
          assistantRow(SessionMessage.ID.make("msg_assistant_2"), 1),
        ])
        .run()
        .pipe(Effect.orDie)

      const service = yield* EventV2.Service
      yield* service.publish(SessionEvent.Step.Ended, {
        sessionID,
        timestamp: DateTime.makeUnsafe(1),
        assistantMessageID: SessionMessage.ID.make("msg_assistant_2"),
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.id))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
      )
      expect(messages[0]).not.toHaveProperty("time.completed")
      expect(messages[1]).toMatchObject({
        type: "assistant",
        finish: "stop",
        time: { completed: DateTime.makeUnsafe(1) },
      })
    }),
  )

  it.effect("does not revive a stale incomplete assistant projection", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionMessageTable)
        .values([
          assistantRow(SessionMessage.ID.make("msg_assistant_stale"), 0),
          assistantRow(SessionMessage.ID.make("msg_assistant_completed"), 1, {
            created: DateTime.makeUnsafe(1),
            completed: DateTime.makeUnsafe(2),
          }),
        ])
        .run()
        .pipe(Effect.orDie)

      const service = yield* EventV2.Service
      yield* service.publish(SessionEvent.Text.Started, {
        sessionID,
        assistantMessageID: SessionMessage.ID.make("msg_assistant_completed"),
        timestamp: DateTime.makeUnsafe(3),
        textID: "text-stale",
      })

      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .orderBy(asc(SessionMessageTable.id))
        .all()
        .pipe(Effect.orDie)
      const messages = rows.map((row) =>
        Schema.decodeUnknownSync(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }),
      )
      expect(messages).toEqual([
        SessionMessage.Assistant.make({
          id: SessionMessage.ID.make("msg_assistant_completed"),
          type: "assistant",
          agent: "build",
          model,
          content: [SessionMessage.AssistantText.make({ type: "text", id: "text-stale", text: "" })],
          time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
        }),
        SessionMessage.Assistant.make({
          id: SessionMessage.ID.make("msg_assistant_stale"),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          time: { created },
        }),
      ])
    }),
  )

  it.effect("projects provider attempt recovery states durably", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service
      const attemptID = EventV2.ID.create()
      const assistantMessageID = SessionMessage.ID.create()

      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID,
        attemptID,
        assistantMessageID,
        timestamp: created,
        attempt: 1,
      })
      expect(yield* SessionAttempt.status(db, sessionID, false)).toMatchObject({
        type: "recovery-required",
        attemptID,
        reason: "dispatch-unknown",
      })
      expect(yield* SessionAttempt.status(db, sessionID, true)).toMatchObject({
        type: "running",
        phase: "dispatching",
      })

      yield* events.publish(SessionEvent.ProviderAttempt.ResponseStarted, {
        sessionID,
        attemptID,
        timestamp: DateTime.makeUnsafe(1),
      })
      expect(yield* SessionAttempt.status(db, sessionID, false)).toMatchObject({
        type: "recovery-required",
        reason: "response-interrupted",
      })

      yield* events.publish(SessionEvent.Retried, {
        sessionID,
        attemptID,
        timestamp: DateTime.makeUnsafe(2),
        attempt: 2,
        next: DateTime.makeUnsafe(10),
        error: { message: "overloaded", isRetryable: true },
      })
      expect(yield* SessionAttempt.status(db, sessionID, false)).toMatchObject({
        type: "retrying",
        attempt: 2,
        next: 10,
      })

      const replacementID = EventV2.ID.create()
      const replacementAssistantID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID,
        attemptID: replacementID,
        assistantMessageID: replacementAssistantID,
        timestamp: DateTime.makeUnsafe(10),
        attempt: 2,
        retryOf: attemptID,
      })
      yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
        sessionID,
        attemptID: replacementID,
        assistantMessageID: replacementAssistantID,
        timestamp: DateTime.makeUnsafe(11),
        outcome: "completed",
        continuation: true,
      })
      expect(yield* SessionAttempt.status(db, sessionID, false)).toMatchObject({
        type: "continuation-required",
        attemptID: replacementID,
      })
    }),
  )

  it.effect("ignores late provider attempt transitions after durable cancellation", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const events = yield* EventV2.Service
      const attemptID = EventV2.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID,
        attemptID,
        assistantMessageID,
        timestamp: created,
        attempt: 1,
      })
      yield* db
        .insert(SessionCancellationTable)
        .values({ root_session_id: sessionID, time_created: 1, time_completed: 1 })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionAttemptTable)
        .set({ status: "abandoned", retry_at: null, decision: "abandon", time_updated: 1 })
        .where(eq(SessionAttemptTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)

      yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
        sessionID,
        attemptID,
        assistantMessageID,
        timestamp: DateTime.makeUnsafe(2),
        outcome: "completed",
        continuation: true,
      })
      yield* events.publish(SessionEvent.Retried, {
        sessionID,
        attemptID,
        timestamp: DateTime.makeUnsafe(3),
        attempt: 2,
        next: DateTime.makeUnsafe(4),
        error: { message: "late retry", isRetryable: true },
      })

      expect(yield* db.select({ status: SessionAttemptTable.status }).from(SessionAttemptTable).get()).toEqual({
        status: "abandoned",
      })
    }),
  )

  it.effect("keeps a cancellation terminal after a concurrent late provider transition", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "test",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)

      const attemptID = EventV2.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      yield* db
        .insert(SessionAttemptTable)
        .values({
          session_id: sessionID,
          attempt_id: attemptID,
          assistant_message_id: assistantMessageID,
          status: "started",
          attempt: 1,
          seq: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      const checked = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const all = db.all.bind(db)
      const racedDB = new Proxy(db, {
        get(target, property, receiver) {
          if (property !== "all") return Reflect.get(target, property, receiver)
          return (query: Parameters<typeof db.all>[0]) =>
            Effect.gen(function* () {
              const rows = yield* all(query)
              yield* Deferred.succeed(checked, undefined)
              yield* Deferred.await(release)
              return rows
            })
        },
      }) as typeof db
      const transition = yield* SessionAttempt.projectEnded(racedDB, {
          id: EventV2.ID.create(),
          type: SessionEvent.ProviderAttempt.Ended.type,
          data: {
            sessionID,
            attemptID,
            assistantMessageID,
            timestamp: DateTime.makeUnsafe(2),
            outcome: "completed",
            continuation: true,
          },
          durable: { aggregateID: sessionID, seq: 2, version: 1 },
        }).pipe(Effect.forkScoped)
      yield* Deferred.await(checked)
      const cancellation = yield*
        db
          .transaction(
            () =>
              Effect.gen(function* () {
                yield* db
                  .insert(SessionCancellationTable)
                  .values({ root_session_id: sessionID, time_created: 1, time_completed: 1 })
                  .run()
                  .pipe(Effect.orDie)
                yield* db
                  .update(SessionAttemptTable)
                  .set({ status: "abandoned", retry_at: null, decision: "abandon", time_updated: 1 })
                  .where(eq(SessionAttemptTable.session_id, sessionID))
                  .run()
                  .pipe(Effect.orDie)
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie, Effect.forkScoped)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(transition)
      yield* Fiber.join(cancellation)

      expect(yield* db.select({ status: SessionAttemptTable.status }).from(SessionAttemptTable).get()).toEqual({
        status: "abandoned",
      })
    }),
  )

  it.effect("discovers only safe local startup recovery work", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
        .pipe(Effect.orDie)
      const ids = {
        pending: SessionV2.ID.make("ses_startup_pending"),
        promoted: SessionV2.ID.make("ses_startup_promoted"),
        continuation: SessionV2.ID.make("ses_startup_continuation"),
        recovering: SessionV2.ID.make("ses_startup_recovering"),
        due: SessionV2.ID.make("ses_startup_due"),
        future: SessionV2.ID.make("ses_startup_future"),
      }
      yield* db
        .insert(SessionTable)
        .values(
          Object.values(ids).map((id) => ({
            id,
            project_id: Project.ID.global,
            slug: id,
            directory: "/project",
            title: id,
            version: "test",
          })),
        )
        .run()
        .pipe(Effect.orDie)
      yield* db
        .insert(SessionInputTable)
        .values([
          {
            id: SessionMessage.ID.make("msg_startup_pending"),
            session_id: ids.pending,
            prompt: Prompt.make({ text: "pending" }),
            delivery: "steer",
            admitted_seq: 1,
            time_created: 0,
          },
          {
            id: SessionMessage.ID.make("msg_startup_promoted"),
            session_id: ids.promoted,
            prompt: Prompt.make({ text: "promoted" }),
            delivery: "steer",
            admitted_seq: 1,
            promoted_seq: 2,
            time_created: 0,
          },
          {
            id: SessionMessage.ID.make("msg_startup_recovering"),
            session_id: ids.recovering,
            prompt: Prompt.make({ text: "blocked" }),
            delivery: "steer",
            admitted_seq: 1,
            time_created: 0,
          },
        ])
        .run()
        .pipe(Effect.orDie)
      const events = yield* EventV2.Service
      const publishStarted = (id: SessionV2.ID, attemptID: EventV2.ID, assistantMessageID: SessionMessage.ID) =>
        events.publish(SessionEvent.ProviderAttempt.Started, {
          sessionID: id,
          attemptID,
          assistantMessageID,
          timestamp: created,
          attempt: 1,
        })

      const continuationAttempt = EventV2.ID.create()
      const continuationAssistant = SessionMessage.ID.create()
      yield* publishStarted(ids.continuation, continuationAttempt, continuationAssistant)
      yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
        sessionID: ids.continuation,
        attemptID: continuationAttempt,
        assistantMessageID: continuationAssistant,
        timestamp: DateTime.makeUnsafe(1),
        outcome: "completed",
        continuation: true,
      })

      yield* publishStarted(ids.recovering, EventV2.ID.create(), SessionMessage.ID.create())

      const dueAttempt = EventV2.ID.create()
      yield* publishStarted(ids.due, dueAttempt, SessionMessage.ID.create())
      yield* events.publish(SessionEvent.Retried, {
        sessionID: ids.due,
        attemptID: dueAttempt,
        timestamp: DateTime.makeUnsafe(1),
        attempt: 2,
        next: DateTime.makeUnsafe(10),
        error: { message: "retry due", isRetryable: true },
      })

      const futureAttempt = EventV2.ID.create()
      yield* publishStarted(ids.future, futureAttempt, SessionMessage.ID.create())
      yield* events.publish(SessionEvent.Retried, {
        sessionID: ids.future,
        attemptID: futureAttempt,
        timestamp: DateTime.makeUnsafe(1),
        attempt: 2,
        next: DateTime.makeUnsafe(20),
        error: { message: "retry later", isRetryable: true },
      })

      expect(new Set(yield* SessionExecutionLocal.startupCandidates(db, 10))).toEqual(
        new Set([ids.pending, ids.promoted, ids.continuation, ids.due]),
      )
      expect(yield* SessionExecutionLocal.startupRecoveryCandidates(db, 10)).toEqual([
        { sessionID: ids.recovering, reason: "dispatch-unknown" },
      ])
    }),
  )
})
