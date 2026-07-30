export * as CodeModeTool from "./code-mode"

import { CodeMode, Tool as SandboxTool, toolError } from "@opencode-ai/codemode"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Cause, Effect, Layer, Schema, Stream } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { MCP } from "../mcp/runtime"
import { McpCatalog } from "../mcp/catalog"
import { PermissionV2 } from "../permission"
import { ToolProgress } from "./progress"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "execute"

export const description = "Run a confined orchestration script with access to connected MCP tools."

export const Input = Schema.Struct({
  code: Schema.String.annotate({
    description: "Script body executed by the confined interpreter.",
  }),
})

export const CallEntry = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type CallEntry = typeof CallEntry.Type

const Attachment = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
})
type Attachment = typeof Attachment.Type

export const Output = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(CallEntry),
  attachments: Schema.Array(Attachment),
})

export const StructuredOutput = Schema.Struct({
  toolCalls: Schema.Array(CallEntry),
})

interface CatalogEntry {
  readonly key: string
  readonly server: string
  readonly local: string
  readonly tool: MCP.McpTool
}

type Run = (input: unknown) => Effect.Effect<unknown, unknown>

const blockedSegments = new Set(["__proto__", "constructor", "prototype"])

function segment(value: string, fallback: string) {
  const sanitized = McpCatalog.sanitize(value)
  if (!sanitized) return `mcp_${fallback}`
  return blockedSegments.has(sanitized) ? `mcp_${sanitized}` : sanitized
}

function entries(tools: Record<string, MCP.McpTool>, permissions: PermissionV2.Ruleset): CatalogEntry[] {
  return Object.entries(tools)
    .filter(([key]) => PermissionV2.evaluate(key, "*", permissions).effect !== "deny")
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, tool]) => ({
      key,
      server: segment(tool.clientName, "server"),
      local: segment(tool.def.name, "tool"),
      tool,
    }))
}

function toolTree(catalog: ReadonlyArray<CatalogEntry>, run: (entry: CatalogEntry) => Run) {
  const tree = Object.create(null) as Record<string, Record<string, SandboxTool.Definition>>
  for (const entry of catalog) {
    const namespace = (tree[entry.server] ??= Object.create(null) as Record<string, SandboxTool.Definition>)
    namespace[entry.local] = SandboxTool.make({
      description: entry.tool.def.description ?? "",
      input: entry.tool.def.inputSchema as SandboxTool.JsonSchema,
      output: entry.tool.def.outputSchema as SandboxTool.JsonSchema | undefined,
      run: run(entry),
    })
  }
  return tree
}

export function describeCatalog(tools: Record<string, MCP.McpTool>, permissions: PermissionV2.Ruleset) {
  const catalog = entries(tools, permissions)
  if (catalog.length === 0) return undefined
  const instructions = CodeMode.make({
    tools: toolTree(catalog, () => () => Effect.fail(toolError("Tool preview is not executable."))),
  }).instructions()
  return `${description}\n\n${instructions}`
}

function projectMcpResult(result: CallToolResult, collect: (attachment: Attachment) => void): unknown {
  const text: string[] = []
  let files = 0
  let images = 0
  const push = (attachment: Attachment) => {
    files += 1
    if (attachment.mime.startsWith("image/")) images += 1
    collect(attachment)
  }

  for (const block of result.content) {
    switch (block.type) {
      case "text":
        text.push(block.text)
        break
      case "image":
      case "audio":
        push({ data: block.data, mime: block.mimeType })
        break
      case "resource":
        if ("text" in block.resource) text.push(block.resource.text)
        else
          push({
            data: block.resource.blob,
            mime: block.resource.mimeType ?? "application/octet-stream",
            name: lastSegment(block.resource.uri),
          })
        break
      case "resource_link":
        text.push(`${block.name}: ${block.uri}`)
        break
    }
  }

  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent
  if (text.length > 0) return text.join("\n")
  if (files > 0) {
    const noun = files === images ? "image" : "file"
    return `[${files} ${noun}${files === 1 ? "" : "s"} attached to the result]`
  }
  return null
}

function lastSegment(uri: string) {
  const trimmed = uri.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  const value = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return value || undefined
}

function shownInput(input: unknown): Record<string, unknown> | undefined {
  if (input === null || input === undefined) return undefined
  if (typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>
    return Object.keys(value).length > 0 ? value : undefined
  }
  return { input }
}

