export * as SessionAttempt from "./attempt"

import { and, eq, lte, or, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { EventTable } from "../event/sql"
import { NonNegativeInt } from "../schema"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionAttemptTable, SessionCancellationTable } from "./sql"

export const Status = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }),
  Schema.Struct({
    type: Schema.Literal("running"),
    attemptID: EventV2.ID,
    assistantMessageID: SessionMessage.ID,
    attempt: NonNegativeInt,
    phase: Schema.Literals(["dispatching", "responding"]),
  }),
  Schema.Struct({
    type: Schema.Literal("retrying"),
    attemptID: EventV2.ID,
    assistantMessageID: SessionMessage.ID,
    attempt: NonNegativeInt,
    next: Schema.Number,
    error: SessionEvent.RetryError,
  }),
  Schema.Struct({
    type: Schema.Literal("continuation-required"),
    attemptID: EventV2.ID,
    assistantMessageID: SessionMessage.ID,
    attempt: NonNegativeInt,
  }),
  Schema.Struct({
    type: Schema.Literal("recovery-required"),
    attemptID: EventV2.ID,
    assistantMessageID: SessionMessage.ID,
    attempt: NonNegativeInt,
    reason: Schema.Literals(["dispatch-unknown", "response-interrupted"]),
  }),
]).annotate({ identifier: "SessionProviderAttemptStatus" })
export type Status = typeof Status.Type

export class RecoveryRequiredError extends Schema.TaggedErrorClass<RecoveryRequiredError>()(
  "Session.RecoveryRequiredError",
  {
    sessionID: SessionSchema.ID,
    attemptID: EventV2.ID,
    reason: Schema.Literals(["dispatch-unknown", "response-interrupted"]),
  },
) {}

export class RecoveryConflictError extends Schema.TaggedErrorClass<RecoveryConflictError>()(
  "Session.RecoveryConflictError",
  {
    sessionID: SessionSchema.ID,
    attemptID: EventV2.ID,
    message: Schema.String,
  },
) {}

type DB = Database.Interface["db"]
type Row = typeof SessionAttemptTable.$inferSelect

const isCancelled = Effect.fn("SessionAttempt.isCancelled")(function* (db: DB, sessionID: SessionSchema.ID) {
  const rows = yield* db
    .all<{ root_session_id: string }>(sql`
      WITH RECURSIVE ancestors(id) AS (
        SELECT ${sessionID}
        UNION ALL
        SELECT session.parent_id
        FROM session
        JOIN ancestors ON session.id = ancestors.id
        WHERE session.parent_id IS NOT NULL
      )
      SELECT cancellation.root_session_id
      FROM ${SessionCancellationTable} cancellation
      JOIN ancestors ON ancestors.id = cancellation.root_session_id
      LIMIT 1
    `)
    .pipe(Effect.orDie)
  return rows.length > 0
})

const sequence = (event: SessionEvent.Event) => {
  if (event.durable === undefined) throw new Error("Durable Session attempt event is missing aggregate sequence")
  return event.durable.seq
}

export const get = Effect.fn("SessionAttempt.get")(function* (db: DB, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(SessionAttemptTable)
    .where(eq(SessionAttemptTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

export const recoveryDecision = Effect.fn("SessionAttempt.recoveryDecision")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  attemptID: EventV2.ID,
) {
  const rows = yield* db
    .select({ data: EventTable.data })
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, sessionID),
        eq(EventTable.type, EventV2.versionedType(SessionEvent.ProviderAttempt.Recovery.Decided.type, 1)),
      ),
    )
    .all()
    .pipe(Effect.orDie)
  const decode = Schema.decodeUnknownSync(SessionEvent.ProviderAttempt.Recovery.Decided.data)
  for (const row of rows) {
    const decision = decode(row.data)
    if (decision.attemptID === attemptID) return decision.decision
  }
  return undefined
})

export const status = Effect.fn("SessionAttempt.status")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  active: boolean,
) {
  const row = yield* get(db, sessionID)
  if (!row || row.status === "ended" || row.status === "abandoned") return Status.make({ type: "idle" })
  if (row.status === "retrying") {
    if (row.retry_at === null || row.error === null) return yield* Effect.die("Incomplete retry projection")
    return Status.make({
      type: "retrying",
      attemptID: row.attempt_id,
      assistantMessageID: row.assistant_message_id,
      attempt: row.attempt,
      next: row.retry_at,
      error: row.error,
    })
  }
  if (row.status === "continuation")
    return Status.make({
      type: "continuation-required",
      attemptID: row.attempt_id,
      assistantMessageID: row.assistant_message_id,
      attempt: row.attempt,
    })
  if (active)
    return Status.make({
      type: "running",
      attemptID: row.attempt_id,
      assistantMessageID: row.assistant_message_id,
      attempt: row.attempt,
      phase: row.status === "responding" ? "responding" : "dispatching",
    })
  return Status.make({
    type: "recovery-required",
    attemptID: row.attempt_id,
    assistantMessageID: row.assistant_message_id,
    attempt: row.attempt,
    reason: row.status === "responding" ? "response-interrupted" : "dispatch-unknown",
  })
})

