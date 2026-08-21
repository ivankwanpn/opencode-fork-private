import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Fiber, Schema, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Session } from "@opencode-ai/schema/session"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const First = EventV2.define({
  type: "batch.first",
  durable: { version: 1, aggregate: "aggregateID" },
  schema: { aggregateID: Schema.String, value: Schema.Number },
})

const Second = EventV2.define({
  type: "batch.second",
  durable: { version: 1, aggregate: "aggregateID" },
  schema: { aggregateID: Schema.String, value: Schema.Number },
})

const It = EventV2.define({
  type: "batch.transient",
  schema: { aggregateID: Schema.String, value: Schema.Number },
})

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node]), []))

const aggregateID = "agg_batch"
const first = (value: number) => ({ aggregateID, value })
const second = (value: number) => ({ aggregateID, value })

describe("EventV2.publishBatch", () => {
  it.effect("rolls back events, sequence, projectors, and local coordination together", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      yield* events.project(First, (event) =>
        db
          .insert(EventTable)
          .values({
            id: EventV2.ID.make(`prj_${event.id}`),
            aggregate_id: event.data.aggregateID,
            seq: -1,
            type: "batch.projected",
            data: { value: event.data.value },
          })
          .run()
          .pipe(Effect.orDie),
      )
      const exit = yield* events
        .publishBatch({
          aggregateID,
          expectedSeq: 0,
          events: [
            { definition: First, data: first(1) },
            { definition: Second, data: second(2) },
          ],
          commit: () => Effect.die(new Error("injected commit failure")),
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      // No sequence row and no event rows: the failed batch changed nothing.
      expect(yield* EventV2.latestSequence(db, aggregateID)).toBe(-1)
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).all().pipe(Effect.orDie),
      ).toEqual([])
    }),
  )

  it.effect("delivers a committed batch in order and wakes a durable subscriber", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      // The durable stream decodes through the SessionEvent manifest, so the
      // batch uses a Session event definition.
      const DurableMessage = SessionEvent.TranscriptMutation.MessageRemoved
      const sessionID = Session.ID.make("ses_batch_delivered")
      const data = (text: string) => ({
        timestamp: DateTime.makeUnsafe(0),
        sessionID,
        messageID: SessionMessage.ID.make(`msg_${text}`),
      })
      const aggregateID = sessionID
      const fiber = yield* events
        .durable({ aggregateID, after: -1 })
        .pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow
      const committed = yield* events.publishBatch({
        aggregateID,
        events: [
          { definition: DurableMessage, data: data("one") },
          { definition: DurableMessage, data: data("two") },
          { definition: DurableMessage, data: data("three") },
        ],
      })
      expect(committed.map((event) => event.durable?.seq)).toEqual([0, 1, 2])
      expect(Array.from(yield* Fiber.join(fiber)).map((event) => event.durable?.seq)).toEqual([0, 1, 2])
    }),
  )

  it.effect("dies on duplicate event IDs before writing anything", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const duplicate = EventV2.ID.make("evt_dup")
      const exit = yield* events
        .publishBatch({
          aggregateID,
          events: [
            { definition: First, data: first(1), id: duplicate },
            { definition: Second, data: second(2), id: duplicate },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* EventV2.latestSequence(db, aggregateID)).toBe(-1)
    }),
  )

  it.effect("dies on Schema encoding failure before writing anything", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const exit = yield* events
        .publishBatch({
          aggregateID,
          events: [
            { definition: First, data: first(1) },
            // value is required by the schema
            { definition: Second, data: { aggregateID } as { aggregateID: string; value: number } },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* EventV2.latestSequence(db, aggregateID)).toBe(-1)
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).all().pipe(Effect.orDie),
      ).toEqual([])
    }),
  )

  it.effect("rejects events from different aggregates", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const exit = yield* events
        .publishBatch({
          aggregateID,
          events: [
            { definition: First, data: first(1) },
            { definition: Second, data: { aggregateID: "agg_other", value: 2 } },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* EventV2.latestSequence(db, aggregateID)).toBe(-1)
      expect(yield* EventV2.latestSequence(db, "agg_other")).toBe(-1)
    }),
  )

  it.effect("dies with ConflictError when expectedSeq is stale", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      yield* events.publish(First, first(1))
      yield* events.publish(First, first(2))
      const exit = yield* events
        .publishBatch({
          aggregateID,
          expectedSeq: 0,
          events: [
            { definition: First, data: first(3) },
            { definition: Second, data: second(4) },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      // The stale guard left the aggregate untouched at its last committed seq.
      expect(yield* EventV2.latestSequence(db, aggregateID)).toBe(1)
    }),
  )

  it.effect("rolls back every event when a projector fails at item N", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      yield* events.project(Second, () => Effect.die(new Error("projector exploded")))
      const exit = yield* events
        .publishBatch({
          aggregateID: "agg_projector_failure",
          events: [
            { definition: First, data: { aggregateID: "agg_projector_failure", value: 1 } },
            { definition: Second, data: { aggregateID: "agg_projector_failure", value: 2 } },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* EventV2.latestSequence(db, "agg_projector_failure")).toBe(-1)
      expect(
        yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, "agg_projector_failure"))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([])
    }),
  )

  it.effect("notifies global listeners only after commit, in batch order", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const observed: string[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => observed.push(`${event.durable?.seq}:${event.type}`)),
      )
      yield* events.publishBatch({
        aggregateID: "agg_listeners",
        events: [
          { definition: First, data: { aggregateID: "agg_listeners", value: 1 } },
          { definition: Second, data: { aggregateID: "agg_listeners", value: 2 } },
        ],
      })
      yield* unsubscribe
      expect(observed).toEqual(["0:batch.first", "1:batch.second"])
    }),
  )

  it.effect("matches single-event publish behavior for one-item batches", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const batched = yield* events.publishBatch({
        aggregateID: "agg_parity",
        events: [{ definition: First, data: { aggregateID: "agg_parity", value: 7 } }],
      })
      const single = yield* events.publish(First, { aggregateID: "agg_parity", value: 8 })
      expect(batched).toHaveLength(1)
      expect(batched[0]?.durable?.seq).toBe(0)
      expect(single.durable?.seq).toBe(1)
      expect(
        yield* db
          .select({ seq: EventTable.seq, type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, "agg_parity"))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie),
      ).toEqual([
        { seq: 0, type: EventV2.versionedType(First.type, 1) },
        { seq: 1, type: EventV2.versionedType(First.type, 1) },
      ])
      expect(yield* EventV2.latestSequence(db, "agg_parity")).toBe(1)
    }),
  )

  it.effect("rejects transient definitions from a durable batch", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const exit = yield* events
        .publishBatch({
          aggregateID,
          events: [{ definition: It, data: { aggregateID, value: 1 } }],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("rejects aggregate replacement from multi-event batches", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const exit = yield* events
        .publishBatch({
          aggregateID,
          replaceAggregate: true,
          events: [
            { definition: First, data: first(1) },
            { definition: Second, data: second(2) },
          ],
        })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.effect("records local commit metadata for the whole batch result", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      let result: { firstSeq: number; finalSeq: number; count: number } | undefined
      const committed = yield* events.publishBatch({
        aggregateID: "agg_commit_result",
        events: [
          { definition: First, data: { aggregateID: "agg_commit_result", value: 1 } },
          { definition: Second, data: { aggregateID: "agg_commit_result", value: 2 } },
          { definition: First, data: { aggregateID: "agg_commit_result", value: 3 } },
        ],
        commit: ({ firstSeq, finalSeq, events: batchEvents }) =>
          Effect.sync(() => {
            result = { firstSeq, finalSeq, count: batchEvents.length }
          }),
      })
      expect(result).toEqual({ firstSeq: 0, finalSeq: 2, count: 3 })
      expect(committed).toHaveLength(3)
      // The sequence table advanced to the final batch sequence.
      const { db } = yield* Database.Service
      expect(
        yield* db
          .select({ seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, "agg_commit_result"))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ seq: 2 })
    }),
  )

  it.effect("contiguously allocates sequence numbers across a prior aggregate", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      yield* events.publish(First, { aggregateID: "agg_contiguous", value: 0 })
      yield* events.publishBatch({
        aggregateID: "agg_contiguous",
        events: [
          { definition: First, data: { aggregateID: "agg_contiguous", value: 1 } },
          { definition: Second, data: { aggregateID: "agg_contiguous", value: 2 } },
        ],
      })
      expect(
        yield* db
          .select({ seq: EventTable.seq, type: EventTable.type })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, "agg_contiguous"))
          .orderBy(EventTable.seq)
          .all()
          .pipe(Effect.orDie),
      ).toEqual([
        { seq: 0, type: EventV2.versionedType(First.type, 1) },
        { seq: 1, type: EventV2.versionedType(First.type, 1) },
        { seq: 2, type: EventV2.versionedType(Second.type, 1) },
      ])
    }),
  )
})
