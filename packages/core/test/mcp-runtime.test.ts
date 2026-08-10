import { expect } from "bun:test"
import { pathToFileURL } from "node:url"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type Tool as MCPToolDefinition,
} from "@modelcontextprotocol/sdk/types.js"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Effect, Layer, PubSub, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, toolDefinitions } from "./lib/tool"

const configLayer = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))

const eventLayer = Layer.effect(
  EventV2.Service,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<any>()
    return EventV2.Service.of({
      publish: ((definition: any, data: any, options?: any) =>
        Effect.gen(function* () {
          const event = {
            id: options?.id ?? EventV2.ID.create(),
            type: definition.type,
            ...(options?.location ? { location: options.location } : {}),
            data,
          }
          yield* PubSub.publish(events, event)
          return event
        })) as EventV2.Interface["publish"],
      subscribe: ((definition: any) =>
        Stream.fromPubSub(events).pipe(
          Stream.filter((event) => event.type === definition.type),
        )) as EventV2.Interface["subscribe"],
      all: () => Stream.fromPubSub(events),
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

const spawnerLayer = Layer.mock(ChildProcessSpawner, {
  spawn: () => Effect.die("process discovery is not used on Windows tests"),
})

const outputStoreLayer = Layer.mock(ToolOutputStore.Service, {
  limits: () => Effect.succeed({ maxLines: Number.MAX_SAFE_INTEGER, maxBytes: Number.MAX_SAFE_INTEGER }),
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
  cleanup: () => Effect.void,
})

const permissionLayer = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
  ask: () => Effect.die("unused"),
  reply: () => Effect.die("unused"),
  get: () => Effect.die("unused"),
  forSession: () => Effect.die("unused"),
  list: () => Effect.die("unused"),
})

const isolatedGlobalLayer = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.map((tmp) =>
      Global.layerWith({
        data: tmp.path,
        state: tmp.path,
        config: tmp.path,
      }),
    ),
  ),
)

const layer = AppNodeBuilder.build(LayerNode.group([MCP.node, MCP.toolsNode, ToolRegistry.node, Location.node]), [
  [Config.node, configLayer],
  [EventV2.node, eventLayer],
  [Global.node, isolatedGlobalLayer],
  [Location.node, tempLocationLayer],
  [CrossSpawnSpawner.node, spawnerLayer],
  [PermissionV2.node, permissionLayer],
  [ToolOutputStore.node, outputStoreLayer],
])

const it = testEffect(layer)
const sessionID = SessionV2.ID.make("ses_mcp_runtime")
const assistantMessageID = SessionMessage.ID.make("msg_mcp_runtime")
const agent = AgentV2.ID.make("build")
const resourceHelpers = ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"]

type TestServer = {
  readonly url: string
  readonly tools: MCPToolDefinition[]
  readonly requests: Headers[]
  roots?: ReadonlyArray<{ uri: string; name?: string }>
  readonly changed: () => Promise<void>
  readonly restart: () => Promise<void>
  readonly close: () => Promise<void>
}

