import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionAttempt } from "@opencode-ai/core/session/attempt"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionRepair } from "@opencode-ai/core/session/repair"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionAttemptTable, SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))

const sessionID = SessionSchema.ID.make("ses_repair_test")
const created = DateTime.makeUnsafe(0)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "repair",
      directory: "/project",
      title: "repair",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("SessionRepair", () => {
  it.effect("rebuilds a missing session_attempt row from the durable log", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
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
      yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
        sessionID,
        attemptID,
        assistantMessageID,
        timestamp: DateTime.makeUnsafe(1),
        outcome: "completed",
        continuation: false,
      })

      yield* db
        .delete(SessionAttemptTable)
        .where(eq(SessionAttemptTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)

      const result = yield* SessionRepair.repairSession(db, events, sessionID)
      expect(result.repaired).toBe(true)
      const row = yield* SessionAttempt.get(db, sessionID)
      expect(row?.status).toBe("ended")
    }),
  )

  it.effect("rebuilds a missing session_input row from the durable log", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.create()

      const admitted = yield* events.publish(SessionEvent.PromptAdmitted, {
        sessionID,
        messageID: id,
        timestamp: created,
        prompt: Prompt.make({ text: "repair me" }),
        delivery: "steer",
      })

      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.id, id)).run().pipe(Effect.orDie)

      const result = yield* SessionRepair.repairSession(db, events, sessionID)
      expect(result.repaired).toBe(true)
      const row = yield* SessionInput.find(db, id)
      expect(row?.admittedSeq).toBe(admitted.durable?.seq)
    }),
  )

  it.effect("repairs only the missing input when healthy inputs coexist", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const healthyID = SessionMessage.ID.create()
      const missingID = SessionMessage.ID.create()

      yield* events.publish(SessionEvent.PromptAdmitted, {
        sessionID,
        messageID: healthyID,
        timestamp: created,
        prompt: Prompt.make({ text: "healthy" }),
        delivery: "steer",
      })
      const missing = yield* events.publish(SessionEvent.PromptAdmitted, {
        sessionID,
        messageID: missingID,
        timestamp: DateTime.makeUnsafe(1),
        prompt: Prompt.make({ text: "missing" }),
        delivery: "steer",
      })
      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.id, missingID)).run().pipe(Effect.orDie)

      const result = yield* SessionRepair.repairSession(db, events, sessionID)
      expect(result.repaired).toBe(true)
      const healthy = yield* SessionInput.find(db, healthyID)
      expect(healthy?.admittedSeq).toBeDefined()
      const rebuilt = yield* SessionInput.find(db, missingID)
      expect(rebuilt?.admittedSeq).toBe(missing.durable?.seq)
    }),
  )

  it.effect("reports up-to-date and writes nothing when all rows are present", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const attemptID = EventV2.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      const id = SessionMessage.ID.create()

      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID,
        attemptID,
        assistantMessageID,
        timestamp: created,
        attempt: 1,
      })
      yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
        sessionID,
        attemptID,
        assistantMessageID,
        timestamp: DateTime.makeUnsafe(1),
        outcome: "completed",
        continuation: false,
      })
      yield* events.publish(SessionEvent.PromptAdmitted, {
        sessionID,
        messageID: id,
        timestamp: DateTime.makeUnsafe(2),
        prompt: Prompt.make({ text: "healthy" }),
        delivery: "steer",
      })

      const attemptBefore = yield* SessionAttempt.get(db, sessionID)
      const inputBefore = yield* SessionInput.find(db, id)
      const result = yield* SessionRepair.repairSession(db, events, sessionID)
      expect(result.repaired).toBe(false)
      expect(yield* SessionAttempt.get(db, sessionID)).toEqual(attemptBefore)
      expect(yield* SessionInput.find(db, id)).toEqual(inputBefore)
    }),
  )

  it.effect("reports up-to-date for a healthy retried attempt sequence", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const first = EventV2.ID.create()
      const firstAssistant = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID,
        attemptID: first,
        assistantMessageID: firstAssistant,
        timestamp: created,
        attempt: 1,
      })
      yield* events.publish(SessionEvent.Retried, {
        sessionID,
        attemptID: first,
        timestamp: DateTime.makeUnsafe(1),
        attempt: 2,
        next: DateTime.makeUnsafe(10),
        error: { message: "overloaded", isRetryable: true },
      })
      const second = EventV2.ID.create()
      const secondAssistant = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID,
        attemptID: second,
        assistantMessageID: secondAssistant,
        timestamp: DateTime.makeUnsafe(10),
        attempt: 2,
        retryOf: first,
      })
      yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
        sessionID,
        attemptID: second,
        assistantMessageID: secondAssistant,
        timestamp: DateTime.makeUnsafe(11),
        outcome: "completed",
        continuation: false,
      })

      const before = yield* SessionAttempt.get(db, sessionID)
      const result = yield* SessionRepair.repairSession(db, events, sessionID)
      expect(result.repaired).toBe(false)
      const after = yield* SessionAttempt.get(db, sessionID)
      expect(after).toEqual(before)
      expect(after?.status).toBe("ended")
    }),
  )
})