function withLogs(text: string, logs: ReadonlyArray<string>) {
  if (logs.length === 0) return text
  return text.length > 0 ? `${text}\n\nLogs:\n${logs.join("\n")}` : `Logs:\n${logs.join("\n")}`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mcp = yield* MCP.Service
    const agents = yield* AgentV2.Service
    const permission = yield* PermissionV2.Service
    const progress = yield* ToolProgress.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    let current = yield* mcp.tools()

    const invokeChildTool = Effect.fn("CodeMode.invokeChildTool")(function* (
      entry: CatalogEntry,
      args: Record<string, unknown>,
      context: Tool.Context,
      callID: string,
    ) {
      yield* permission
        .assert({
          action: entry.key,
          resources: ["*"],
          save: ["*"],
          metadata: {},
          sessionID: context.sessionID,
          agent: context.agent,
          source: {
            type: "tool",
            messageID: context.assistantMessageID,
            callID: context.toolCallID,
          },
        })
        .pipe(
          Effect.mapError(
            (error) => new Tool.Failure({ message: `Permission denied: ${entry.key}`, error }),
          ),
        )
      return yield* McpCatalog.invoke(entry.tool, args).pipe(
        Effect.withSpan("Tool.execute", {
          attributes: {
            "tool.name": entry.key,
            "tool.call_id": callID,
            "session.id": context.sessionID,
            "message.id": context.assistantMessageID,
          },
        }),
      )
    })

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          describe: (permissions) => describeCatalog(current, permissions),
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => ({ toolCalls: output.toolCalls }),
          toModelOutput: ({ output }) => [
            ...(output.output ? [{ type: "text" as const, text: output.output }] : []),
            ...output.attachments.map((attachment) => ({
              type: "file" as const,
              data: attachment.data,
              mime: attachment.mime,
              name: attachment.name,
            })),
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission
                .assert({
                  action: name,
                  resources: ["*"],
                  save: ["*"],
                  metadata: {},
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: {
                    type: "tool",
                    messageID: context.assistantMessageID,
                    callID: context.toolCallID,
                  },
                })
                .pipe(
                  Effect.mapError(
                    (error) => new Tool.Failure({ message: `Permission denied: ${name}`, error }),
                  ),
                )

              const selected = yield* agents.resolve(context.agent)
              if (!selected) return yield* new Tool.Failure({ message: `Unknown agent: ${context.agent}` })
              const catalog = entries(yield* mcp.tools(), selected.permissions)
              const calls: CallEntry[] = []
              const attachments: Attachment[] = []
              let childCalls = 0

              const snapshot = () =>
                calls.map((call) => ({
                  ...call,
                  ...(call.input ? { input: { ...call.input } } : {}),
                }))
              const publish = () =>
                progress.publish(context, {
                  structured: { toolCalls: snapshot() },
                  content: [],
                })
              const callTool = (entry: CatalogEntry) => (args: unknown) =>
                Effect.gen(function* () {
                  const callID = `${context.toolCallID}/${++childCalls}`
                  const result = yield* invokeChildTool(
                    entry,
                    (args ?? {}) as Record<string, unknown>,
                    context,
                    callID,
                  )
                  return projectMcpResult(result, (attachment) => attachments.push(attachment))
                }).pipe(
                  Effect.catchCause((cause) => {
                    if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
                    const error = Cause.squash(cause)
                    return Effect.fail(
                      toolError(error instanceof Error ? error.message : String(error), error),
                    )
                  }),
                )

              const runtime = CodeMode.make({
                tools: toolTree(catalog, callTool),
                onToolCallStart: ({ index, name, input }) =>
                  Effect.suspend(() => {
                    const visible = shownInput(input)
                    calls[index] = {
                      tool: name,
                      status: "running",
                      ...(visible ? { input: visible } : {}),
                    }
                    return publish()
                  }),
                onToolCallEnd: ({ index, outcome }) =>
                  Effect.suspend(() => {
                    const call = calls[index]
                    if (call)
                      calls[index] = {
                        ...call,
                        status: outcome === "success" ? "completed" : "error",
                      }
                    return publish()
                  }),
              })

              const result = yield* runtime.execute(input.code).pipe(
                Effect.onInterrupt(() =>
                  Effect.suspend(() => {
                    for (let index = 0; index < calls.length; index++) {
                      const call = calls[index]
                      if (call?.status === "running") calls[index] = { ...call, status: "error" }
                    }
                    return publish()
                  }),
                ),
              )
              const logs = result.logs ?? []
              if (!result.ok) {
                const hints = (result.error.suggestions ?? []).filter(
                  (hint) => !result.error.message.includes(hint),
                )
                return yield* new Tool.Failure({
                  message: withLogs([result.error.message, ...hints].join("\n"), logs),
                })
              }

              const output =
                typeof result.value === "string"
                  ? result.value
                  : (JSON.stringify(result.value, null, 2) ?? String(result.value))
              return {
                output: withLogs(output, logs),
                toolCalls: snapshot(),
                attachments,
              }
            }),
        }),
      })
      .pipe(Effect.orDie)

    yield* events
      .subscribe(McpEvent.ToolsChanged)
      .pipe(
        Stream.filter(
          (event) =>
            event.location?.directory === location.directory &&
            event.location.workspaceID === location.workspaceID,
        ),
        Stream.runForEach(() =>
          mcp.tools().pipe(
            Effect.tap((catalog) =>
              Effect.sync(() => {
                current = catalog
              }),
            ),
          ),
        ),
        Effect.forkScoped,
      )
  }),
)

export const node = makeLocationNode({
  name: "tool/code-mode",
  layer,
  deps: [
    ToolRegistry.node,
    MCP.node,
    AgentV2.node,
    PermissionV2.node,
    ToolProgress.node,
    EventV2.node,
    Location.node,
  ],
})
