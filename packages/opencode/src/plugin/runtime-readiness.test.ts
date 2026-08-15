import path from "node:path"
import { describe, expect, test } from "bun:test"
import { AbsolutePath } from "@opencode-ai/core/schema"
import type { Mcp } from "@opencode-ai/schema/mcp"
import { Plugin } from "@opencode-ai/schema/plugin"
import type { RuntimeDescriptor } from "./claude-marketplace"
import { runtimeSnapshot, type RuntimeObservations } from "./runtime-readiness"

const root = path.resolve("runtime-readiness-test")

function descriptor(input: Partial<RuntimeDescriptor> = {}): RuntimeDescriptor {
  return {
    id: "demo@marketplace",
    enabled: true,
    capabilities: ["skills", "commands", "mcp"],
    skillDirectory: path.join(root, "skills"),
    commandNames: ["claude/marketplace__demo/demo"],
    mcpServers: ["claude:marketplace:demo:server"],
    ...input,
  }
}

function observations(input: Partial<RuntimeObservations> = {}): RuntimeObservations {
  return {
    skills: [],
    commands: [],
    mcp: {},
    plugins: {},
    ...input,
  }
}

describe("plugin runtime readiness", () => {
  test("reports every declared capability as disabled when plugin management is disabled", () => {
    const result = runtimeSnapshot([descriptor({ enabled: false })], observations())

    expect(result.plugins).toEqual([
      {
        id: Plugin.ID.make("demo@marketplace"),
        state: "disabled",
        capabilities: [
          { name: "skills", state: "disabled" },
          { name: "commands", state: "disabled" },
          { name: "mcp", state: "disabled" },
        ],
      },
    ])
  })

  test("reports initializing while expected contributions are not observed", () => {
    const result = runtimeSnapshot([descriptor()], observations())

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "initializing",
      capabilities: [
        { name: "skills", state: "pending" },
        { name: "commands", state: "pending" },
        { name: "mcp", state: "pending" },
      ],
    })
  })

  test("reports ready only from observed Skill, Command, MCP, and PluginV2 contributions", () => {
    const runtime = descriptor({
      capabilities: ["skills", "commands", "mcp", "plugin"],
      pluginRuntimeID: "claude-marketplace/marketplace/demo",
    })
    const result = runtimeSnapshot(
      [runtime],
      observations({
        skills: [
          {
            name: "demo",
            location: AbsolutePath.make(path.join(root, "skills", "demo", "SKILL.md")),
            content: "Demo skill",
          },
        ],
        commands: [{ name: "claude/marketplace__demo/demo", template: "Demo command" }],
        mcp: { "claude:marketplace:demo:server": { status: "connected" } },
        plugins: { "claude-marketplace/marketplace/demo": { state: "ready" } },
      }),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "ready",
      capabilities: [
        { name: "skills", state: "ready" },
        { name: "commands", state: "ready" },
        { name: "mcp", state: "ready" },
        { name: "plugin", state: "ready" },
      ],
    })
  })

  test("reports degraded when one contribution is ready and another has terminal failure", () => {
    const result = runtimeSnapshot(
      [descriptor({ capabilities: ["skills", "mcp"] })],
      observations({
        skills: [
          {
            name: "demo",
            location: AbsolutePath.make(path.join(root, "skills", "demo", "SKILL.md")),
            content: "Demo skill",
          },
        ],
        mcp: { "claude:marketplace:demo:server": { status: "failed", error: "process exited" } },
      }),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "degraded",
      capabilities: [
        { name: "skills", state: "ready" },
        { name: "mcp", state: "failed", message: "process exited" },
      ],
    })
  })

  test("maps terminal MCP states to failed capability diagnostics", () => {
    const cases: Array<{ status: Mcp.Status; message: string }> = [
      { status: { status: "disabled" }, message: "MCP server is disabled" },
      { status: { status: "failed", error: "spawn failed" }, message: "spawn failed" },
      { status: { status: "needs_auth" }, message: "MCP server needs authentication" },
      {
        status: { status: "needs_client_registration", error: "registration required" },
        message: "registration required",
      },
    ]

    for (const item of cases) {
      expect(
        runtimeSnapshot(
          [descriptor({ capabilities: ["mcp"] })],
          observations({ mcp: { "claude:marketplace:demo:server": item.status } }),
        ).plugins[0],
      ).toEqual({
        id: Plugin.ID.make("demo@marketplace"),
        state: "failed",
        capabilities: [{ name: "mcp", state: "failed", message: item.message }],
      })
    }
  })

  test("keeps ToolRegistry-backed tools pending until canonical source state is implemented", () => {
    const result = runtimeSnapshot(
      [descriptor({ capabilities: ["tools"], skillDirectory: undefined, commandNames: [], mcpServers: [] })],
      observations(),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "initializing",
      capabilities: [{ name: "tools", state: "pending" }],
    })
  })
})
