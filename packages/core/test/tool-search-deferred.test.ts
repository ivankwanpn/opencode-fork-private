import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { TodoWriteTool } from "@opencode-ai/core/tool/todowrite"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolCatalog } from "@opencode-ai/core/tool/catalog"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolSearch } from "@opencode-ai/core/tool/tool-search"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolDefinition } from "@opencode-ai/llm"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "./lib/effect"

const source = { type: "plugin" as const, id: "search-fixture", displayName: "Search Fixture" }

const catalogTool = (input: {
  readonly name: string
  readonly description: string
  readonly inputSchema?: Record<string, unknown>
  readonly exposure?: ToolCatalog.Exposure
}): ToolCatalog.SearchableTool => {
  const definition = new ToolDefinition({
    kind: "function",
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema ?? { type: "object", properties: {} },
  })
  const metadata = {
    source,
    sourceLocalID: input.name,
    namespace: "fixture",
    displayName: input.name.replaceAll("_", " "),
  }
  const exposure = input.exposure ?? "deferred"
  return {
    key: ToolCatalog.key(source, input.name),
    ...metadata,
    callableName: input.name,
    description: input.description,
    inputSchema: definition.inputSchema,
    exposure,
    definitionHash: ToolCatalog.definitionHash({ definition, exposure, metadata }),
  }
}

const snapshot = (
  tools: ReadonlyArray<ToolCatalog.SearchableTool>,
  sources: ReadonlyArray<ToolCatalog.SourceStatus> = [{ source, state: "ready" }],
) => ToolCatalog.snapshot({ tools, sources })

describe("canonical tool catalog search", () => {
  test("rejects empty queries and limits outside the integer range", () => {
    const index = ToolSearch.makeIndex()
    const catalog = snapshot([catalogTool({ name: "calendar_create", description: "Create calendar events" })])
    const invalid = [
      { query: " " },
      { query: "calendar", limit: 0 },
      { query: "calendar", limit: -1 },
      { query: "calendar", limit: 1.5 },
      { query: "calendar", limit: 21 },
    ]

    for (const input of invalid) {
      const error = Effect.runSync(Effect.flip(index.search(catalog, input)))
      expect(error).toBeInstanceOf(ToolSearch.SearchError)
    }
  })

  test("selects exact callable names and ToolKeys in requested order", () => {
    const first = catalogTool({ name: "calendar_create", description: "Create calendar events" })
    const second = catalogTool({ name: "chat_search", description: "Search chat history" })
    const result = Effect.runSync(
      ToolSearch.makeIndex().search(snapshot([first, second]), {
        query: `select:${second.callableName},${first.key},${second.callableName}`,
      }),
    )

    expect(result.matches.map((match) => match.key)).toEqual([second.key, first.key])
    expect(result.matches[0]).toMatchObject({
      callableName: "chat_search",
      definitionHash: second.definitionHash,
      source,
      deferLoading: true,
    })
  })

  test("prefers exact names, ranks nested schema terms with BM25, and excludes direct tools", () => {
    const exact = catalogTool({ name: "chromatic", description: "A short exact tool" })
    const nested = catalogTool({
      name: "render_palette",
      description: "Render a visual palette",
      inputSchema: {
        type: "object",
        properties: {
          options: {
            description: "Reticulated rendering controls",
            anyOf: [{ type: "object", properties: { hue: { type: "string", enum: ["violet", "amber"] } } }],
          },
        },
      },
    })
    const direct = catalogTool({ name: "direct_violet", description: "Reticulated violet", exposure: "direct" })
    const index = ToolSearch.makeIndex()
    const catalog = snapshot([direct, nested, exact])

    expect(Effect.runSync(index.search(catalog, { query: "chromatic" })).matches[0]?.key).toBe(exact.key)
    expect(
      Effect.runSync(index.search(catalog, { query: "reticulated violet" })).matches.map((match) => match.key),
    ).toEqual([nested.key])
  })

  test("returns no fallback matches and reports only authorized pending catalog sources", () => {
    const pending = { type: "mcp" as const, id: "weather", displayName: "Weather" }
    const result = Effect.runSync(
      ToolSearch.makeIndex().search(
        snapshot(
          [catalogTool({ name: "calendar_create", description: "Create calendar events" })],
          [{ source: pending, state: "pending" }],
        ),
        { query: "quantum accounting" },
      ),
    )

    expect(result.matches).toEqual([])
    expect(result.pendingSources).toEqual([{ source: pending, state: "pending" }])
  })

  test("reuses the same revision index and rebuilds deterministically when revision changes", () => {
    const tool = catalogTool({ name: "calendar_create", description: "Create calendar events" })
    const index = ToolSearch.makeIndex()
    const ready = snapshot([tool])
    const failed = snapshot([tool], [{ source, state: "failed" }])

    Effect.runSync(index.search(ready, { query: "calendar" }))
    Effect.runSync(index.search(ready, { query: "events" }))
    expect(index.builds()).toBe(1)
    Effect.runSync(index.search(failed, { query: "calendar" }))
    expect(index.builds()).toBe(2)
  })

  test("defaults to eight deterministic matches and refuses an oversized exact selection", () => {
    const tools = Array.from({ length: 21 }, (_, index) =>
      catalogTool({ name: `common_${String(index).padStart(2, "0")}`, description: "Common operation" }),
    )
    const index = ToolSearch.makeIndex()
    const catalog = snapshot(tools)
    const result = Effect.runSync(index.search(catalog, { query: "common operation" }))

    expect(result.matches).toHaveLength(8)
    expect(result.matches.map((match) => match.key)).toEqual([...result.matches.map((match) => match.key)].toSorted())
    const error = Effect.runSync(
      Effect.flip(
        index.search(catalog, {
          query: `select:${tools.map((tool) => tool.callableName).join(",")}`,
          limit: 20,
        }),
      ),
    )
    expect(error.message).toContain("more than the requested limit")
  })
})

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [[ToolOutputStore.node, outputStore]])
const it = testEffect(registryLayer)

