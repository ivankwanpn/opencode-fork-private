export * as SessionTurn from "./turn"

import { eq, inArray } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionTurnTable, type SessionTurnStatus } from "./sql"
import type { Database } from "../database/database"

type DB = Database.Interface["db"]
type Row = typeof SessionTurnTable.$inferSelect

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("Session.TurnConflictError", {
  sessionID: SessionSchema.ID,
  reason: Schema.Literals(["already-active", "no-active", "mismatch"]),
  turnID: SessionMessage.ID.pipe(Schema.optional),
  expectedTurnID: SessionMessage.ID.pipe(Schema.optional),
}) {}

export class PendingSteerError extends Schema.TaggedErrorClass<PendingSteerError>()("Session.TurnPendingSteer", {
  sessionID: SessionSchema.ID,
  turnID: SessionMessage.ID,
}) {}

export const get = Effect.fn("SessionTurn.get")(function* (db: DB, sessionID: SessionSchema.ID) {
  return yield* db.select().from(SessionTurnTable).where(eq(SessionTurnTable.session_id, sessionID)).get().pipe(Effect.orDie)
})

export const open = Effect.fn("SessionTurn.open")(function* (db: DB) {
  return yield* db
    .select()
    .from(SessionTurnTable)
    .where(inArray(SessionTurnTable.status, ["pending", "active"]))
    .all()
    .pipe(Effect.orDie)
})

export const projectAdmitted = Effect.fn("SessionTurn.projectAdmitted")(function* (
  db: DB,
  event: SessionEvent.PromptAdmitted,
) {
  const intent = event.data.intent
  if (intent === undefined || intent.type === "queue") return
  if (event.durable === undefined) return yield* Effect.die("Turn admission event is missing aggregate sequence")

  const current = yield* get(db, event.data.sessionID)
  if (intent.type === "start") {
    if (current && current.status !== "ended")
      return yield* Effect.die(
        new ConflictError({
          sessionID: event.data.sessionID,
          reason: "already-active",
          turnID: current.turn_id,
        }),
      )
    return yield* upsert(db, event.data.sessionID, event.data.messageID, "pending", event.durable.seq, event.data.timestamp)
  }

  if (!current || current.status === "ended")
    return yield* Effect.die(
      new ConflictError({
        sessionID: event.data.sessionID,
        reason: "no-active",
        expectedTurnID: intent.expectedTurnID,
      }),
    )
  if (current.turn_id !== intent.expectedTurnID)
    return yield* Effect.die(
      new ConflictError({
        sessionID: event.data.sessionID,
        reason: "mismatch",
        turnID: current.turn_id,
        expectedTurnID: intent.expectedTurnID,
      }),
    )
  yield* db
    .update(SessionTurnTable)
    .set({ seq: event.durable.seq, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
    .where(eq(SessionTurnTable.session_id, event.data.sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const projectStarted = Effect.fn("SessionTurn.projectStarted")(function* (
  db: DB,
  event: SessionEvent.Turn.Started,
) {
  if (event.durable === undefined) return yield* Effect.die("Turn start event is missing aggregate sequence")
  const current = yield* get(db, event.data.sessionID)
  if (current && current.status !== "ended" && current.turn_id !== event.data.turnID)
    return yield* Effect.die(
      new ConflictError({
        sessionID: event.data.sessionID,
        reason: "already-active",
        turnID: current.turn_id,
      }),
    )
  yield* upsert(db, event.data.sessionID, event.data.turnID, "active", event.durable.seq, event.data.timestamp)
})

export const projectEnded = Effect.fn("SessionTurn.projectEnded")(function* (
  db: DB,
  event: SessionEvent.Turn.Ended,
) {
  if (event.durable === undefined) return yield* Effect.die("Turn end event is missing aggregate sequence")
  const current = yield* get(db, event.data.sessionID)
  if (!current || current.status === "ended") return
  if (current.turn_id !== event.data.turnID)
    return yield* Effect.die(
      new ConflictError({
        sessionID: event.data.sessionID,
        reason: "mismatch",
        turnID: current.turn_id,
        expectedTurnID: event.data.turnID,
      }),
    )
  const pending = (yield* SessionInput.pending(db, event.data.sessionID, "steer")).some(SessionInput.isTurnScoped)
  if (pending && (event.data.outcome ?? "completed") === "completed")
    return yield* Effect.die(new PendingSteerError({ sessionID: event.data.sessionID, turnID: event.data.turnID }))
  yield* db
    .update(SessionTurnTable)
    .set({ status: "ended", seq: event.durable.seq, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
    .where(eq(SessionTurnTable.session_id, event.data.sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const start = Effect.fn("SessionTurn.start")(function* (
  events: EventV2.Interface,
  input: { sessionID: SessionSchema.ID; turnID: SessionMessage.ID; timestamp?: DateTime.Utc },
) {
  yield* events.publish(SessionEvent.Turn.Started, {
    sessionID: input.sessionID,
    turnID: input.turnID,
    timestamp: input.timestamp ?? (yield* DateTime.now),
  })
})

export const end = Effect.fn("SessionTurn.end")(function* (
  events: EventV2.Interface,
  input: {
    sessionID: SessionSchema.ID
    turnID: SessionMessage.ID
    timestamp?: DateTime.Utc
    outcome?: "completed" | "failed" | "interrupted" | "abandoned"
  },
) {
  const result = yield* events
    .publish(SessionEvent.Turn.Ended, {
      sessionID: input.sessionID,
      turnID: input.turnID,
      timestamp: input.timestamp ?? (yield* DateTime.now),
      outcome: input.outcome,
    })
    .pipe(
      Effect.as(true),
      Effect.catchDefect((defect) =>
        defect instanceof PendingSteerError ? Effect.succeed(false) : Effect.die(defect),
      ),
    )
  return result
})

export const settleInterrupted = Effect.fn("SessionTurn.settleInterrupted")(function* (
  db: DB,
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly turnID: SessionMessage.ID
    readonly cutoff: number
  },
) {
  const current = yield* get(db, input.sessionID)
  if (!current || current.status === "ended" || current.turn_id !== input.turnID) return "stale" as const
  yield* Effect.forEach(
    (yield* SessionInput.pending(db, input.sessionID, "steer")).filter(
      (pending) => SessionInput.isTurnScoped(pending) && pending.admittedSeq <= input.cutoff,
    ),
    (pending) => SessionInput.cancelPending(db, input.sessionID, pending.id),
    { discard: true },
  )
  if (!(yield* end(events, { sessionID: input.sessionID, turnID: input.turnID, outcome: "interrupted" })))
    return "pending" as const
  const remaining = yield* SessionInput.pending(db, input.sessionID, "steer")
  return remaining.length > 0 ? ("restart" as const) : ("ended" as const)
})

const upsert = Effect.fn("SessionTurn.upsert")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  turnID: SessionMessage.ID,
  status: SessionTurnStatus,
  seq: number,
  timestamp: DateTime.Utc,
) {
  yield* db
    .insert(SessionTurnTable)
    .values({
      session_id: sessionID,
      turn_id: turnID,
      status,
      seq,
      time_updated: DateTime.toEpochMillis(timestamp),
    })
    .onConflictDoUpdate({
      target: SessionTurnTable.session_id,
      set: {
        turn_id: turnID,
        status,
        seq,
        time_updated: DateTime.toEpochMillis(timestamp),
      },
    })
    .run()
    .pipe(Effect.orDie)
})
