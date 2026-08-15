import path from "node:path"
import { describe, expect, test } from "bun:test"
import { AbsolutePath } from "@opencode-ai/core/schema"
import type { ToolCatalog } from "@opencode-ai/core/tool/catalog"
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
    toolSourceIDs: ["claude-marketplace/marketplace/demo"],
    ...input,
  }
}

function observations(input: Partial<RuntimeObservations> = {}): RuntimeObservations {
  return {
    skills: [],
    commands: [],
    mcp: {},
    plugins: {},
    toolSources: [],
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

  test("keeps tools pending until every expected Plugin source is observed and ready", () => {
    const runtime = descriptor({
      capabilities: ["tools"],
      skillDirectory: undefined,
      commandNames: [],
      mcpServers: [],
      toolSourceIDs: ["claude-marketplace/marketplace/demo", "claude-marketplace/marketplace/helper"],
    })
    const pending: ToolCatalog.SourceStatus = {
      source: { type: "plugin", id: "claude-marketplace/marketplace/demo" },
      state: "pending",
    }

    for (const toolSources of [[], [pending]]) {
      expect(runtimeSnapshot([runtime], observations({ toolSources })).plugins[0]).toEqual({
        id: Plugin.ID.make("demo@marketplace"),
        state: "initializing",
        capabilities: [{ name: "tools", state: "pending" }],
      })
    }
  })

  test("reports tools ready only when every exact Plugin source is ready", () => {
    const result = runtimeSnapshot(
      [
        descriptor({
          capabilities: ["tools"],
          skillDirectory: undefined,
          commandNames: [],
          mcpServers: [],
          toolSourceIDs: ["claude-marketplace/marketplace/demo"],
        }),
      ],
      observations({
        toolSources: [
          { source: { type: "mcp", id: "claude-marketplace/marketplace/demo" }, state: "ready" },
          { source: { type: "plugin", id: "claude-marketplace/marketplace/demo" }, state: "ready" },
        ],
      }),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "ready",
      capabilities: [{ name: "tools", state: "ready" }],
    })
  })

  test("reports terminal tool source states with a count-only diagnostic", () => {
    const runtime = descriptor({
      capabilities: ["tools"],
      skillDirectory: undefined,
      commandNames: [],
      mcpServers: [],
      toolSourceIDs: ["claude-marketplace/marketplace/demo", "claude-marketplace/marketplace/helper"],
    })
    const result = runtimeSnapshot(
      [runtime],
      observations({
        toolSources: [
          {
            source: { type: "plugin", id: "claude-marketplace/marketplace/demo" },
            state: "failed",
            message: "secret path and arguments must not escape",
          },
          {
            source: { type: "plugin", id: "claude-marketplace/marketplace/helper" },
            state: "disabled",
          },
        ],
      }),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "failed",
      capabilities: [{ name: "tools", state: "failed", message: "Unavailable tool sources: 2" }],
    })
  })

  test("reports mixed ready and failed tool sources as a failed capability and degraded plugin", () => {
    const result = runtimeSnapshot(
      [
        descriptor({
          capabilities: ["commands", "tools"],
          skillDirectory: undefined,
          mcpServers: [],
          toolSourceIDs: ["claude-marketplace/marketplace/demo", "claude-marketplace/marketplace/helper"],
        }),
      ],
      observations({
        commands: [{ name: "claude/marketplace__demo/demo", template: "Demo command" }],
        toolSources: [
          { source: { type: "plugin", id: "claude-marketplace/marketplace/demo" }, state: "ready" },
          { source: { type: "plugin", id: "claude-marketplace/marketplace/helper" }, state: "failed" },
        ],
      }),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "degraded",
      capabilities: [
        { name: "commands", state: "ready" },
        { name: "tools", state: "failed", message: "Unavailable tool sources: 1" },
      ],
    })
  })

  test("reports disabled tool capabilities without inspecting source state", () => {
    const result = runtimeSnapshot(
      [
        descriptor({
          enabled: false,
          capabilities: ["tools"],
          skillDirectory: undefined,
          commandNames: [],
          mcpServers: [],
          toolSourceIDs: ["claude-marketplace/marketplace/demo"],
        }),
      ],
      observations({
        toolSources: [
          {
            source: { type: "plugin", id: "claude-marketplace/marketplace/demo" },
            state: "failed",
            message: "must not be inspected",
          },
        ],
      }),
    )

    expect(result.plugins[0]).toEqual({
      id: Plugin.ID.make("demo@marketplace"),
      state: "disabled",
      capabilities: [{ name: "tools", state: "disabled" }],
    })
  })
})
