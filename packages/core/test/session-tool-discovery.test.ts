import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { DateTime, Effect, Exit } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionToolDiscovery } from "@opencode-ai/core/session/tool-discovery"
import { SessionTable, SessionToolDiscoveryCallTable, SessionToolDiscoveryTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node])))
const sessionID = SessionV2.ID.make("ses_tool_discovery_test")
const assistantMessageID = SessionMessage.ID.make("msg_tool_discovery_test")
const calendarKey = SessionEvent.ToolDiscovery.Key.make("tool_calendar")
const chatKey = SessionEvent.ToolDiscovery.Key.make("tool_chat")

const setup = Effect.gen(function* () {
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
      slug: "tool-discovery",
      directory: "/project",
      title: "tool discovery",
      version: "test",
    })
    .run()
  return db
})

const completed = (input: {
  callID: string
  query: string
  matches?: ReadonlyArray<SessionEvent.ToolDiscovery.Match>
  pendingSources?: ReadonlyArray<SessionEvent.ToolDiscovery.Source>
  timestamp?: number
}) => ({
  sessionID,
  assistantMessageID,
  timestamp: DateTime.makeUnsafe(input.timestamp ?? 1),
  callID: input.callID,
  query: input.query,
  limit: 8,
  catalogRevision: `revision-${input.callID}`,
  matches: input.matches ?? [],
  pendingSources: input.pendingSources ?? [],
})

describe("Session tool discovery projection", () => {
  it.effect("projects invocations and unions discovered identities without storing schemas", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const events = yield* EventV2.Service
      yield* events.publish(
        SessionEvent.ToolDiscovery.Completed,
        completed({
          callID: "call-calendar",
          query: "calendar events",
          matches: [
            {
              key: calendarKey,
              callableName: "calendar_create",
              definitionHash: "calendar-v1",
              source: { type: "plugin", id: "calendar" },
            },
          ],
        }),
      )
      yield* events.publish(
        SessionEvent.ToolDiscovery.Completed,
        completed({
          callID: "call-chat",
          query: "chat history",
          timestamp: 2,
          matches: [
            {
              key: calendarKey,
              callableName: "calendar_create",
              definitionHash: "calendar-v2",
              source: { type: "plugin", id: "calendar" },
            },
            {
              key: chatKey,
              callableName: "chat_search",
              definitionHash: "chat-v1",
              source: { type: "mcp", id: "chat" },
            },
          ],
        }),
      )
      yield* events.publish(
        SessionEvent.ToolDiscovery.Completed,
        completed({
          callID: "call-empty",
          query: "missing tool",
          timestamp: 3,
          pendingSources: [{ type: "mcp", id: "remote", displayName: "Remote MCP" }],
        }),
      )

      expect(
        yield* db.select().from(SessionToolDiscoveryCallTable).orderBy(asc(SessionToolDiscoveryCallTable.seq)).all(),
      ).toEqual([
        expect.objectContaining({
          session_id: sessionID,
          assistant_message_id: assistantMessageID,
          tool_call_id: "call-calendar",
          query: "calendar events",
          limit: 8,
          catalog_revision: "revision-call-calendar",
          matches: [
            {
              key: calendarKey,
              callableName: "calendar_create",
              definitionHash: "calendar-v1",
              source: { type: "plugin", id: "calendar" },
            },
          ],
          pending_sources: [],
          seq: 0,
          time_completed: 1,
        }),
        expect.objectContaining({ tool_call_id: "call-chat", seq: 1, time_completed: 2 }),
        expect.objectContaining({
          tool_call_id: "call-empty",
          matches: [],
          pending_sources: [{ type: "mcp", id: "remote", displayName: "Remote MCP" }],
          seq: 2,
          time_completed: 3,
        }),
      ])
      expect(
        yield* db.select().from(SessionToolDiscoveryTable).orderBy(asc(SessionToolDiscoveryTable.tool_key)).all(),
      ).toEqual([
        {
          session_id: sessionID,
          tool_key: calendarKey,
          definition_hash: "calendar-v2",
          callable_name: "calendar_create",
          source: { type: "plugin", id: "calendar" },
          discovered_seq: 1,
          time_discovered: 2,
        },
        {
          session_id: sessionID,
          tool_key: chatKey,
          definition_hash: "chat-v1",
          callable_name: "chat_search",
          source: { type: "mcp", id: "chat" },
          discovered_seq: 1,
          time_discovered: 2,
        },
      ])
      expect(
        yield* SessionToolDiscovery.call(db, {
          sessionID,
          assistantMessageID,
          callID: "call-calendar",
        }),
      ).toMatchObject({ query: "calendar events", catalog_revision: "revision-call-calendar" })
      expect(yield* SessionToolDiscovery.selections(db, sessionID)).toEqual(
        new Map([
          [calendarKey, "calendar-v2"],
          [chatKey, "chat-v1"],
        ]),
      )
    }),
  )

  it.effect("rejects a conflicting fresh invocation and preserves the first projection", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const events = yield* EventV2.Service
      yield* events.publish(
        SessionEvent.ToolDiscovery.Completed,
        completed({ callID: "call-conflict", query: "calendar" }),
      )
      const duplicate = yield* Effect.exit(
        events.publish(
          SessionEvent.ToolDiscovery.Completed,
          completed({ callID: "call-conflict", query: "different query", timestamp: 2 }),
        ),
      )

      expect(Exit.isFailure(duplicate)).toBe(true)
      expect(yield* db.select().from(SessionToolDiscoveryCallTable).all()).toHaveLength(1)
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, sessionID)).all()).toHaveLength(1)
    }),
  )

  it.effect("keeps exact replay idempotent and cascades projections with the session", () =>
    Effect.gen(function* () {
      const db = yield* setup
      const events = yield* EventV2.Service
      const published = yield* events.publish(
        SessionEvent.ToolDiscovery.Completed,
        completed({
          callID: "call-replay",
          query: "calendar",
          matches: [
            {
              key: calendarKey,
              callableName: "calendar_create",
              definitionHash: "calendar-v1",
              source: { type: "plugin", id: "calendar" },
            },
          ],
        }),
      )
      const row = yield* db.select().from(EventTable).where(eq(EventTable.id, published.id)).get()
      yield* events.replay({
        id: row!.id,
        type: row!.type,
        aggregateID: row!.aggregate_id,
        seq: row!.seq,
        data: row!.data,
      })

      expect(yield* db.select().from(SessionToolDiscoveryCallTable).all()).toHaveLength(1)
      expect(yield* db.select().from(SessionToolDiscoveryTable).all()).toHaveLength(1)
      yield* db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
      expect(yield* db.select().from(SessionToolDiscoveryCallTable).all()).toEqual([])
      expect(yield* db.select().from(SessionToolDiscoveryTable).all()).toEqual([])
    }),
  )
})