const server = Effect.acquireRelease(
  Effect.promise(async () => {
    const state: TestServer = {
      url: "",
      tools: [
        {
          name: "echo",
          description: "Echo text",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      ],
      requests: [],
      changed: () => current.protocol.sendToolListChanged(),
      restart: async () => {
        current = await makeProtocol()
      },
      close: async () => {
        await current.protocol.close().catch(() => {})
        http.stop(true)
      },
    }

    const makeProtocol = async () => {
      const protocol = new Server(
        { name: "core-mcp-test", version: "1.0.0" },
        { capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} }, instructions: "Use test tools." },
      )
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      protocol.setRequestHandler(ListToolsRequestSchema, () => Promise.resolve({ tools: state.tools }))
      protocol.setRequestHandler(CallToolRequestSchema, (request) =>
        Promise.resolve({
          content: [{ type: "text", text: String(request.params.arguments?.text ?? "") }],
        }),
      )
      protocol.setRequestHandler(ListPromptsRequestSchema, () =>
        Promise.resolve({ prompts: [{ name: "review", description: "Review work" }] }),
      )
      protocol.setRequestHandler(GetPromptRequestSchema, () =>
        Promise.resolve({ messages: [{ role: "user", content: { type: "text", text: "review prompt" } }] }),
      )
      protocol.setRequestHandler(ListResourcesRequestSchema, () =>
        Promise.resolve({ resources: [{ name: "guide", uri: "file:///guide.txt", mimeType: "text/plain" }] }),
      )
      protocol.setRequestHandler(ListResourceTemplatesRequestSchema, () =>
        Promise.resolve({ resourceTemplates: [{ name: "item", uriTemplate: "file:///items/{id}" }] }),
      )
      protocol.setRequestHandler(ReadResourceRequestSchema, (request) =>
        Promise.resolve({ contents: [{ uri: request.params.uri, text: "resource body" }] }),
      )
      protocol.oninitialized = () => {
        if (!protocol.getClientCapabilities()?.roots) return
        void Bun.sleep(25)
          .then(() => protocol.listRoots())
          .then((result) => {
            state.roots = result.roots
          })
          .catch(() => {})
      }
      await protocol.connect(transport)
      return { protocol, transport }
    }

    let current = await makeProtocol()
    const http = Bun.serve({
      port: 0,
      fetch: (request) => {
        state.requests.push(new Headers(request.headers))
        return current.transport.handleRequest(request)
      },
    })
    Object.assign(state, { url: http.url.toString() })
    return state
  }),
  (server) => Effect.promise(server.close),
)

function waitFor<A>(effect: Effect.Effect<A>, accept: (value: A) => boolean, message: string) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = yield* effect
      if (accept(value)) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(message)
  })
}

it.live("runs the location-scoped MCP lifecycle and keeps ToolRegistry synchronized", () =>
  Effect.gen(function* () {
    const remote = yield* server
    const location = yield* Location.Service
    const mcp = yield* MCP.Service
    const registry = yield* ToolRegistry.Service

    expect(yield* mcp.status()).toEqual({})
    const initialDefinitions = yield* toolDefinitions(registry)
    expect(resourceHelpers.some((name) => initialDefinitions.some((definition) => definition.name === name))).toBe(
      false,
    )
    expect(
      yield* mcp.add(
        "demo server",
        new ConfigMCP.Remote({
          type: "remote",
          url: remote.url,
          oauth: false,
          headers: { "X-Transport-Mode": "explicit" },
        }),
      ),
    ).toEqual({ status: { "demo server": { status: "connected" } } })
    expect(remote.requests.length).toBeGreaterThan(0)
    expect(remote.requests.every((headers) => headers.get("x-transport-mode") === "explicit")).toBe(true)

    yield* waitFor(
      Effect.sync(() => remote.roots),
      (roots) => roots !== undefined,
      "MCP server did not receive roots",
    )
    expect(remote.roots).toEqual([{ uri: pathToFileURL(location.directory).href }])
    expect(Object.keys(yield* mcp.clients())).toEqual(["demo server"])
    expect(Object.keys(yield* mcp.tools())).toEqual(["demo_server_echo"])
    expect(yield* mcp.instructions()).toEqual([
      { name: "demo server", instructions: "Use test tools.", tools: ["demo_server_echo"] },
    ])
    expect(Object.keys(yield* mcp.prompts())).toEqual(["demo_server:review"])
    expect(Object.keys(yield* mcp.resources())).toEqual(["demo server:file:///guide.txt"])
    expect(Object.keys(yield* mcp.resourceTemplates())).toEqual(["demo server:file:///items/{id}"])
    expect(yield* mcp.getPrompt("demo server", "review")).toMatchObject({
      messages: [{ role: "user", content: { type: "text", text: "review prompt" } }],
    })
    expect(yield* mcp.readResource("demo server", "file:///guide.txt")).toMatchObject({
      contents: [{ uri: "file:///guide.txt", text: "resource body" }],
    })

    yield* waitFor(
      toolDefinitions(registry),
      (definitions) =>
        definitions.some((definition) => definition.name === "demo_server_echo") &&
        resourceHelpers.every((name) => definitions.some((definition) => definition.name === name)),
      "MCP tools and resource helpers were not registered",
    )
    expect(
      yield* executeTool(registry, {
        sessionID,
        agent,
        assistantMessageID,
        call: { type: "tool-call", id: "call_echo", name: "demo_server_echo", input: { text: "hello" } },
      }),
    ).toEqual({ type: "text", value: "hello" })

    remote.tools.splice(0, remote.tools.length, {
      name: "next",
      description: "Next tool",
      inputSchema: { type: "object", properties: {} },
    })
    yield* Effect.promise(remote.changed)
    yield* waitFor(
      toolDefinitions(registry),
      (definitions) =>
        definitions.some((definition) => definition.name === "demo_server_next") &&
        !definitions.some((definition) => definition.name === "demo_server_echo"),
      "MCP tool registration did not refresh",
    )

    yield* mcp.disconnect("demo server")
    expect(yield* mcp.status()).toEqual({ "demo server": { status: "disabled" } })
    yield* waitFor(
      toolDefinitions(registry),
      (definitions) =>
        !definitions.some((definition) => definition.name.startsWith("demo_server_")) &&
        resourceHelpers.every((name) => !definitions.some((definition) => definition.name === name)),
      "MCP tools or resource helpers remained after disconnect",
    )

    yield* Effect.promise(remote.restart)
    yield* mcp.connect("demo server")
    expect(yield* mcp.status()).toEqual({ "demo server": { status: "connected" } })
    yield* waitFor(
      toolDefinitions(registry),
      (definitions) =>
        definitions.some((definition) => definition.name === "demo_server_next") &&
        resourceHelpers.every((name) => definitions.some((definition) => definition.name === name)),
      "MCP tools and resource helpers were not restored after reconnect",
    )
  }),
)

