import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [
  [ToolOutputStore.node, outputStore],
])
const it = testEffect(registryLayer)

// Minimal external-tool stand-ins: a benign MCP-style browser tool, an
// RCE-equivalent browser tool, and a plain builtin.
const tool = (name: string, description: string, exposure: "direct" | "deferred" = "direct") =>
  Tool.withExposure(
    Tool.make({
      description,
      input: Schema.Struct({}),
      output: Schema.Struct({ ok: Schema.Boolean }),
      execute: () => Effect.succeed({ ok: true }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: String(output.ok) }],
    }),
    exposure,
  )

// Spec §3.3 whitelists as V2 rulesets (mirrors agent-whitelist.test.ts).
const WHITELISTS: Record<string, { allow: readonly string[]; deny: readonly string[] }> = {
  general: { allow: ["bash", "read", "write", "edit", "grep", "glob", "webfetch", "websearch", "task", "skill"], deny: [] },
  explore: { allow: ["read", "grep", "glob", "webfetch", "websearch"], deny: [] },
  research: { allow: ["read", "grep", "glob", "webfetch", "websearch"], deny: [] },
  worker: { allow: ["bash", "read", "write", "edit", "grep", "glob", "webfetch", "task"], deny: [] },
}

const whitelistRules = (role: (typeof WHITELISTS)[keyof typeof WHITELISTS]): PermissionV2.Ruleset => [
  { action: "*", resource: "*", effect: "deny" },
  ...role.allow.map((action) => ({ action, resource: "*", effect: "allow" as const })),
]

describe("RCE escape regression: subagents cannot reach MCP/browser tools", () => {
  it.effect("no subagent role materializes MCP or RCE tools into definitions or tool_search", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        read: tool("read", "Read a file"),
        bash: tool("bash", "Execute a shell command"),
        playwright_snapshot: tool("playwright_snapshot", "Take a browser screenshot", "deferred"),
        browser_run_code_unsafe: tool("browser_run_code_unsafe", "Run arbitrary code in the browser", "deferred"),
      })

      for (const [role, whitelist] of Object.entries(WHITELISTS)) {
        const materialized = yield* registry.materialize(whitelistRules(whitelist))
        const names = [
          ...materialized.definitions.map((definition) => definition.name),
          ...materialized.deferred.map((definition) => definition.name),
        ]
        expect(materialized.definitions.some((definition) => definition.name === "read")).toBe(
          whitelist.allow.includes("read"),
        )
        // MCP/browser tools are never advertised to any subagent role.
        expect(names).not.toContain("playwright_snapshot")
        expect(names).not.toContain("browser_run_code_unsafe")
      }
    }),
  )
})
