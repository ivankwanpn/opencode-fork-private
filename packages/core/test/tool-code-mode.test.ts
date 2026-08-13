import { describe, expect } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { CallToolResult, Tool as MCPToolDefinition } from "@modelcontextprotocol/sdk/types.js"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionStore } from "@opencode-ai/core/session/store"
import { CodeModeTool } from "@opencode-ai/core/tool/code-mode"
import { ToolProgress } from "@opencode-ai/core/tool/progress"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Cause, Effect, Exit, Fiber, Layer, PubSub, Stream } from "effect"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_code_mode")
type Handler = (
  input: Record<string, unknown>,
  signal: AbortSignal | undefined,
) => Promise<CallToolResult>

const handlers = new Map<string, Handler>()
const assertions: PermissionV2.AssertInput[] = []
const updates: ToolProgress.Update[] = []
const calls = new Map<string, number>()
let sessionPermissions: PermissionV2.Ruleset = []
let latestPrompt: Prompt | undefined = undefined
let currentAgent = AgentV2.Info.make({
  id: AgentV2.ID.make("build"),
  request: { headers: {}, body: {} },
  mode: "all",
  hidden: false,
  permissions: [],
})

function definition(name: string, outputSchema?: MCPToolDefinition["outputSchema"]): MCPToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    inputSchema: {
      type: "object",
      properties: name === "echo" ? { text: { type: "string" } } : {},
      ...(name === "echo" ? { required: ["text"] } : {}),
    },
    ...(outputSchema ? { outputSchema } : {}),
  }
}

function entry(def: MCPToolDefinition): MCP.McpTool {
  return {
    clientName: "demo server",
    def,
    client: {
      callTool: (request: { name: string; arguments?: Record<string, unknown> }, _schema: unknown, options: { signal?: AbortSignal }) => {
        calls.set(request.name, (calls.get(request.name) ?? 0) + 1)
        const handler = handlers.get(request.name)
        return handler
          ? handler(request.arguments ?? {}, options.signal)
          : Promise.reject(new Error(`Missing test handler: ${request.name}`))
      },
    } as unknown as Client,
    timeout: 1_000,
  }
}

const baseTools = () => ({
  demo_server_echo: entry(definition("echo")),
  demo_server_structured: entry(
    definition("structured", {
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
    }),
  ),
  demo_server_fail: entry(definition("fail")),
  demo_server_image: entry(definition("image")),
  demo_server_wait: entry(definition("wait")),
})
let mcpTools: Record<string, MCP.McpTool> = baseTools()

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.sync(() => ({ ...mcpTools })),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: {} }),
    connect: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    disconnect: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    authenticate: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    finishAuth: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    removeAuth: () => Effect.void,
    supportsOAuth: (name) => Effect.fail(new MCP.NotFoundError({ name })),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated"),
  }),
)

const agents = Layer.succeed(
  AgentV2.Service,
  AgentV2.Service.of({
    transform: () => Effect.die("unused"),
    reload: () => Effect.die("unused"),
    get: (id) => Effect.succeed(id === currentAgent.id ? currentAgent : undefined),
    default: () => Effect.succeed(currentAgent),
    resolve: (id) => Effect.succeed(id === undefined || id === currentAgent.id ? currentAgent : undefined),
    select: () => Effect.succeed({ id: currentAgent.id, info: currentAgent }),
    all: () => Effect.succeed([currentAgent]),
  }),
)

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const progress = Layer.succeed(
  ToolProgress.Service,
  ToolProgress.Service.of({
    publish: (_context, update) =>
      Effect.sync(() => {
        updates.push(structuredClone(update))
      }),
  }),
)

const events = Layer.effect(
  EventV2.Service,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<any>()
    return EventV2.Service.of({
      publish: ((event: any, data: any, options?: any) =>
        Effect.gen(function* () {
          const value = {
            id: options?.id ?? EventV2.ID.create(),
            type: event.type,
            ...(options?.location ? { location: options.location } : {}),
            data,
          }
          yield* PubSub.publish(pubsub, value)
          return value
        })) as EventV2.Interface["publish"],
      subscribe: ((event: any) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter((value) => value.type === event.type),
        )) as EventV2.Interface["subscribe"],
      all: () => Stream.fromPubSub(pubsub),
      durable: () => Stream.empty,
      listen: () => Effect.die("unused"),
      project: () => Effect.die("unused"),
      replay: () => Effect.die("unused"),
      replayAll: () => Effect.die("unused"),
      remove: () => Effect.die("unused"),
      claim: () => Effect.die("unused"),
    })
  }),
)