it.live("forwards configured headers through the default OAuth-aware transport", () =>
  Effect.gen(function* () {
    const remote = yield* server
    const mcp = yield* MCP.Service

    expect(
      yield* mcp.add(
        "headers",
        new ConfigMCP.Remote({
          type: "remote",
          url: remote.url,
          headers: {
            Authorization: "Bearer test-token",
            "X-Custom-Header": "custom-value",
          },
        }),
      ),
    ).toEqual({ status: { headers: { status: "connected" } } })
    expect(remote.requests.length).toBeGreaterThan(0)
    for (const headers of remote.requests) {
      expect(headers.get("authorization")).toBe("Bearer test-token")
      expect(headers.get("x-custom-header")).toBe("custom-value")
    }
  }),
)

it.live("keeps disabled servers offline", () =>
  Effect.gen(function* () {
    const remote = yield* server
    const mcp = yield* MCP.Service

    expect(
      yield* mcp.add(
        "disabled",
        new ConfigMCP.Remote({
          type: "remote",
          url: remote.url,
          disabled: true,
        }),
      ),
    ).toEqual({ status: { disabled: { status: "disabled" } } })
    expect(remote.requests).toHaveLength(0)
    expect(yield* mcp.clients()).toEqual({})
    expect(yield* mcp.tools()).toEqual({})
  }),
)

it.live("returns typed missing-server errors and stable failed statuses", () =>
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    expect(yield* Effect.flip(mcp.connect("missing"))).toEqual(new MCP.NotFoundError({ name: "missing" }))
    expect(yield* Effect.flip(mcp.disconnect("missing"))).toEqual(new MCP.NotFoundError({ name: "missing" }))

    const result = yield* mcp.add("invalid", new ConfigMCP.Remote({ type: "remote", url: "not a URL", oauth: false }))
    expect(result.status.invalid).toEqual({ status: "failed", error: 'Invalid MCP URL for "invalid"' })
    expect(yield* mcp.clients()).toEqual({})
  }),
)