const hello = () =>
  Tool.withExposure(
    Tool.make({
      description: "Says hello",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.Struct({ greeting: Schema.String }),
      execute: ({ name }) => Effect.succeed({ greeting: `hello ${name}` }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: output.greeting }],
    }),
    "deferred",
  )
const direct = () =>
  Tool.make({
    description: "Says direct",
    input: Schema.Struct({}),
    output: Schema.Struct({ text: Schema.String }),
    execute: () => Effect.succeed({ text: "direct" }),
    toModelOutput: ({ output }) => [{ type: "text" as const, text: output.text }],
  })
const call = (name: string, input: Record<string, unknown>, id = `call-${name}`): ToolRegistry.ExecuteInput => ({
  sessionID: SessionV2.ID.make("ses_tool_search"),
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_tool_search"),
  call: { type: "tool-call", id, name, input },
})

describe("materialize tool_search", () => {
  it.effect("exposes tool_search and can settle a deferred tool call after searching", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello() })
      let selected = new Map<ToolCatalog.Key, string>()
      const materialized = yield* service.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        executeSearch: (_input, _context, _snapshot, search) =>
          search.pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                selected = new Map(result.matches.map((match) => [match.key, match.definitionHash]))
              }),
            ),
          ),
      })
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(true)
      // P5: a deferred tool is rejected until the model searches for it.
      const denied = yield* materialized.settle(call("hello", { name: "bob" }))
      expect(denied.result.type).toBe("error")
      expect(denied.result.value).toContain("unsupported call: hello")
      // After tool_search selects it, a fresh materialization can run it.
      yield* materialized.settle(call("tool_search", { query: "hello" }))
      const next = yield* service.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
      })
      const settlement = yield* next.settle(call("hello", { name: "bob" }))
      expect(settlement.result).toEqual({ type: "text", value: "hello bob" })
    }),
  )

  it.effect("marks discovery and selected deferred definitions without tagging direct tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        direct: direct(),
        hello: Tool.withCatalog(hello(), {
          source: { type: "builtin", id: "opencode", displayName: "OpenCode" },
          sourceLocalID: "hello",
          namespace: "opencode",
        }),
      })
      const first = yield* service.materialize()
      const search = first.definitions.find((tool) => tool.name === ToolSearch.name)
      const directDefinition = first.definitions.find((tool) => tool.name === "direct")
      const deferred = first.catalog.tools.find((tool) => tool.callableName === "hello")

      expect(search).toMatchObject({ kind: "tool-search" })
      expect(directDefinition?.deferLoading).toBeUndefined()
      expect(deferred).toBeDefined()

      const selected = yield* service.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected: new Map(deferred ? [[deferred.key, deferred.definitionHash]] : []),
      })
      expect(selected.definitions.find((tool) => tool.name === "hello")).toMatchObject({
        deferLoading: true,
        namespace: "opencode",
      })
      expect(selected.definitions.find((tool) => tool.name === "direct")?.deferLoading).toBeUndefined()
    }),
  )

  it.effect("settles a tool_search call with matching-tool text", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello() })
      const materialized = yield* service.materialize()
      const settlement = yield* materialized.settle(call("tool_search", { query: "hello" }))
      expect(settlement.result).toMatchObject({
        type: "text",
        value: expect.stringContaining("Says hello"),
      })
    }),
  )

  it.effect("does not advertise tool_search without deferred tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ direct: direct() })
      const materialized = yield* service.materialize()
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(false)
      const settlement = yield* materialized.settle(call("tool_search", { query: "hello" }))
      expect(settlement.result).toEqual({ type: "error", value: "Unknown tool: tool_search" })
    }),
  )

  it.effect("hides tool_search when overridden off", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello() })
      const materialized = yield* service.materialize([], { tool_search: false })
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(false)
      expect(materialized.deferred.map((tool) => tool.name)).toContain("hello")
      const settlement = yield* materialized.settle(call("tool_search", { query: "hello" }))
      expect(settlement.result).toEqual({ type: "error", value: "Unknown tool: tool_search" })
    }),
  )

  it.effect("hides tool_search when a permission deny rule matches", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello() })
      const materialized = yield* service.materialize([{ action: "tool_search", resource: "*", effect: "deny" }])
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(false)
      const settlement = yield* materialized.settle(call("tool_search", { query: "hello" }))
      expect(settlement.result).toEqual({ type: "error", value: "Unknown tool: tool_search" })
    }),
  )

  it.effect("limits child discovery to the explicitly granted deferred tool", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello(), secret: hello() })
      const permissions: PermissionV2.Ruleset = [
        { action: "*", resource: "*", effect: "deny" },
        { action: "hello", resource: "*", effect: "allow" },
        { action: "tool_search", resource: "*", effect: "allow" },
      ]
      let selected = new Map<ToolCatalog.Key, string>()
      const materialized = yield* service.materialize(permissions, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        executeSearch: (_input, _context, _snapshot, search) =>
          search.pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                selected = new Map(result.matches.map((match) => [match.key, match.definitionHash]))
              }),
            ),
          ),
      })

      expect(materialized.catalog.tools.map((tool) => tool.callableName)).toEqual(["hello"])
      expect(materialized.definitions.map((tool) => tool.name)).toContain("tool_search")
      const search = yield* materialized.settle(call("tool_search", { query: "select:hello" }))
      expect(search.result.type).toBe("text")
      expect(String(search.result.value)).not.toContain("secret")

      const selectedTools = yield* service.materialize(permissions, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
      })
      expect(selectedTools.definitions.map((tool) => tool.name)).toContain("hello")
      expect(selectedTools.definitions.map((tool) => tool.name)).not.toContain("secret")
    }),
  )
})

const todoPermission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const sessionTodo = Layer.succeed(
  SessionTodo.Service,
  SessionTodo.Service.of({
    update: () => Effect.void,
    get: () => Effect.succeed([]),
  }),
)
const builtinLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, TodoWriteTool.node]), [
  [ToolOutputStore.node, outputStore],
  [PermissionV2.node, todoPermission],
  [SessionTodo.node, sessionTodo],
])
const itBuiltin = testEffect(builtinLayer)

describe("shipped builtin e2e", () => {
  itBuiltin.effect("advertises the shipped todowrite builtin directly without tool_search", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const materialized = yield* service.materialize()
      expect(materialized.definitions.some((tool) => tool.name === "todowrite")).toBe(true)
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(false)
      expect(materialized.deferred).toEqual([])
      const settlement = yield* materialized.settle(
        call("todowrite", {
          todos: [{ content: "finish tool exposure", status: "pending", priority: "low" }],
        }),
      )
      expect(settlement.result).toMatchObject({ type: "text" })
    }),
  )
})
