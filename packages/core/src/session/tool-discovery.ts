export * as SessionToolDiscovery from "./tool-discovery"

import { and, asc, eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import type { Database } from "../database/database"
import type { ToolCatalog } from "../tool/catalog"
import type { SessionEvent } from "./event"
import type { SessionMessage } from "./message"
import type { SessionSchema } from "./schema"
import { SessionToolDiscoveryCallTable, SessionToolDiscoveryTable } from "./sql"

type DB = Database.Interface["db"]

const sequence = (event: SessionEvent.ToolDiscovery.Completed) => {
  if (event.durable === undefined) throw new Error("Durable tool discovery event is missing aggregate sequence")
  return event.durable.seq
}

export const projectCompleted = Effect.fn("SessionToolDiscovery.projectCompleted")(function* (
  db: DB,
  event: SessionEvent.ToolDiscovery.Completed,
) {
  const seq = sequence(event)
  const time = DateTime.toEpochMillis(event.data.timestamp)
  yield* db
    .insert(SessionToolDiscoveryCallTable)
    .values({
      session_id: event.data.sessionID,
      assistant_message_id: event.data.assistantMessageID,
      tool_call_id: event.data.callID,
      query: event.data.query,
      limit: event.data.limit,
      catalog_revision: event.data.catalogRevision,
      matches: event.data.matches,
      pending_sources: event.data.pendingSources,
      seq,
      time_completed: time,
    })
    .run()
    .pipe(Effect.orDie)
  yield* Effect.forEach(
    event.data.matches,
    (match) =>
      db
        .insert(SessionToolDiscoveryTable)
        .values({
          session_id: event.data.sessionID,
          tool_key: match.key,
          definition_hash: match.definitionHash,
          callable_name: match.callableName,
          source: match.source,
          discovered_seq: seq,
          time_discovered: time,
        })
        .onConflictDoUpdate({
          target: [SessionToolDiscoveryTable.session_id, SessionToolDiscoveryTable.tool_key],
          set: {
            definition_hash: match.definitionHash,
            callable_name: match.callableName,
            source: match.source,
            discovered_seq: seq,
            time_discovered: time,
          },
        })
        .run()
        .pipe(Effect.orDie),
    { discard: true },
  )
})

export const call = Effect.fn("SessionToolDiscovery.call")(function* (
  db: DB,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly callID: string
  },
) {
  return yield* db
    .select()
    .from(SessionToolDiscoveryCallTable)
    .where(
      and(
        eq(SessionToolDiscoveryCallTable.session_id, input.sessionID),
        eq(SessionToolDiscoveryCallTable.assistant_message_id, input.assistantMessageID),
        eq(SessionToolDiscoveryCallTable.tool_call_id, input.callID),
      ),
    )
    .get()
    .pipe(Effect.orDie)
})

export const selections = Effect.fn("SessionToolDiscovery.selections")(function* (db: DB, sessionID: SessionSchema.ID) {
  const rows = yield* db
    .select({ key: SessionToolDiscoveryTable.tool_key, definitionHash: SessionToolDiscoveryTable.definition_hash })
    .from(SessionToolDiscoveryTable)
    .where(eq(SessionToolDiscoveryTable.session_id, sessionID))
    .orderBy(asc(SessionToolDiscoveryTable.tool_key))
    .all()
    .pipe(Effect.orDie)
  return new Map<ToolCatalog.Key, string>(rows.map((row) => [row.key, row.definitionHash]))
})
