import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { FileSystem, Integration, Permission, Project, Reference, Session, Workspace } from "../src"
import { EventManifest } from "../src/event-manifest"
import { IdeEvent } from "../src/ide-event"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { SessionV1 } from "../src/session-v1"
import { WorkspaceEvent } from "../src/workspace-event"

describe("public event manifest", () => {
  test("owns the complete public event surface", () => {
    expect(EventManifest.ServerDefinitions.length).toBe(93)
    expect(EventManifest.Definitions).toBe(EventManifest.ServerDefinitions)
    expect(EventManifest.Definitions.length).toBe(EventManifest.ServerDefinitions.length)
    expect(new Set(EventManifest.Definitions).size).toBe(EventManifest.Definitions.length)
    expect(SessionV1.Event.Definitions).toEqual([
      SessionV1.Event.Created,
      SessionV1.Event.Updated,
      SessionV1.Event.Deleted,
      SessionV1.Event.MessageUpdated,
      SessionV1.Event.MessageRemoved,
      SessionV1.Event.PartUpdated,
      SessionV1.Event.PartRemoved,
      SessionV1.Event.PartDelta,
      SessionV1.Event.Diff,
      SessionV1.Event.Error,
    ])
    expect(EventManifest.Latest.size).toBe(EventManifest.Definitions.length)
    expect(EventManifest.Durable.size).toBe(47)
    for (const type of [
      "session.created.1",
      "session.updated.1",
      "session.deleted.1",
      "message.updated.1",
      "message.removed.1",
      "message.part.updated.1",
      "message.part.removed.1",
    ]) {
      expect(EventManifest.Durable.has(type)).toBe(false)
    }
  })

  test("uses canonical definitions for current public events", () => {
    expect(Session.Event).toBe(SessionEvent)
    expect(Session.Event.Definitions).toBe(SessionEvent.Definitions)
    expect(Workspace.Event).toBe(WorkspaceEvent)
    expect(Workspace.Event.Definitions).toBe(WorkspaceEvent.Definitions)
    expect(EventManifest.Latest.get("session.next.step.ended")).toBe(SessionEvent.Step.Ended)
    expect(EventManifest.Latest.get("todo.updated")).toBe(SessionTodo.Event.Updated)
    expect(EventManifest.Latest.get("project.updated")).toBe(Project.Event.Updated)
    expect(Project.Event.Definitions).toEqual([Project.Event.Updated])
    expect(FileSystem.Event.Definitions).toEqual([FileSystem.Event.Edited])
    expect(Integration.Event.Definitions).toEqual([Integration.Event.Updated, Integration.Event.ConnectionUpdated])
    expect(Permission.Event.Definitions).toEqual([Permission.Event.Asked, Permission.Event.Replied])
    expect(Reference.Event.Definitions).toEqual([Reference.Event.Updated])
    expect(EventManifest.Latest.has("ide.installed")).toBe(false)
    expect(IdeEvent.Definitions).toEqual([IdeEvent.Installed])
    expect(SessionV1.Event.PartDelta.type).toBe("message.part.delta")
    expect(EventManifest.Latest.has("message.part.delta")).toBe(false)
    expect(EventManifest.Latest.has("session.created")).toBe(false)
    expect(EventManifest.Latest.has("session.updated")).toBe(false)
    expect(EventManifest.Latest.has("session.deleted")).toBe(false)
    expect(SessionV1.Event.Diff.type).toBe("session.diff")
    expect(EventManifest.Latest.has("session.diff")).toBe(false)
    expect(SessionV1.Event.Error.type).toBe("session.error")
    expect(EventManifest.Latest.has("session.error")).toBe(false)
    expect(EventManifest.Latest.get("session.next.created")).toBe(SessionEvent.Created)
    expect(EventManifest.Latest.get("session.next.updated")).toBe(SessionEvent.Updated)
    expect(EventManifest.Latest.get("session.next.deleted")).toBe(SessionEvent.Deleted)
    expect(EventManifest.Latest.get("session.next.status")).toBe(SessionEvent.Status)
    expect(EventManifest.Latest.has("session.idle")).toBe(false)
    expect(EventManifest.Latest.has("session.compacted")).toBe(false)
    expect(EventManifest.Latest.has("session.status")).toBe(false)
    for (const type of [
      "permission.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.rejected",
    ]) {
      expect(EventManifest.Latest.has(type)).toBe(false)
    }
    expect(EventManifest.Latest.get("session.next.diff")).toBe(SessionEvent.Diff)
    expect(EventManifest.Latest.get("session.next.transcript.message.removed")).toBe(
      SessionEvent.TranscriptMutation.MessageRemoved,
    )
    expect(EventManifest.Latest.get("session.next.transcript.user-text.updated")).toBe(
      SessionEvent.TranscriptMutation.UserTextUpdated,
    )
    expect(EventManifest.Latest.get("session.next.transcript.user-text.removed")).toBe(
      SessionEvent.TranscriptMutation.UserTextRemoved,
    )
    expect(EventManifest.Latest.get("session.next.transcript.content.updated")).toBe(
      SessionEvent.TranscriptMutation.ContentUpdated,
    )
    expect(EventManifest.Latest.get("session.next.transcript.content.removed")).toBe(
      SessionEvent.TranscriptMutation.ContentRemoved,
    )
    expect(EventManifest.Durable.has("session.next.step.ended.1")).toBe(false)
    expect(EventManifest.Durable.get("session.next.step.ended.2")).toBe(SessionEvent.Step.Ended)
  })

  test("publishes a minimal durable tool discovery contract", () => {
    const definition = EventManifest.Latest.get("session.next.tool-discovery.completed")
    expect(definition).toBeDefined()
    if (!definition) return
    expect(EventManifest.Durable.get("session.next.tool-discovery.completed.1")?.type).toBe(
      "session.next.tool-discovery.completed",
    )

    const encoded = {
      id: "evt_discovery",
      type: "session.next.tool-discovery.completed",
      data: {
        timestamp: 1,
        sessionID: "ses_discovery",
        assistantMessageID: "msg_discovery",
        callID: "call_search",
        query: "calendar events",
        limit: 8,
        catalogRevision: "revision",
        matches: [
          {
            key: "tool_key",
            callableName: "calendar_create",
            definitionHash: "hash",
            source: { type: "plugin", id: "calendar" },
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
          },
        ],
        pendingSources: [{ type: "mcp", id: "remote" }],
      },
    }
    expect(
      Schema.encodeUnknownSync(SessionEvent.ToolDiscovery.Completed)(
        Schema.decodeUnknownSync(SessionEvent.ToolDiscovery.Completed)(encoded),
      ),
    ).toEqual({
      id: "evt_discovery",
      type: "session.next.tool-discovery.completed",
      data: {
        timestamp: 1,
        sessionID: "ses_discovery",
        assistantMessageID: "msg_discovery",
        callID: "call_search",
        query: "calendar events",
        limit: 8,
        catalogRevision: "revision",
        matches: [
          {
            key: "tool_key",
            callableName: "calendar_create",
            definitionHash: "hash",
            source: { type: "plugin", id: "calendar" },
          },
        ],
        pendingSources: [{ type: "mcp", id: "remote" }],
      },
    })
  })
})
