export * as SessionToolDiscovery from "./tool-discovery"

import { and, asc, eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { ToolDefinition, ToolDiscovery } from "@opencode-ai/llm"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import type { ToolCatalog } from "../tool/catalog"
import { Tool } from "../tool/tool"
import { ToolSearch } from "../tool/tool-search"
import { SessionEvent } from "./event"
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

export const records = Effect.fn("SessionToolDiscovery.records")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  snapshot: ToolCatalog.Snapshot,
) {
  const rows = yield* db
    .select()
    .from(SessionToolDiscoveryCallTable)
    .where(eq(SessionToolDiscoveryCallTable.session_id, sessionID))
    .orderBy(asc(SessionToolDiscoveryCallTable.seq))
    .all()
    .pipe(Effect.orDie)
  const current = new Map(snapshot.tools.map((tool) => [tool.key, tool]))
  return rows.map((row) =>
    ToolDiscovery.make({
      assistantMessageID: row.assistant_message_id,
      callID: row.tool_call_id,
      query: row.query,
      limit: row.limit,
      catalogRevision: row.catalog_revision,
      tools: row.matches.flatMap((match) => {
        const tool = current.get(match.key)
        if (!tool || tool.definitionHash !== match.definitionHash || tool.exposure !== "deferred") return []
        return [
          ToolDefinition.make({
            name: tool.callableName,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
            deferLoading: true,
            ...(tool.namespace === undefined ? {} : { namespace: tool.namespace }),
          }),
        ]
      }),
    }),
  )
})

export const execute = Effect.fn("SessionToolDiscovery.execute")(function* (input: {
  readonly db: DB
  readonly events: EventV2.Interface
  readonly context: Tool.Context
  readonly input: { readonly query: string; readonly limit?: number }
  readonly snapshot: ToolCatalog.Snapshot
  readonly search: Effect.Effect<ToolSearch.Result, ToolSearch.SearchError>
}) {
  const normalized = yield* ToolSearch.normalize(input.input).pipe(
    Effect.mapError((error) => new Tool.Failure({ message: error.message })),
  )
  const existing = yield* call(input.db, {
    sessionID: input.context.sessionID,
    assistantMessageID: input.context.assistantMessageID,
    callID: input.context.toolCallID,
  })
  if (existing) {
    if (existing.query !== normalized.query || existing.limit !== normalized.limit)
      return yield* new Tool.Failure({ message: "tool_search invocation conflicts with its durable result" })
    const matches = yield* Effect.forEach(existing.matches, (match) => {
      const current = input.snapshot.tools.find(
        (tool) =>
          tool.key === match.key && tool.definitionHash === match.definitionHash && tool.exposure === "deferred",
      )
      return current
        ? Effect.succeed(ToolSearch.loadable(current))
        : Effect.fail(
            new Tool.Failure({
              message: "tool_search durable result is stale; issue a new tool_search call before using this tool",
            }),
          )
    })
    return {
      query: existing.query,
      catalogRevision: existing.catalog_revision,
      matches,
      pendingSources: existing.pending_sources.map((source) => ({ source, state: "pending" as const })),
    }
  }

  const result = yield* input.search.pipe(Effect.mapError((error) => new Tool.Failure({ message: error.message })))
  yield* input.events.publish(SessionEvent.ToolDiscovery.Completed, {
    sessionID: input.context.sessionID,
    assistantMessageID: input.context.assistantMessageID,
    timestamp: yield* DateTime.now,
    callID: input.context.toolCallID,
    query: normalized.query,
    limit: normalized.limit,
    catalogRevision: result.catalogRevision,
    matches: result.matches.map((match) => ({
      key: match.key,
      callableName: match.callableName,
      definitionHash: match.definitionHash,
      source: match.source,
    })),
    pendingSources: result.pendingSources.map((status) => status.source),
  })
  return result
})