const sessions = Layer.succeed(
  SessionStore.Service,
  SessionStore.Service.of({
    get: () => Effect.die("unused"),
    permissions: () => Effect.sync(() => [...sessionPermissions]),
    context: () => Effect.die("unused"),
    runnerContext: () => Effect.die("unused"),
    latestPrompt: () => Effect.succeed(latestPrompt),
    message: () => Effect.die("unused"),
  }),
)

const outputStore = Layer.mock(ToolOutputStore.Service, {
  limits: () => Effect.succeed({ maxLines: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER }),
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
  cleanup: () => Effect.void,
})

const layer = AppNodeBuilder.build(
  LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, CodeModeTool.node]),
  [
    [MCP.node, mcp],
    [AgentV2.node, agents],
    [PermissionV2.node, permission],
    [ToolProgress.node, progress],
    [EventV2.node, events],
    [Location.node, tempLocationLayer],
    [ToolOutputStore.node, outputStore],
    [SessionStore.node, sessions],
  ],
)
const it = testEffect(layer)

function reset() {
  assertions.length = 0
  updates.length = 0
  calls.clear()
  mcpTools = baseTools()
  sessionPermissions = []
  latestPrompt = undefined
  currentAgent = AgentV2.Info.make({ ...currentAgent, permissions: [] })
  handlers.set("echo", (input) =>
    Promise.resolve({ content: [{ type: "text", text: String(input.text ?? "") }] }),
  )
  handlers.set("structured", () =>
    Promise.resolve({ content: [], structuredContent: { answer: 42 } }),
  )
  handlers.set("fail", () =>
    Promise.resolve({ isError: true, content: [{ type: "text", text: "server exploded" }] }),
  )
  handlers.set("image", () =>
    Promise.resolve({ content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] }),
  )
}

function execute(registry: ToolRegistry.Interface, code: string, callID = "call-execute") {
  return settleTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: callID, name: CodeModeTool.name, input: { code } },
  })
}

function latestCalls() {
  return updates.at(-1)?.structured.toolCalls
}

