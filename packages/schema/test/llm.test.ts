import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ToolContent } from "../src/llm"

describe("ToolContent", () => {
  test("encodes and decodes MCP provenance for text and files", () => {
    const content = [
      {
        type: "text" as const,
        text: "MCP text",
        provenance: {
          type: "mcp" as const,
          clientName: "docs",
          uri: "mcp://docs/text",
          kind: "resource" as const,
          mime: "text/plain",
          name: "text.txt",
          description: "Text resource",
          size: 12,
          annotations: { audience: ["assistant"] },
          meta: {
            result: { trace: "result" },
            content: { trace: "content" },
            resource: { trace: "resource" },
          },
        },
      },
      {
        type: "file" as const,
        uri: "mcp://docs/file",
        mime: "application/pdf",
        name: "file.pdf",
        provenance: {
          type: "mcp" as const,
          clientName: "docs",
          uri: "mcp://docs/file",
          kind: "resource_link" as const,
          mime: "application/pdf",
          name: "file.pdf",
          description: "File resource",
          size: 42,
          annotations: { priority: 1 },
          meta: {
            result: { trace: "result" },
            content: { trace: "content" },
            resource: { trace: "resource" },
          },
        },
      },
    ]
    const encoded = Schema.encodeSync(Schema.Array(ToolContent))(content)
    const decoded = Schema.decodeUnknownSync(Schema.Array(ToolContent))(encoded)

    expect(decoded).toEqual(encoded)
    expect(decoded[0]?.provenance?.meta).toEqual({
      result: { trace: "result" },
      content: { trace: "content" },
      resource: { trace: "resource" },
    })
  })

  test("preserves legacy content without provenance", () => {
    const legacy = [
      { type: "text" as const, text: "Legacy text" },
      { type: "file" as const, uri: "file:///legacy.txt", mime: "text/plain", name: "legacy.txt" },
    ]
    const encoded = Schema.encodeSync(Schema.Array(ToolContent))(legacy)

    expect(encoded).toEqual(legacy)
    expect(encoded[0]).not.toHaveProperty("provenance")
    expect(encoded[1]).not.toHaveProperty("provenance")
  })
})
