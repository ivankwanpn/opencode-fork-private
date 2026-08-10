export * as SessionInput from "./input"

import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm"
import { DateTime, Effect, Queue, Schema, Stream } from "effect"
import { Admitted, Delivery, Intent, Synthetic, SyntheticScope } from "@opencode-ai/schema/session-input"
import type { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionAttemptTable, SessionInputTable, SessionMessageTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery, Intent, Synthetic, SyntheticScope }

const StoredPrompt = Schema.Union([
  Prompt,
  Schema.Struct({
    type: Schema.Literal("synthetic"),
    prompt: Prompt,
    description: Schema.String,
    scope: SyntheticScope.pipe(Schema.optional),
  }),
])
const decodeStoredPrompt = Schema.decodeUnknownSync(StoredPrompt)
const encodeStoredPrompt = Schema.encodeSync(StoredPrompt)
const encodePrompt = Schema.encodeSync(Prompt)

const decodeRowPrompt = (value: unknown) => {
  const stored = decodeStoredPrompt(value)
  if ("type" in stored)
    return {
      prompt: stored.prompt,
      synthetic: Synthetic.make({ description: stored.description, scope: stored.scope ?? "session" }),
    }
  return { prompt: stored }
}

const encodeRowPrompt = (prompt: Prompt, synthetic?: Synthetic) =>
  encodeStoredPrompt(
    synthetic
      ? { type: "synthetic", prompt, description: synthetic.description, scope: synthetic.scope ?? "session" }
      : prompt,
  )

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted => {
  const stored = decodeRowPrompt(row.prompt)
  return Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: stored.prompt,
    synthetic: stored.synthetic,
    delivery: row.delivery,
    ...(row.intent === null ? {} : { intent: row.intent }),
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })
}

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const findForSession = Effect.fn("SessionInput.findForSession")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.id, id), eq(SessionInputTable.session_id, sessionID)))
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const pending = Effect.fn("SessionInput.pending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery?: Delivery,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
        delivery === undefined ? undefined : eq(SessionInputTable.delivery, delivery),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return rows.map(fromRow)
})

export const isTurnScoped = (input: Pick<Admitted, "synthetic">) =>
  input.synthetic === undefined || input.synthetic.scope === "turn"

export const isSessionScoped = (input: Pick<Admitted, "synthetic">) =>
  input.synthetic !== undefined && input.synthetic.scope !== "turn"

export const waitForPending = Effect.fn("SessionInput.waitForPending")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly delivery: Delivery
    readonly includeSynthetic?: boolean
  },
) {
  const matches = (value: { readonly synthetic?: Synthetic }) => input.includeSynthetic !== false || !value.synthetic
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const activity = yield* Queue.sliding<void>(1)
      yield* events.subscribe(SessionEvent.PromptAdmitted).pipe(
        Stream.filter(
          (event) =>
            event.data.sessionID === input.sessionID && event.data.delivery === input.delivery && matches(event.data),
        ),
        Stream.runForEach(() => Queue.offer(activity, undefined)),
        Effect.forkScoped({ startImmediately: true }),
      )
      const wait = (): Effect.Effect<void> =>
        pending(db, input.sessionID, input.delivery).pipe(
          Effect.flatMap((items) =>
            items.some(matches) ? Effect.void : Queue.take(activity).pipe(Effect.andThen(Effect.suspend(wait))),
          ),
        )
      return yield* wait()
    }),
  )
})

