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
import { searchDeferred, ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolDefinition } from "@opencode-ai/llm"
import { testEffect } from "./lib/effect"

const def = (name: string, description: string): ToolDefinition =>
  new ToolDefinition({ name, description, inputSchema: {} })

describe("searchDeferred", () => {
  test("ranks description matches over non-matches", () => {
    const tools = [
      def("playwright_snapshot", "Take a screenshot of the current browser page"),
      def("bash", "Execute a shell command"),
    ]
    const hits = searchDeferred("browser page screenshot", tools, 10)
    expect(hits[0]?.name).toBe("playwright_snapshot")
  })

  test("respects limit", () => {
    const tools = [
      def("a", "alpha beta gamma"),
      def("b", "alpha beta delta"),
      def("c", "alpha epsilon zeta"),
    ]
    const hits = searchDeferred("alpha beta", tools, 2)
    expect(hits.length).toBeLessThanOrEqual(2)
  })
})

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [
  [ToolOutputStore.node, outputStore],
])
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
  it.effect("exposes tool_search and can settle a deferred tool call", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello() })
      const materialized = yield* service.materialize()
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(true)
      const settlement = yield* materialized.settle(call("hello", { name: "bob" }))
      expect(settlement.result).toEqual({ type: "text", value: "hello bob" })
    }))

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
    }))

  it.effect("does not advertise tool_search without deferred tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ direct: direct() })
      const materialized = yield* service.materialize()
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(false)
      const settlement = yield* materialized.settle(call("tool_search", { query: "hello" }))
      expect(settlement.result).toEqual({ type: "error", value: "Unknown tool: tool_search" })
    }))
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
const builtinLayer = AppNodeBuilder.build(
  LayerNode.group([ToolRegistry.node, TodoWriteTool.node]),
  [
    [ToolOutputStore.node, outputStore],
    [PermissionV2.node, todoPermission],
    [SessionTodo.node, sessionTodo],
  ],
)
const itBuiltin = testEffect(builtinLayer)

describe("deferred builtin e2e", () => {
  itBuiltin.effect("routes the shipped todowrite builtin to deferred and tool_search finds it", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const materialized = yield* service.materialize()
      expect(materialized.definitions.some((tool) => tool.name === "todowrite")).toBe(false)
      expect(materialized.definitions.some((tool) => tool.name === "tool_search")).toBe(true)
      expect(materialized.deferred.map((tool) => tool.name)).toContain("todowrite")
      const hits = searchDeferred("track progress with a todo list", materialized.deferred, 5)
      expect(hits.some((tool) => tool.name === "todowrite")).toBe(true)
      const settlement = yield* materialized.settle(
        call("todowrite", {
          todos: [{ content: "finish tool exposure", status: "pending", priority: "low" }],
        }),
      )
      expect(settlement.result).toMatchObject({ type: "text" })
    }))
})
