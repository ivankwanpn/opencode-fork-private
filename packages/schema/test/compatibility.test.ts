import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { FileSystem } from "../src/filesystem"
import type { McpProvenance } from "../src/llm"
import { SessionMessage } from "../src/session-message"

describe("schema compatibility", () => {
  test("moved class schemas remain constructible", () => {
    const input = new FileSystem.FindInput({ query: "src" })
    expect(input).toBeInstanceOf(FileSystem.FindInput)
    expect(input.query).toBe("src")
  })

  test("legacy Session messages decode without MCP provenance", () => {
    const encoded: Schema.Codec.Encoded<typeof SessionMessage.Message> = {
      id: "msg_legacy_tool_content",
      type: "assistant",
      agent: "build",
      model: { id: "fake-model", providerID: "fake-provider" },
      content: [
        {
          type: "tool",
          id: "call-legacy",
          name: "legacy",
          state: {
            status: "completed",
            input: {},
            content: [
              { type: "text", text: "Legacy text" },
              { type: "file", uri: "file:///legacy.txt", mime: "text/plain", name: "legacy.txt" },
            ],
            structured: {},
          },
          time: { created: 1, ran: 2, completed: 3 },
        },
      ],
      time: { created: 1, completed: 3 },
    }
    const decoded = Schema.decodeUnknownSync(SessionMessage.Message)(encoded)

    expect(Schema.encodeSync(SessionMessage.Message)(decoded)).toEqual(encoded)
    if (decoded.type !== "assistant") throw new Error("Expected assistant message")
    const tool = decoded.content[0]
    if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("Expected completed tool")
    expect(tool.state.content.every((part) => part.provenance === undefined)).toBe(true)
  })

  test("encoded Session messages retain every MCP provenance field", () => {
    const provenance: McpProvenance = {
      type: "mcp",
      clientName: "docs",
      uri: "mcp://docs/resource",
      kind: "resource",
      mime: "text/plain",
      name: "resource.txt",
      description: "Resource description",
      size: 42,
      annotations: { audience: ["assistant"], priority: 0.75 },
      meta: {
        result: { trace: "result" },
        content: { trace: "content" },
        resource: { trace: "resource" },
      },
    }
    const linkProvenance: McpProvenance = {
      ...provenance,
      uri: "mcp://docs/link",
      kind: "resource_link",
      mime: "application/pdf",
      name: "link.pdf",
      description: "Linked resource",
      size: 128,
    }
    const encoded: Schema.Codec.Encoded<typeof SessionMessage.Message> = {
      id: "msg_mcp_tool_content",
      type: "assistant",
      agent: "build",
      model: { id: "fake-model", providerID: "fake-provider" },
      content: [
        {
          type: "tool",
          id: "call-mcp",
          name: "docs_read",
          state: {
            status: "completed",
            input: { uri: "mcp://docs/resource" },
            content: [
              { type: "text", text: "Resource text", provenance },
              {
                type: "file",
                uri: "data:application/pdf;base64,AQID",
                mime: "application/pdf",
                name: "link.pdf",
                provenance: linkProvenance,
              },
            ],
            structured: { server: "docs" },
          },
          time: { created: 1, ran: 2, completed: 3 },
        },
      ],
      time: { created: 1, completed: 3 },
    }
    const decoded = Schema.decodeUnknownSync(SessionMessage.Message)(encoded)

    expect(Schema.encodeSync(SessionMessage.Message)(decoded)).toEqual(encoded)
    if (decoded.type !== "assistant") throw new Error("Expected assistant message")
    const tool = decoded.content[0]
    if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("Expected completed tool")
    const encodedTool = encoded.type === "assistant" ? encoded.content[0] : undefined
    if (encodedTool?.type !== "tool" || encodedTool.state.status !== "completed")
      throw new Error("Expected encoded completed tool")
    expect(tool.state.content).toEqual(encodedTool.state.content)
  })
})