export const latestPromoted = Effect.fn("SessionInput.latestPromoted")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), isNotNull(SessionInputTable.promoted_seq)))
    .orderBy(desc(SessionInputTable.promoted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export const latestPromotedAtOrBefore = Effect.fn("SessionInput.latestPromotedAtOrBefore")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  seq: number,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNotNull(SessionInputTable.promoted_seq),
        lte(SessionInputTable.promoted_seq, seq),
        isNull(SessionInputTable.terminal_outcome),
      ),
    )
    .orderBy(desc(SessionInputTable.promoted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly synthetic?: Synthetic
    readonly delivery: Delivery
    readonly intent?: Intent
    readonly expectedActiveAttemptID?: EventV2.ID
    readonly commit?: (seq: number) => Effect.Effect<void>
  },
) {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      synthetic: input.synthetic,
      delivery: input.delivery,
      intent: input.intent,
    },
    input.commit ? { commit: input.commit } : undefined,
    )
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                synthetic: input.synthetic,
                delivery: input.delivery,
                ...(input.intent === undefined ? {} : { intent: input.intent }),
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly synthetic?: Synthetic
    readonly delivery: Delivery
    readonly intent?: Intent
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      prompt: encodeRowPrompt(input.prompt, input.synthetic),
      delivery: input.delivery,
      intent: input.intent,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly synthetic?: Synthetic
    readonly delivery: Delivery
    readonly intent?: Intent
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodeRowPrompt(input.prompt, input.synthetic),
      delivery: input.delivery,
      intent: input.intent,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const cancelPending = Effect.fn("SessionInput.cancelPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
) {
  const time = yield* DateTime.now
  const terminalSeq = yield* EventV2.latestSequence(db, sessionID)
  const updated = yield* db
    .update(SessionInputTable)
    .set({
      terminal_outcome: "cancelled",
      terminal_message_id: null,
      terminal_error: { message: "Input cancelled by user" },
      terminal_time: DateTime.toEpochMillis(time),
      terminal_seq: terminalSeq,
    })
    .where(
      and(
        eq(SessionInputTable.id, id),
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
      ),
    )
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (updated) return "cancelled" as const

  const stored = yield* db
    .select({
      promotedSeq: SessionInputTable.promoted_seq,
      terminalOutcome: SessionInputTable.terminal_outcome,
    })
    .from(SessionInputTable)
    .where(and(eq(SessionInputTable.id, id), eq(SessionInputTable.session_id, sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (stored === undefined) return "missing" as const
  if (stored.terminalOutcome !== null) return "terminal" as const
  if (stored.promotedSeq !== null) return "promoted" as const
  return yield* Effect.die(`Pending input was not terminalized: ${id}`)
})

export const startupCandidates = Effect.fn("SessionInput.startupCandidates")(function* (db: DatabaseService) {
  return yield* db
    .selectDistinct({ sessionID: SessionInputTable.session_id })
    .from(SessionInputTable)
    .leftJoin(SessionAttemptTable, eq(SessionAttemptTable.session_id, SessionInputTable.session_id))
    .where(
      or(
        and(
          isNull(SessionInputTable.promoted_seq),
          isNull(SessionInputTable.terminal_outcome),
        ),
        and(
          isNotNull(SessionInputTable.promoted_seq),
          isNull(SessionInputTable.terminal_outcome),
          or(isNull(SessionAttemptTable.seq), gt(SessionInputTable.promoted_seq, SessionAttemptTable.seq)),
        ),
      ),
    )
    .all()
    .pipe(Effect.orDie)
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly synthetic?: Synthetic
    readonly delivery: Delivery
    readonly intent?: Intent
  },
) =>
  input.delivery === expected.delivery &&
  matchesPrompt(input, expected) &&
  sameSynthetic(input.synthetic, expected.synthetic) &&
  sameIntent(input.intent, expected.intent)

export const samePrompt = (left: Prompt, right: Prompt) =>
  JSON.stringify(encodePrompt(left)) === JSON.stringify(encodePrompt(right))

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID && samePrompt(input.prompt, expected.prompt)

const sameSynthetic = (left: Synthetic | undefined, right: Synthetic | undefined) =>
  left?.description === right?.description &&
  (left?.scope === undefined || right?.scope === undefined || left.scope === right.scope)

const sameIntent = (left: Intent | undefined, right: Intent | undefined) =>
  JSON.stringify(left) === JSON.stringify(right)

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly synthetic?: Synthetic
    readonly delivery: Delivery
    readonly intent?: Intent
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
) {
  for (const row of rows) {
    const id = SessionMessage.ID.make(row.id)
    const stored = decodeRowPrompt(row.prompt)
    yield* events
      .publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        messageID: id,
        prompt: stored.prompt,
        synthetic: stored.synthetic,
        delivery: row.delivery,
        intent: row.intent === null ? undefined : row.intent,
      })
      .pipe(
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, id).pipe(
                Effect.flatMap((stored) => (stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.void)),
              )
            : Effect.die(defect),
        ),
      )
  }
  return rows.length
})

export const promote = Effect.fn("SessionInput.promote")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.id, id),
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.as(true))
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
) {
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        isNull(SessionInputTable.terminal_outcome),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : yield* publish(db, events, sessionID, [row]).pipe(Effect.as(true))
})
