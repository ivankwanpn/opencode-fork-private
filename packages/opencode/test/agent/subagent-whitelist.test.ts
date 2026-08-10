import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"
import { locationServiceMapReplacement } from "../lib/location-service-map"

const it = testEffect(LayerNode.compile(Agent.node, [locationServiceMapReplacement]))

// Spec §3.3 minimal tool whitelists for the four subagent roles. These tables
// must stay identical to the mirror in
// packages/core/test/agent-whitelist.test.ts (V2) — keep them in sync to
// prevent drift between the V1 and V2 built-in agent definitions.
const SUBAGENT_WHITELISTS: Record<string, { allow: readonly string[]; deny: readonly string[] }> = {
  general: {
    allow: ["bash", "read", "write", "edit", "grep", "glob", "webfetch", "websearch", "task", "skill"],
    deny: ["todowrite", "playwright_browser_navigate", "mcp_playwright_snapshot", "browser_run_code_unsafe"],
  },
  explore: {
    allow: ["read", "grep", "glob", "webfetch", "websearch"],
    deny: [
      "bash",
      "list",
      "write",
      "edit",
      "task",
      "skill",
      "playwright_browser_navigate",
      "browser_run_code_unsafe",
    ],
  },
  research: {
    allow: ["read", "grep", "glob", "webfetch", "websearch"],
    deny: [
      "bash",
      "list",
      "write",
      "edit",
      "task",
      "skill",
      // RCE regression: the playwright wildcard rules must be gone.
      "playwright_browser_navigate",
      "mcp_playwright_browser_navigate",
      "claude_claude-plugins-official_playwright_playwright_browser_take_screenshot",
      "browser_run_code_unsafe",
    ],
  },
  worker: {
    allow: ["bash", "read", "write", "edit", "grep", "glob", "webfetch", "task"],
    deny: ["skill", "todowrite", "playwright_browser_navigate", "mcp_playwright_snapshot", "browser_run_code_unsafe"],
  },
}

function evaluate(agent: Agent.Info | undefined, tool: string) {
  expect(agent).toBeDefined()
  return Permission.evaluate(tool, "*", agent!.permission).action
}

for (const [role, { allow, deny }] of Object.entries(SUBAGENT_WHITELISTS)) {
  it.instance(`${role} subagent enforces the spec §3.3 tool whitelist`, () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get(role)
      for (const tool of allow) {
        expect(evaluate(agent, tool), `${role}.${tool} should be allowed`).toBe("allow")
      }
      for (const tool of deny) {
        expect(evaluate(agent, tool), `${role}.${tool} should be denied`).toBe("deny")
      }
    }),
  )
}

// The whitelist must not regress the protective `read` rules: `*.env` stays
// "ask" and `*.env.example` stays "allow" for every subagent role.
for (const role of Object.keys(SUBAGENT_WHITELISTS)) {
  it.instance(`${role} subagent preserves read .env handling`, () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get(role)
      expect(agent).toBeDefined()
      expect(Permission.evaluate("read", "some/path/.env", agent!.permission).action).toBe("ask")
      expect(Permission.evaluate("read", "some/path/.env.local", agent!.permission).action).toBe("ask")
      expect(Permission.evaluate("read", "some/path/.env.example", agent!.permission).action).toBe("allow")
      expect(Permission.evaluate("read", "some/path/README.md", agent!.permission).action).toBe("allow")
    }),
  )
}