describe("CodeModeTool", () => {
  it.effect("advertises only permission-visible MCP tools under stable server namespaces", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const permissions: PermissionV2.Ruleset = [
        { action: "demo_server_fail", resource: "*", effect: "deny" },
      ]
      const definitions = yield* toolDefinitions(registry, permissions)
      const execute = definitions.find((item) => item.name === CodeModeTool.name)

      expect(execute?.inputSchema).toMatchObject({
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      })
      expect(execute?.description).toContain("tools.demo_server.echo")
      expect(execute?.description).toContain("tools.demo_server.structured")
      expect(execute?.description).not.toContain("tools.demo_server.fail")

      expect(
        yield* toolDefinitions(registry, [
          { action: "*", resource: "*", effect: "deny" },
          { action: "execute", resource: "*", effect: "allow" },
        ]),
      ).toEqual([])
    }),
  )

  it.effect("runs parallel text and structured MCP calls with child permissions and progress", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const settlement = yield* execute(
        registry,
        'const values = await Promise.all([tools.demo_server.echo({ text: "hello" }), tools.demo_server.structured({})]); return values;',
      )

      expect(settlement.output?.content).toEqual([
        {
          type: "text",
          text: '[\n  "hello",\n  {\n    "answer": 42\n  }\n]',
        },
      ])
      expect(settlement.output?.structured).toEqual({
        toolCalls: [
          { tool: "demo_server.echo", status: "completed", input: { text: "hello" } },
          { tool: "demo_server.structured", status: "completed" },
        ],
      })
      expect(assertions.map((item) => item.action)).toEqual([
        "execute",
        "demo_server_echo",
        "demo_server_structured",
      ])
      expect(assertions.slice(1).map((item) => item.source)).toEqual([
        { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call-execute" },
        { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "call-execute" },
      ])
      expect(latestCalls()).toEqual([
        { tool: "demo_server.echo", status: "completed", input: { text: "hello" } },
        { tool: "demo_server.structured", status: "completed" },
      ])
    }),
  )

  it.effect("keeps MCP failures catchable inside the confined program", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const settlement = yield* execute(
        registry,
        'try { await tools.demo_server.fail({}); return "not caught"; } catch (error) { return "caught"; }',
      )

      expect(settlement.result).toEqual({ type: "text", value: "caught" })
      expect(latestCalls()).toEqual([{ tool: "demo_server.fail", status: "error" }])
    }),
  )

  it.effect("keeps MCP media outside the sandbox and returns canonical attachments", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const settlement = yield* execute(registry, "return await tools.demo_server.image({});")

      expect(settlement.output).toEqual({
        structured: {
          toolCalls: [{ tool: "demo_server.image", status: "completed" }],
        },
        content: [
          { type: "text", text: "[1 image attached to the result]" },
          {
            type: "file",
            uri: "data:image/png;base64,aGVsbG8=",
            mime: "image/png",
            name: undefined,
          },
        ],
      })
    }),
  )

  it.effect("filters hard-denied child tools again at execution time", () =>
    Effect.gen(function* () {
      reset()
      currentAgent = AgentV2.Info.make({
        ...currentAgent,
        permissions: [{ action: "demo_server_fail", resource: "*", effect: "deny" }],
      })
      const registry = yield* ToolRegistry.Service
      const settlement = yield* execute(registry, "return await tools.demo_server.fail({});")

      expect(settlement.result).toMatchObject({
        type: "error",
        value: expect.stringContaining("Unknown tool"),
      })
      expect(assertions.map((item) => item.action)).toEqual(["execute"])
    }),
  )

  it.effect("execution catalog is filtered by agent, then Session, then prompt rules", () =>
    Effect.gen(function* () {
      reset()
      sessionPermissions = [{ action: "demo_server_echo", resource: "*", effect: "deny" }]
      latestPrompt = Prompt.make({ text: "policy", tools: { demo_server_structured: false } })
      currentAgent = AgentV2.Info.make({
        ...currentAgent,
        permissions: [{ action: "demo_server_*", resource: "*", effect: "allow" }],
      })
      handlers.clear()
      handlers.set("echo", async (input) => ({ content: [{ type: "text", text: `echo:${input.text}` }] }))
      handlers.set("fail", async () => ({ content: [{ type: "text", text: "fail-ran" }] }))
      const registry = yield* ToolRegistry.Service

      // Session rule denies echo -> script call fails, handler never invoked:
      const echo = yield* execute(registry, 'return await tools.demo_server.echo({ text: "hi" });')
      expect(echo.result).toMatchObject({
        type: "error",
        value: expect.stringContaining("Unknown tool"),
      })
      expect(calls.get("echo")).toBeUndefined()

      // Prompt override denies structured -> same behavior:
      const structured = yield* execute(registry, "return await tools.demo_server.structured({});")
      expect(structured.result).toMatchObject({
        type: "error",
        value: expect.stringContaining("Unknown tool"),
      })
      expect(calls.get("structured")).toBeUndefined()

      // Agent-only allowance (fail) still succeeds and its handler is invoked:
      const fail = yield* execute(registry, "return await tools.demo_server.fail({});")
      expect(fail.result).toEqual({ type: "text", value: "fail-ran" })
      expect(calls.get("fail")).toBe(1)
    }),
  )

  it.effect("propagates interruption to MCP and terminally marks running progress", () =>
    Effect.gen(function* () {
      reset()
      let start!: () => void
      const started = new Promise<void>((resolve) => {
        start = resolve
      })
      let aborted = false
      handlers.set(
        "wait",
        (_input, signal) =>
          new Promise<CallToolResult>((_resolve, reject) => {
            start()
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true
                reject(new Error("aborted"))
              },
              { once: true },
            )
          }),
      )
      const registry = yield* ToolRegistry.Service
      const fiber = yield* execute(registry, "return await tools.demo_server.wait({});", "call-cancel").pipe(
        Effect.forkChild,
      )
      yield* Effect.promise(() => started)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(aborted).toBe(true)
      expect(latestCalls()).toEqual([{ tool: "demo_server.wait", status: "error" }])
    }),
  )

  it.effect("returns confined logs without exposing host globals", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      expect((yield* execute(registry, 'console.log("trace"); return typeof process;')).result).toEqual({
        type: "text",
        value: "undefined\n\nLogs:\ntrace",
      })
    }),
  )
})
