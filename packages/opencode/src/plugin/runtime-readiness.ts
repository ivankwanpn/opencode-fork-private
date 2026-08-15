import path from "node:path"
import type { CommandV2 } from "@opencode-ai/core/command"
import type { SkillV2 } from "@opencode-ai/core/skill"
import { Plugin } from "@opencode-ai/schema/plugin"
import type { Mcp } from "@opencode-ai/schema/mcp"
import type { RuntimeDescriptor } from "./claude-marketplace"

export type RuntimeObservations = {
  readonly skills: readonly SkillV2.Info[]
  readonly commands: readonly CommandV2.Info[]
  readonly mcp: Readonly<Record<string, Mcp.Status>>
  readonly plugins: Readonly<Record<string, Plugin.LoadStatus>>
}

export function runtimeSnapshot(
  descriptors: readonly RuntimeDescriptor[],
  observations: RuntimeObservations,
): Plugin.RuntimeSnapshot {
  return {
    plugins: descriptors.map((descriptor) => {
      const capabilities = descriptor.capabilities.map((name) =>
        descriptor.enabled ? capability(name, descriptor, observations) : { name, state: "disabled" as const },
      )
      return {
        id: Plugin.ID.make(descriptor.id),
        state: overall(descriptor.enabled, capabilities),
        capabilities,
      }
    }),
  }
}

function capability(
  name: Plugin.RuntimeCapabilityName,
  descriptor: RuntimeDescriptor,
  observations: RuntimeObservations,
): Plugin.RuntimeCapability {
  if (name === "skills") {
    if (!descriptor.skillDirectory) {
      return { name, state: "failed", message: "Skill artifacts were not materialized" }
    }
    const ready = observations.skills.some((skill) => inside(descriptor.skillDirectory!, skill.location))
    return { name, state: ready ? "ready" : "pending" }
  }

  if (name === "commands") {
    if (descriptor.commandNames.length === 0) {
      return { name, state: "failed", message: "Command artifacts were not materialized" }
    }
    const available = new Set(observations.commands.map((command) => command.name))
    const ready = descriptor.commandNames.every((command) => available.has(command))
    return { name, state: ready ? "ready" : "pending" }
  }

  if (name === "mcp") return mcpCapability(descriptor, observations)

  if (name === "plugin") {
    if (!descriptor.pluginRuntimeID) {
      return { name, state: "failed", message: "Plugin runtime identity is unavailable" }
    }
    const status = observations.plugins[descriptor.pluginRuntimeID]
    if (!status || status.state === "initializing") return { name, state: "pending" }
    if (status.state === "ready") return { name, state: "ready" }
    return { name, state: "failed", ...(status.message ? { message: status.message } : {}) }
  }

  return { name, state: "pending" }
}

function mcpCapability(descriptor: RuntimeDescriptor, observations: RuntimeObservations): Plugin.RuntimeCapability {
  const name = "mcp" as const
  if (descriptor.mcpServers.length === 0) {
    return { name, state: "failed", message: "MCP server configuration was not materialized" }
  }
  const states = descriptor.mcpServers.map((server) => observations.mcp[server])
  if (states.some((status) => status === undefined)) return { name, state: "pending" }
  if (states.every((status) => status?.status === "connected")) return { name, state: "ready" }
  const failed = states.find((status) => status?.status !== "connected")
  if (!failed) return { name, state: "pending" }
  if (failed.status === "failed" || failed.status === "needs_client_registration") {
    return { name, state: "failed", message: failed.error }
  }
  if (failed.status === "needs_auth") {
    return { name, state: "failed", message: "MCP server needs authentication" }
  }
  return { name, state: "failed", message: "MCP server is disabled" }
}

function overall(enabled: boolean, capabilities: readonly Plugin.RuntimeCapability[]): Plugin.RuntimeState {
  if (!enabled) return "disabled"
  if (capabilities.some((capability) => capability.state === "pending")) return "initializing"
  if (capabilities.length > 0 && capabilities.every((capability) => capability.state === "ready")) return "ready"
  if (
    capabilities.some((capability) => capability.state === "ready") &&
    capabilities.some((capability) => capability.state === "failed")
  )
    return "degraded"
  return "failed"
}

function inside(directory: string, file: string) {
  const relative = path.relative(directory, file)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
