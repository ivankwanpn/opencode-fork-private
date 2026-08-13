import { DateTime, Effect } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { fromRow } from "./info"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"
import { NotFoundError } from "./command"

export type SnapshotTransform = (
  snapshot: SessionEvent.SessionSnapshot,
  timestamp: DateTime.Utc,
) => SessionEvent.SessionSnapshot

export function rowToSnapshot(row: typeof SessionTable.$inferSelect): SessionEvent.SessionSnapshot {
  const info = fromRow(row)
  return SessionEvent.SessionSnapshot.make({
    id: info.id,
    parentID: info.parentID,
    projectID: info.projectID,
    slug: row.slug,
    version: row.version,
    agent: info.agent,
    model: info.model,
    cost: info.cost,
    tokens: info.tokens,
    time: info.time,
    title: info.title,
    metadata: row.metadata ?? undefined,
    share: info.share,
    permission: row.permission ? [...row.permission] : undefined,
    location: info.location,
    subpath: info.subpath,
    revert: info.revert,
  })
}

export function mutateSession(
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  next: SnapshotTransform,
) {
  const attempt = Effect.gen(function* () {
    // Invariant: the aggregate sequence must be read before the session row.
    // Any commit between the two reads makes expectedSeq stale and the publish
    // conflicts, so the retry re-reads both; reading the row first would let an
    // old snapshot pair with a fresh sequence and pass the CAS, silently
    // overwriting the newer mutation's projection.
    const expectedSeq = yield* EventV2.latestSequence(db, sessionID)
    const row = yield* db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFoundError({ sessionID })
    const timestamp = yield* DateTime.now
    const info = next(rowToSnapshot(row), timestamp)
    yield* events.publish(
      SessionEvent.Updated,
      { timestamp, sessionID, info },
      { location: fromRow(row).location, expectedSeq },
    )
    const fresh = yield* db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!fresh) return yield* new NotFoundError({ sessionID })
    return fromRow(fresh)
  })
  const retry = (remaining: number): Effect.Effect<SessionSchema.Info, NotFoundError> =>
    attempt.pipe(
      Effect.catchDefect((defect) =>
        defect instanceof EventV2.ConflictError && remaining > 0 ? retry(remaining - 1) : Effect.die(defect),
      ),
    )
  return retry(32)
}
