import { describe, expect } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { CallToolResult, Tool as MCPToolDefinition } from "@modelcontextprotocol/sdk/types.js"
import { AgentV2 } from "@opencode-ai/core/agent"
import { McpCatalog } from "@opencode-ai/core/mcp"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect } from "effect"
import { it } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_mcp_catalog")
const assistantMessageID = SessionMessage.ID.make("msg_mcp_catalog")
const agent = AgentV2.ID.make("build")
const context: Tool.Context = {
  sessionID,
  assistantMessageID,
  agent,
  toolCallID: "call_mcp",
}

function entry(
  result: CallToolResult,
  definition: MCPToolDefinition = {
    name: "inspect",
    description: "Inspect an item",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    outputSchema: {
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
    },
  },
): McpCatalog.McpTool {
  return {
    clientName: "server",
    def: definition,
    client: {
      callTool: () => Promise.resolve(result),
    } as unknown as Client,
    timeout: 1234,
  }
}

describe("MCP catalog", () => {
  it.effect("paginates in order and rejects duplicate cursors", () =>
    Effect.gen(function* () {
      const pages = new Map<string | undefined, { items: number[]; nextCursor?: string }>([
        [undefined, { items: [1], nextCursor: "next" }],
        ["next", { items: [2] }],
      ])
      expect(
        yield* Effect.promise(() =>
          McpCatalog.paginate(
            (cursor) => Promise.resolve(pages.get(cursor)!),
            (x) => x.items,
          ),
        ),
      ).toEqual([1, 2])

      const duplicate = McpCatalog.paginate(
        () => Promise.resolve({ items: [] as number[], nextCursor: "same" }),
        (x) => x.items,
      )
      const failure = yield* Effect.flip(
        Effect.tryPromise({
          try: () => duplicate,
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }),
      )
      expect(failure.message).toContain("duplicate cursor")
    }),
  )

  it.effect("produces valid deterministic names for arbitrary MCP identifiers", () =>
    Effect.sync(() => {
      expect(McpCatalog.toolName("my server", "read:item")).toBe("my_server_read_item")
      expect(McpCatalog.toolName("123", "run")).toBe("mcp_123_run")
      const long = McpCatalog.toolName("server", "x".repeat(100))
      expect(long).toHaveLength(64)
      expect(long).toBe(McpCatalog.toolName("server", "x".repeat(100)))
      expect(long).not.toBe(McpCatalog.toolName("server", "y".repeat(100)))
    }),
  )

  it.effect("preserves native schemas and projects structured text and media output", () =>
    Effect.gen(function* () {
      const tool = McpCatalog.toCoreTool(
        entry({
          content: [
            { type: "text", text: "done" },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          ],
          structuredContent: { answer: 42 },
        }),
      )
      const definition = Tool.definition("server_inspect", tool)!
      expect(definition.inputSchema).toMatchObject({
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
        additionalProperties: false,
      })
      expect(definition.outputSchema).toMatchObject({
        type: "object",
        required: ["answer"],
      })

      expect(
        yield* Tool.settle(
          tool,
          { type: "tool-call", id: "call_mcp", name: "server_inspect", input: { id: "x" } },
          context,
        ),
      ).toEqual({
        structured: { answer: 42 },
        content: [
          { type: "text", text: "done" },
          { type: "file", uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: undefined },
        ],
      })
    }),
  )

  it.effect("projects MCP resources with exact provenance and opaque metadata", () =>
    Effect.sync(() => {
      const result: CallToolResult = {
        _meta: { result: "meta" },
        content: [
          { type: "text", text: "generic text" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
          { type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" },
          {
            type: "resource",
            resource: {
              uri: "mcp://server/item",
              mimeType: "text/plain",
              text: "resource text",
              _meta: { resource: "meta" },
            },
            annotations: { audience: ["assistant"], priority: 1 },
            _meta: { content: "meta" },
          },
          {
            type: "resource",
            resource: { uri: "mcp://server/blob.pdf", mimeType: "application/pdf", blob: "aGVsbG8=" },
          },
          {
            type: "resource_link",
            uri: "mcp://server/link",
            name: "Linked resource",
            description: "Complete link description",
            mimeType: "application/pdf",
            size: 5,
            annotations: { audience: ["user"], lastModified: "2026-07-24T00:00:00Z" },
            _meta: { link: "meta" },
          },
        ],
        structuredContent: { answer: 42 },
      }

      const projection = McpCatalog.projectResult("server", result)
      const [genericText, genericImage, genericAudio, resource, blob, link] = projection.content
      expect(projection.content.map((item) => item.type)).toEqual(["text", "file", "file", "text", "file", "text"])
      expect(genericText).toEqual({ type: "text", text: "generic text" })
      expect(genericImage).toEqual({ type: "file", data: "aW1hZ2U=", mime: "image/png" })
      expect(genericAudio).toEqual({ type: "file", data: "YXVkaW8=", mime: "audio/wav" })
      expect(genericImage).not.toHaveProperty("provenance")
      expect(genericAudio).not.toHaveProperty("provenance")
      expect(resource).toMatchObject({
        type: "text",
        text: "resource text",
        provenance: {
          type: "mcp",
          clientName: "server",
          uri: "mcp://server/item",
          kind: "resource",
          mime: "text/plain",
          annotations: { audience: ["assistant"], priority: 1 },
          meta: {
            result: { result: "meta" },
            content: { content: "meta" },
            resource: { resource: "meta" },
          },
        },
      })
      expect(blob).toMatchObject({
        type: "file",
        data: "aGVsbG8=",
        mime: "application/pdf",
        name: "blob.pdf",
        provenance: {
          type: "mcp",
          clientName: "server",
          uri: "mcp://server/blob.pdf",
          kind: "resource",
        },
      })
      expect(link).toEqual({
        type: "text",
        text: "Linked resource: mcp://server/link",
        provenance: {
          type: "mcp",
          clientName: "server",
          uri: "mcp://server/link",
          kind: "resource_link",
          mime: "application/pdf",
          name: "Linked resource",
          description: "Complete link description",
          size: 5,
          annotations: { audience: ["user"], lastModified: "2026-07-24T00:00:00Z" },
          meta: { result: { result: "meta" }, content: { link: "meta" } },
        },
      })
      expect(projection.contents).toEqual([
        {
          uri: "mcp://server/item",
          mimeType: "text/plain",
          text: "resource text",
          _meta: { resource: "meta" },
        },
        { uri: "mcp://server/blob.pdf", mimeType: "application/pdf", blob: "aGVsbG8=" },
      ])
      expect(result.structuredContent).toEqual({ answer: 42 })
    }),
  )

  it.effect("omits absent optional provenance fields", () =>
    Effect.sync(() => {
      const projection = McpCatalog.projectResult("server", {
        content: [
          { type: "resource", resource: { uri: "mcp://server/sparse", text: "sparse resource" } },
          { type: "resource_link", uri: "mcp://server/link", name: "Sparse link" },
        ],
      })
      const [resource, link] = projection.content

      expect(resource).toStrictEqual({
        type: "text",
        text: "sparse resource",
        provenance: { type: "mcp", clientName: "server", uri: "mcp://server/sparse", kind: "resource" },
      })
      expect(resource).not.toHaveProperty("provenance.mime")
      expect(resource).not.toHaveProperty("provenance.name")
      expect(resource).not.toHaveProperty("provenance.description")
      expect(resource).not.toHaveProperty("provenance.size")
      expect(resource).not.toHaveProperty("provenance.annotations")
      expect(resource).not.toHaveProperty("provenance.meta")
      expect(link).toStrictEqual({
        type: "text",
        text: "Sparse link: mcp://server/link",
        provenance: {
          type: "mcp",
          clientName: "server",
          uri: "mcp://server/link",
          kind: "resource_link",
          name: "Sparse link",
        },
      })
      expect(link).not.toHaveProperty("provenance.mime")
      expect(link).not.toHaveProperty("provenance.description")
      expect(link).not.toHaveProperty("provenance.size")
      expect(link).not.toHaveProperty("provenance.annotations")
      expect(link).not.toHaveProperty("provenance.meta")
    }),
  )

  it.effect("diagnoses invalid embedded resource base64 without retaining its payload", () =>
    Effect.sync(() => {
      const rejected = "aGVs bG8="
      const projection = McpCatalog.projectResult("server", {
        content: [
          { type: "text", text: "before" },
          { type: "resource", resource: { uri: "mcp://server/invalid", mimeType: "image/png", blob: rejected } },
          { type: "text", text: "after" },
        ],
      })

      expect(projection.content).toEqual([
        { type: "text", text: "before" },
        {
          type: "text",
          text: "[MCP resource omitted: mcp://server/invalid (image/png): Invalid base64 payload]",
          provenance: expect.objectContaining({ type: "mcp", uri: "mcp://server/invalid", kind: "resource" }),
        },
        { type: "text", text: "after" },
      ])
      expect(projection.contents).toEqual([
        { type: "error", uri: "mcp://server/invalid", mimeType: "image/png", error: "Invalid base64 payload" },
      ])
      expect(JSON.stringify(projection)).not.toContain(rejected)
    }),
  )

  it.effect("diagnoses unsupported embedded resource MIME without retaining its payload", () =>
    Effect.sync(() => {
      const rejected = "dW5zdXBwb3J0ZWQ="
      const projection = McpCatalog.projectResult("server", {
        content: [
          { type: "resource", resource: { uri: "mcp://server/binary", blob: rejected } },
          { type: "resource", resource: { uri: "mcp://server/valid", mimeType: "image/png", blob: "aGVsbG8=" } },
        ],
      })

      expect(projection.content.map((item) => item.type)).toEqual(["text", "file"])
      expect(projection.contents).toEqual([
        {
          type: "error",
          uri: "mcp://server/binary",
          mimeType: "application/octet-stream",
          error: "Unsupported resource MIME: application/octet-stream",
        },
        { uri: "mcp://server/valid", mimeType: "image/png", blob: "aGVsbG8=" },
      ])
      expect(JSON.stringify(projection)).not.toContain(rejected)
    }),
  )

  it.effect("diagnoses oversized embedded resources without retaining their payload", () =>
    Effect.sync(() => {
      const rejected = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")
      const projection = McpCatalog.projectResult("server", {
        content: [
          { type: "resource", resource: { uri: "mcp://server/large", mimeType: "image/png", blob: rejected } },
          { type: "text", text: "valid sibling" },
        ],
      })

      expect(projection.content).toEqual([
        {
          type: "text",
          text: "[MCP resource omitted: mcp://server/large (image/png): Resource exceeds 10485760 bytes: 10485761 bytes]",
          provenance: expect.objectContaining({ type: "mcp", uri: "mcp://server/large", kind: "resource" }),
        },
        { type: "text", text: "valid sibling" },
      ])
      expect(projection.contents).toEqual([
        {
          type: "error",
          uri: "mcp://server/large",
          mimeType: "image/png",
          error: "Resource exceeds 10485760 bytes: 10485761 bytes",
        },
      ])
      expect(JSON.stringify(projection)).not.toContain(rejected)
    }),
  )

  it.effect("turns MCP error results into canonical tool failures", () =>
    Effect.gen(function* () {
      const tool = McpCatalog.toCoreTool(
        entry({
          isError: true,
          content: [{ type: "text", text: "server exploded" }],
        }),
      )
      const failure = yield* Effect.flip(
        Tool.settle(tool, { type: "tool-call", id: "call_mcp", name: "server_inspect", input: { id: "x" } }, context),
      )
      expect(failure).toBeInstanceOf(Tool.Failure)
      expect(failure.message).toBe("server exploded")
    }),
  )
})
