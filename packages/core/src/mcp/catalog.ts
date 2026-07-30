import { createHash } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolSchema,
  type CallToolResult,
  type Tool as MCPToolDefinition,
} from "@modelcontextprotocol/sdk/types.js"
import type { McpProvenance } from "@opencode-ai/schema/llm"
import { Effect, JsonSchema, Schema } from "effect"
import { Tool } from "../tool/tool"

export const DEFAULT_TIMEOUT = 30_000
export const MAX_LIST_PAGES = 1_000

const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export interface McpTool {
  readonly clientName: string
  readonly def: MCPToolDefinition
  readonly client: Client
  readonly timeout?: number
}

export type ResourceContentDiagnostic = {
  readonly type: "error"
  readonly uri: string
  readonly mimeType: string
  readonly error: string
}

export type Projection = {
  readonly content: ReadonlyArray<Tool.Content>
  readonly contents: ReadonlyArray<unknown>
}

export async function paginate<T, R extends { nextCursor?: string }>(
  list: (cursor?: string) => Promise<R>,
  items: (result: R) => T[],
): Promise<T[]> {
  const result: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const current = await list(cursor)
    result.push(...items(current))
    if (current.nextCursor === undefined) return result
    if (cursors.has(current.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${current.nextCursor}`)
    cursors.add(current.nextCursor)
    cursor = current.nextCursor
  }

  throw new Error(`MCP list exceeded ${MAX_LIST_PAGES} pages`)
}

export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export const toolName = (clientName: string, name: string) => {
  const raw = sanitize(clientName) + "_" + sanitize(name)
  const prefixed = /^[A-Za-z]/.test(raw) ? raw : `mcp_${raw}`
  if (prefixed.length <= 64) return prefixed
  const suffix = createHash("sha256").update(prefixed).digest("hex").slice(0, 8)
  return prefixed.slice(0, 55) + "_" + suffix
}

const listTools = (client: Client, timeout: number) =>
  Effect.tryPromise({
    try: () =>
      paginate(
        async (cursor) => {
          const params = cursor === undefined ? undefined : { cursor }
          try {
            return await client.listTools(params, { timeout })
          } catch (error) {
            if (!(error instanceof Error) || !isOutputSchemaValidationError(error)) throw error
            return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
          }
        },
        (result) => result.tools,
      ),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })

export const definitions = (client: Client, timeout = DEFAULT_TIMEOUT) =>
  listTools(client, timeout).pipe(Effect.catch(() => Effect.void))

export const prompts = (client: Client, timeout = DEFAULT_TIMEOUT) => {
  if (!client.getServerCapabilities()?.prompts) return Promise.resolve([])
  return paginate(
    (cursor) => client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.prompts,
  )
}

export const resources = (client: Client, timeout = DEFAULT_TIMEOUT) => {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResources(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resources,
  )
}

export const resourceTemplates = (client: Client, timeout = DEFAULT_TIMEOUT) => {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resourceTemplates,
  )
}

export function collect<T extends { name: string }>(
  clientName: string,
  client: Client,
  list: (client: Client) => Promise<T[]>,
  label: string,
  key?: (item: T) => string,
) {
  return Effect.tryPromise({
    try: () => list(client),
    catch: (cause) => cause,
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`failed to get MCP ${label}`, {
        clientName,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.map((items) => {
      const resourceClient = clientName.replaceAll("%", "%25").replaceAll(":", "%3A")
      return Object.fromEntries(
        items.map((item) => [
          key ? resourceClient + ":" + key(item) : sanitize(clientName) + ":" + sanitize(item.name),
          { ...item, client: clientName },
        ]),
      )
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

const inputSchema = Schema.Record(Schema.String, Schema.Unknown)
const outputSchema = Schema.Unknown

export const invoke = (entry: McpTool, input: Record<string, unknown>): Effect.Effect<CallToolResult, Tool.Failure> =>
  Effect.tryPromise({
    try: (signal) =>
      entry.client.callTool({ name: entry.def.name, arguments: input }, CallToolResultSchema, {
        resetTimeoutOnProgress: true,
        signal,
        timeout: entry.timeout,
        onprogress: () => {},
      }),
    catch: (cause) =>
      new Tool.Failure({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result.isError ? Effect.fail(new Tool.Failure({ message: errorMessage(result) })) : Effect.succeed(result),
    ),
  )

export function toCoreTool(entry: McpTool): Tool.AnyTool {
  const rawInput = {
    ...entry.def.inputSchema,
    type: "object",
    properties: entry.def.inputSchema.properties ?? {},
    additionalProperties: false,
  } as JsonSchema.JsonSchema
  const rawOutput = entry.def.outputSchema as JsonSchema.JsonSchema | undefined

  return Tool.make({
    description: entry.def.description ?? "",
    input: inputSchema,
    output: outputSchema,
    structured: outputSchema,
    jsonSchema: { input: rawInput, ...(rawOutput ? { output: rawOutput } : {}) },
    execute: (input) => invoke(entry, input),
    toStructuredOutput: ({ output }) => {
      const result = output as CallToolResult
      return result.structuredContent ?? {}
    },
    toModelOutput: ({ output }) => projectResult(entry.clientName, output as CallToolResult).content,
  })
}

function errorMessage(result: CallToolResult) {
  return (
    result.content
      .flatMap((item) => (item.type === "text" ? [item.text] : []))
      .filter((text) => text.trim())
      .join("\n\n") || "MCP tool returned an error"
  )
}

export function projectResult(clientName: string, result: CallToolResult): Projection {
  const content: Tool.Content[] = []
  const contents: unknown[] = []
  for (const item of result.content) {
    switch (item.type) {
      case "text":
        content.push({ type: "text", text: item.text })
        break
      case "image":
      case "audio":
        content.push({ type: "file", data: item.data, mime: item.mimeType })
        break
      case "resource": {
        const projection = projectEmbeddedResource(clientName, result, item)
        content.push(...projection.content)
        contents.push(...projection.contents)
        break
      }
      case "resource_link":
        content.push({
          type: "text",
          text: `${item.name}: ${item.uri}`,
          provenance: provenance(clientName, result, item),
        })
        break
    }
  }
  return { content, contents }
}

function projectEmbeddedResource(
  clientName: string,
  result: CallToolResult,
  item: Extract<CallToolResult["content"][number], { type: "resource" }>,
): Projection {
  const source = provenance(clientName, result, item)
  if ("text" in item.resource)
    return {
      content: [{ type: "text", text: item.resource.text, provenance: source }],
      contents: [item.resource],
    }

  const mime = item.resource.mimeType ?? "application/octet-stream"
  const diagnostic = blobDiagnostic(item.resource.uri, mime, item.resource.blob)
  if (diagnostic)
    return {
      content: [
        {
          type: "text",
          text: `[MCP resource omitted: ${diagnostic.uri} (${diagnostic.mimeType}): ${diagnostic.error}]`,
          provenance: source,
        },
      ],
      contents: [diagnostic],
    }

  return {
    content: [
      {
        type: "file",
        data: item.resource.blob,
        mime,
        name: lastSegment(item.resource.uri),
        provenance: source,
      },
    ],
    contents: [item.resource],
  }
}

function provenance(
  clientName: string,
  result: CallToolResult,
  item: Extract<CallToolResult["content"][number], { type: "resource" | "resource_link" }>,
): McpProvenance {
  const resource = item.type === "resource" ? item.resource : item
  const meta = {
    ...(result._meta === undefined ? {} : { result: result._meta }),
    ...(item._meta === undefined ? {} : { content: item._meta }),
    ...(item.type !== "resource" || item.resource._meta === undefined ? {} : { resource: item.resource._meta }),
  }
  return {
    type: "mcp",
    clientName,
    uri: resource.uri,
    kind: item.type,
    ...(resource.mimeType === undefined ? {} : { mime: resource.mimeType }),
    ...(item.type !== "resource_link" || item.name === undefined ? {} : { name: item.name }),
    ...(item.type !== "resource_link" || item.description === undefined ? {} : { description: item.description }),
    ...(item.type !== "resource_link" || item.size === undefined ? {} : { size: item.size }),
    ...(item.annotations === undefined ? {} : { annotations: item.annotations }),
    ...(Object.keys(meta).length === 0 ? {} : { meta }),
  }
}

function blobDiagnostic(uri: string, mimeType: string, blob: string): ResourceContentDiagnostic | undefined {
  if (blob.length % 4 !== 0 || !base64Pattern.test(blob))
    return { type: "error", uri, mimeType, error: "Invalid base64 payload" }
  const padding = blob.endsWith("==") ? 2 : blob.endsWith("=") ? 1 : 0
  const byteLength = (blob.length / 4) * 3 - padding
  if (byteLength > MAX_MCP_RESOURCE_BLOB_BYTES)
    return {
      type: "error",
      uri,
      mimeType,
      error: `Resource exceeds ${MAX_MCP_RESOURCE_BLOB_BYTES} bytes: ${byteLength} bytes`,
    }
  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mimeType))
    return { type: "error", uri, mimeType, error: `Unsupported resource MIME: ${mimeType}` }
  const bytes = Buffer.from(blob, "base64")
  if (bytes.toString("base64") !== blob) return { type: "error", uri, mimeType, error: "Invalid base64 payload" }
}

function lastSegment(uri: string) {
  const trimmed = uri.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return segment || undefined
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

export * as McpCatalog from "./catalog"
