import { describe, expect, test } from "bun:test"
import type { Event, ToolPart } from "@opencode-ai/sdk/v2"
import {
  removeCanonicalTool,
  updateCanonicalTool,
  type CanonicalToolEvent,
  type CanonicalToolRemovalEvent,
} from "@/cli/cmd/run/canonical-tool"

const event = (input: object) => input as Event

describe("canonical tool registry", () => {
  test("returns terminal tool state without retaining it", () => {
    const parts = new Map<string, ToolPart>()
    updateCanonicalTool(
      parts,
      event({
        type: "session.next.tool.called",
        properties: {
          timestamp: 1,
          sessionID: "session-1",
          assistantMessageID: "message-1",
          callID: "call-1",
          tool: "read",
          input: { filePath: "README.md" },
          provider: { executed: false },
        },
      }) as CanonicalToolEvent,
    )
    expect(parts.size).toBe(1)

    const completed = updateCanonicalTool(
      parts,
      event({
        type: "session.next.tool.success",
        properties: {
          timestamp: 2,
          sessionID: "session-1",
          assistantMessageID: "message-1",
          callID: "call-1",
          structured: { title: "README.md" },
          content: [{ type: "text", text: "contents" }],
          provider: { executed: false },
        },
      }) as CanonicalToolEvent,
    )

    expect(completed?.state.status).toBe("completed")
    expect(parts.size).toBe(0)
  })

  test("removes a live tool by its projected transcript identity", () => {
    const parts = new Map<string, ToolPart>()
    const running = updateCanonicalTool(
      parts,
      event({
        type: "session.next.tool.called",
        properties: {
          timestamp: 1,
          sessionID: "session-1",
          assistantMessageID: "message-1",
          callID: "call-1",
          tool: "task",
          input: {},
          provider: { executed: false },
        },
      }) as CanonicalToolEvent,
    )
    expect(running?.id).toBe("tool:message-1:call-1")

    const removed = removeCanonicalTool(
      parts,
      event({
        type: "session.next.transcript.content.removed",
        properties: {
          timestamp: 2,
          sessionID: "session-1",
          assistantMessageID: "message-1",
          contentIndex: 0,
          partID: "prt_message-1_tool_0",
        },
      }) as CanonicalToolRemovalEvent,
    )

    expect(removed).toBe(running)
    expect(parts.size).toBe(0)
  })
})
