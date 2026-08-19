import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AgentPlugin } from "@opencode-ai/core/plugin/agent"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"

const it = testEffect(AppNodeBuilder.build(AgentV2.node))

// Spec §3.3 minimal tool whitelists for the four subagent roles.
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

describe("subagent whitelists", () => {
  function effect(info: AgentV2.Info | undefined, action: string) {
    expect(info).toBeDefined()
    return PermissionV2.evaluate(action, "*", info!.permissions).effect
  }

  function applyAgentPlugin(agent: AgentV2.Interface) {
    return AgentPlugin.Plugin.effect(
      host({
        agent: agentHost(agent),
      }),
    ).pipe(
      Effect.provideService(
        Location.Service,
        Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
      ),
    )
  }

  for (const [role, { allow, deny }] of Object.entries(SUBAGENT_WHITELISTS)) {
    it.effect(`${role} subagent enforces the spec §3.3 tool whitelist`, () =>
      Effect.gen(function* () {
        const agent = yield* AgentV2.Service
        yield* applyAgentPlugin(agent)
        const info = yield* agent.get(AgentV2.ID.make(role))
        for (const tool of allow) {
          expect(effect(info, tool), `${role}.${tool} should be allowed`).toBe("allow")
        }
        for (const tool of deny) {
          expect(effect(info, tool), `${role}.${tool} should be denied`).toBe("deny")
        }
      }),
    )
  }

  for (const role of Object.keys(SUBAGENT_WHITELISTS)) {
    it.effect(`${role} subagent preserves read .env handling`, () =>
      Effect.gen(function* () {
        const agent = yield* AgentV2.Service
        yield* applyAgentPlugin(agent)
        const info = yield* agent.get(AgentV2.ID.make(role))
        expect(info).toBeDefined()
        expect(PermissionV2.evaluate("read", "some/path/.env", info!.permissions).effect).toBe("ask")
        expect(PermissionV2.evaluate("read", "some/path/.env.local", info!.permissions).effect).toBe("ask")
        expect(PermissionV2.evaluate("read", "some/path/.env.example", info!.permissions).effect).toBe("allow")
        expect(PermissionV2.evaluate("read", "some/path/README.md", info!.permissions).effect).toBe("allow")
      }),
    )
  }
})
