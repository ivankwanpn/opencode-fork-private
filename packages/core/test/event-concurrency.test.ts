import { describe, expect } from "bun:test"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node])))
// SessionID is branded with a "ses" prefix, so the aggregate ID must start with "ses".
const aggregateID = SessionV2.ID.make("ses_agg_concurrency_test")

const fixtureSnapshot = () =>
  SessionEvent.SessionSnapshot.make({
    id: SessionV2.ID.make("ses_fixture"),
    projectID: Project.ID.global,
    slug: "test",
    version: "test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    title: "test",
    location: { directory: AbsolutePath.make("/project") },
  })

const updated = (snapshot: SessionEvent.SessionSnapshot, sessionID: SessionV2.ID) =>
  ({
    timestamp: snapshot.time.updated,
    sessionID,
    info: snapshot,
  }) as const

describe("EventV2 expectedSeq", () => {
  it.effect("publishes when expectedSeq matches the current aggregate sequence", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const snapshot = fixtureSnapshot()
      const seq = yield* EventV2.latestSequence(db, aggregateID)
      const event = yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID), {
        expectedSeq: seq,
      })
      expect(event.durable?.seq).toBe(seq + 1)
    }),
  )

  it.effect("dies with ConflictError when expectedSeq is stale", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const snapshot = fixtureSnapshot()
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID))
      const stale = yield* EventV2.latestSequence(db, aggregateID)
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID)) // advances the sequence
      const exit = yield* events
        .publish(SessionEvent.Updated, updated(snapshot, aggregateID), { expectedSeq: stale })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      // Result.getSuccess wraps in Option in effect 4.0.0-beta; getOrUndefined unwraps directly.
      const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty
      expect(Result.getOrUndefined(Cause.findDefect(cause)) instanceof EventV2.ConflictError).toBe(true)
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)
      expect(rows.length).toBe(2) // the stale publish wrote nothing
    }),
  )

  it.effect("conflict is observable and a retry with a fresh expectedSeq converges deterministically", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const barrier = yield* Deferred.make<void>()
      const read = yield* Deferred.make<void>()
      const snapshot = fixtureSnapshot()
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID))
      const fiber = yield* Effect.forkScoped(
        Effect.gen(function* () {
          const seq = yield* EventV2.latestSequence(db, aggregateID)
          yield* Deferred.succeed(read, undefined) // the child read its expectedSeq before the race began
          yield* Deferred.await(barrier) // deterministic pause: another publish wins the race
          yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID), { expectedSeq: seq })
        }),
      )
      yield* Deferred.await(read) // the child's read happens-before the racing publish
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID))
      yield* Deferred.succeed(barrier, undefined)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true) // the fiber observed the conflict as a ConflictError defect
      // A caller-level retry re-reads and succeeds:
      const fresh = yield* EventV2.latestSequence(db, aggregateID)
      const retried = yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID), {
        expectedSeq: fresh,
      })
      expect(retried.durable?.seq).toBe(fresh + 1)
      const rows = yield* db
        .select({ seq: EventTable.seq })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.seq)).toEqual([0, 1, 2]) // no gaps, no duplicates
    }),
  )
})

describe("EventV2 claimed aggregates", () => {
  it.effect("publishes with expectedSeq after the aggregate is claimed", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const id = SessionV2.ID.make("ses_agg_claim_publish")
      yield* events.publish(SessionEvent.Updated, updated(fixtureSnapshot(), id))
      yield* events.claim(id, "owner-a")
      const seq = yield* EventV2.latestSequence(db, id)
      const event = yield* events.publish(SessionEvent.Updated, updated(fixtureSnapshot(), id), {
        expectedSeq: seq,
      })
      expect(event.durable?.seq).toBe(seq + 1)
      const rows = yield* db
        .select({ seq: EventTable.seq })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, id))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.seq)).toEqual([0, 1]) // both writes persisted
    }),
  )

  it.effect("replay by a non-owner of a claimed aggregate still silently skips", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const id = SessionV2.ID.make("ses_agg_claim_replay")
      yield* events.publish(SessionEvent.Updated, updated(fixtureSnapshot(), id))
      yield* events.claim(id, "owner-a")
      const seq = yield* EventV2.latestSequence(db, id)
      yield* events.replay(
        {
          id: EventV2.ID.make("evt_claim_replay"),
          type: "session.next.updated.1",
          seq: seq + 1,
          aggregateID: id,
          data: Schema.encodeUnknownSync(SessionEvent.Updated.data)(updated(fixtureSnapshot(), id)),
        },
        { ownerID: "other" },
      )
      const rows = yield* db
        .select({ seq: EventTable.seq })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, id))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.seq)).toEqual([0]) // the non-owner replay wrote nothing
      expect(yield* EventV2.latestSequence(db, id)).toBe(seq) // sequence untouched
    }),
  )
})
