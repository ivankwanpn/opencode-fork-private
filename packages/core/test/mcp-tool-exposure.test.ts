import { describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Tool as MCPToolDefinition } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { McpCatalog } from "@opencode-ai/core/mcp"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"

describe("McpCatalog exposure", () => {
  test("isBlockedTool", () => {
    expect(McpCatalog.isBlockedTool("browser_run_code_unsafe", new Set(["browser_run_code_unsafe"]))).toBe(true)
    expect(McpCatalog.isBlockedTool("browser_snapshot", new Set(["browser_run_code_unsafe"]))).toBe(false)
  })

  test("isModelVisible: no _meta → visible", () => {
    const def = { name: "x", description: "d", inputSchema: { type: "object" as const } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(true)
  })

  test("isModelVisible: ui.visibility without 'model' → hidden", () => {
    const def = { name: "x", _meta: { ui: { visibility: ["manual"] } } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(false)
  })

  test("isModelVisible: ui.visibility including 'model' → visible", () => {
    const def = { name: "x", _meta: { ui: { visibility: ["model", "manual"] } } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(true)
  })

  test("isModelVisible: non-array visibility → visible", () => {
    const def = { name: "x", _meta: { ui: { visibility: "model" } } }
    expect(McpCatalog.isModelVisible(def as never)).toBe(true)
  })
})

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [
  [ToolOutputStore.node, outputStore],
])
const it = testEffect(registryLayer)

const definition = (name: string, meta?: Record<string, unknown>): MCPToolDefinition => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: "object", properties: {} },
  ...(meta ? { _meta: meta } : {}),
})

const entry = (name: string, meta?: Record<string, unknown>): McpCatalog.McpTool => ({
  clientName: "server",
  def: definition(name, meta),
  client: {
    callTool: () => Promise.reject(new Error("unused")),
  } as unknown as Client,
  timeout: 1000,
})

// Mirrors the toolsLayer.sync gates: blocked → skip, hidden → skip,
// directTools.has(name) → Direct, otherwise → Deferred.
function syncCatalog(
  entries: Record<string, McpCatalog.McpTool>,
  blocked: ReadonlySet<string>,
  direct: ReadonlySet<string>,
) {
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, current]) => !McpCatalog.isBlockedTool(current.def.name, blocked))
      .filter(([, current]) => McpCatalog.isModelVisible(current.def))
      .map(([name, current]) => {
        const coreTool = McpCatalog.toCoreTool(current)
        const exposure = direct.has(name) ? "direct" : "deferred"
        return [name, Tool.withExposure(coreTool, exposure)]
      }),
  )
}

describe("MCP tool exposure registration", () => {
  it.effect("routes deferred tools to deferred, direct tools to definitions, and drops blocked/hidden tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const catalog = syncCatalog(
        {
          server_echo: entry("echo"),
          server_search: entry("search"),
          server_unsafe: entry("browser_run_code_unsafe"),
          server_manual: entry("manual", { ui: { visibility: ["manual"] } }),
        },
        new Set(["browser_run_code_unsafe"]),
        new Set(["server_echo"]),
      )
      // Blocked and manual-hidden tools never make it into the catalog.
      expect(Object.keys(catalog).sort()).toEqual(["server_echo", "server_search"])

      yield* service.register(catalog)
      const materialized = yield* service.materialize()

      // Direct tool stays in definitions.
      expect(materialized.definitions.some((tool) => tool.name === "server_echo")).toBe(true)
      expect(materialized.deferred.some((tool) => tool.name === "server_echo")).toBe(false)

      // Default MCP tools land in deferred, not definitions.
      expect(materialized.definitions.some((tool) => tool.name === "server_search")).toBe(false)
      expect(materialized.deferred.some((tool) => tool.name === "server_search")).toBe(true)

      // Blocked and hidden tools land nowhere.
      for (const name of ["server_unsafe", "server_manual"]) {
        expect(materialized.definitions.some((tool) => tool.name === name)).toBe(false)
        expect(materialized.deferred.some((tool) => tool.name === name)).toBe(false)
      }
    }))
})