export const scheduled = Effect.fn("SessionAttempt.scheduled")(function* (db: DB, now: number) {
  return yield* db
    .select({ sessionID: SessionAttemptTable.session_id })
    .from(SessionAttemptTable)
    .where(
      or(
        eq(SessionAttemptTable.status, "continuation"),
        and(eq(SessionAttemptTable.status, "retrying"), lte(SessionAttemptTable.retry_at, now)),
      ),
    )
    .all()
    .pipe(Effect.orDie)
})

export const projectStarted = Effect.fn("SessionAttempt.projectStarted")(function* (
  db: DB,
  event: SessionEvent.ProviderAttempt.Started,
) {
  if (yield* isCancelled(db, event.data.sessionID)) return
  yield* db
    .insert(SessionAttemptTable)
    .values({
      session_id: event.data.sessionID,
      attempt_id: event.data.attemptID,
      assistant_message_id: event.data.assistantMessageID,
      status: "started",
      attempt: event.data.attempt,
      retry_of: event.data.retryOf,
      seq: sequence(event),
      time_updated: DateTime.toEpochMillis(event.data.timestamp),
    })
    .onConflictDoUpdate({
      target: SessionAttemptTable.session_id,
      set: {
        attempt_id: event.data.attemptID,
        assistant_message_id: event.data.assistantMessageID,
        status: "started",
        attempt: event.data.attempt,
        retry_of: event.data.retryOf ?? null,
        retry_at: null,
        error: null,
        decision: null,
        seq: sequence(event),
        time_updated: DateTime.toEpochMillis(event.data.timestamp),
      },
    })
    .run()
    .pipe(Effect.orDie)
})

export const projectResponseStarted = Effect.fn("SessionAttempt.projectResponseStarted")(function* (
  db: DB,
  event: SessionEvent.ProviderAttempt.ResponseStarted,
) {
  if (yield* isCancelled(db, event.data.sessionID)) return
  yield* db
    .update(SessionAttemptTable)
    .set({
      status: "responding",
      seq: sequence(event),
      time_updated: DateTime.toEpochMillis(event.data.timestamp),
    })
    .where(
      and(
        eq(SessionAttemptTable.session_id, event.data.sessionID),
        eq(SessionAttemptTable.attempt_id, event.data.attemptID),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const projectEnded = Effect.fn("SessionAttempt.projectEnded")(function* (
  db: DB,
  event: SessionEvent.ProviderAttempt.Ended,
) {
  if (yield* isCancelled(db, event.data.sessionID)) return
  yield* db
    .update(SessionAttemptTable)
    .set({
      status: event.data.continuation ? "continuation" : event.data.outcome === "abandoned" ? "abandoned" : "ended",
      error: event.data.error ? { message: event.data.error.message, isRetryable: false } : null,
      seq: sequence(event),
      time_updated: DateTime.toEpochMillis(event.data.timestamp),
    })
    .where(
      and(
        eq(SessionAttemptTable.session_id, event.data.sessionID),
        eq(SessionAttemptTable.attempt_id, event.data.attemptID),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const projectRetried = Effect.fn("SessionAttempt.projectRetried")(function* (
  db: DB,
  event: SessionEvent.Retried,
) {
  if (yield* isCancelled(db, event.data.sessionID)) return
  yield* db
    .update(SessionAttemptTable)
    .set({
      status: "retrying",
      attempt: event.data.attempt,
      retry_at: DateTime.toEpochMillis(event.data.next),
      error: event.data.error,
      seq: sequence(event),
      time_updated: DateTime.toEpochMillis(event.data.timestamp),
    })
    .where(
      and(
        eq(SessionAttemptTable.session_id, event.data.sessionID),
        eq(SessionAttemptTable.attempt_id, event.data.attemptID),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const projectRecoveryDecided = Effect.fn("SessionAttempt.projectRecoveryDecided")(function* (
  db: DB,
  event: SessionEvent.ProviderAttempt.Recovery.Decided,
) {
  if (yield* isCancelled(db, event.data.sessionID)) return
  yield* db
    .update(SessionAttemptTable)
    .set({
      status: event.data.decision === "retry" ? "continuation" : "abandoned",
      decision: event.data.decision,
      retry_of: event.data.decision === "retry" ? event.data.attemptID : null,
      attempt: event.data.decision === "retry" ? sql`${SessionAttemptTable.attempt} + 1` : SessionAttemptTable.attempt,
      seq: sequence(event),
      time_updated: DateTime.toEpochMillis(event.data.timestamp),
    })
    .where(
      and(
        eq(SessionAttemptTable.session_id, event.data.sessionID),
        eq(SessionAttemptTable.attempt_id, event.data.attemptID),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

export const row = (value: Row) => value
