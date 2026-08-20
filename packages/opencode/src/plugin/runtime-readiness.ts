import path from "node:path"
import type { CommandV2 } from "@opencode-ai/core/command"
import type { SkillV2 } from "@opencode-ai/core/skill"
import type { ToolCatalog } from "@opencode-ai/core/tool/catalog"
import { Plugin } from "@opencode-ai/schema/plugin"
import type { Mcp } from "@opencode-ai/schema/mcp"
import type { RuntimeDescriptor } from "./claude-marketplace"

export type RuntimeObservations = {
  readonly skills: readonly SkillV2.Info[]
  readonly commands: readonly CommandV2.Info[]
  readonly mcp: Readonly<Record<string, Mcp.Status>>
  readonly plugins: Readonly<Record<string, Plugin.LoadStatus>>
  readonly toolSources: readonly ToolCatalog.SourceStatus[]
}

export function runtimeSnapshot(
  descriptors: readonly RuntimeDescriptor[],
  observations: RuntimeObservations,
  initializing = false,
): Plugin.RuntimeSnapshot {
  return {
    plugins: descriptors.map((descriptor) => {
      const capabilities = descriptor.capabilities.map((name) =>
        descriptor.enabled
          ? capability(name, descriptor, observations, initializing)
          : { name, state: "disabled" as const },
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
  initializing: boolean,
): Plugin.RuntimeCapability {
  switch (name) {
    case "skills": {
      if (!descriptor.skillDirectory) {
        return { name, state: "failed", message: "Skill artifacts were not materialized" }
      }
      const ready = observations.skills.some((skill) => inside(descriptor.skillDirectory!, skill.location))
      if (!ready && initializing) return { name, state: "pending" }
      return ready
        ? { name, state: "ready" }
        : { name, state: "failed", message: "Skill contribution was not discovered" }
    }
    case "commands": {
      if (descriptor.commandNames.length === 0) {
        return { name, state: "failed", message: "Command artifacts were not materialized" }
      }
      const available = new Set(observations.commands.map((command) => command.name))
      const ready = descriptor.commandNames.every((command) => available.has(command))
      if (!ready && initializing) return { name, state: "pending" }
      return ready
        ? { name, state: "ready" }
        : { name, state: "failed", message: "Command contributions were not discovered" }
    }
    case "mcp":
      return mcpCapability(descriptor, observations, initializing)
    case "plugin": {
      if (!descriptor.pluginRuntimeID) {
        return { name, state: "failed", message: "Plugin runtime identity is unavailable" }
      }
      const exact = observations.plugins[descriptor.pluginRuntimeID]
      const statuses = exact
        ? [exact]
        : Object.entries(observations.plugins).flatMap(([id, status]) =>
            id.startsWith(`${descriptor.pluginRuntimeID}#`) ? [status] : [],
          )
      if (statuses.length === 0 && initializing) return { name, state: "pending" }
      if (statuses.length === 0) return { name, state: "failed", message: "Plugin runtime did not register" }
      if (statuses.some((status) => status.state === "initializing")) return { name, state: "pending" }
      if (statuses.every((status) => status.state === "ready")) return { name, state: "ready" }
      const failed = statuses.find((status) => status.state === "failed")
      return { name, state: "failed", ...(failed?.message ? { message: failed.message } : {}) }
    }
    case "tools":
      return toolCapability(descriptor, observations, initializing)
  }
}

function toolCapability(
  descriptor: RuntimeDescriptor,
  observations: RuntimeObservations,
  initializing: boolean,
): Plugin.RuntimeCapability {
  const name = "tools" as const
  if (descriptor.toolSourceIDs.length === 0) {
    return { name, state: "failed", message: "Tool source identities are unavailable" }
  }
  const sources = new Map(
    observations.toolSources.flatMap((status) =>
      status.source.type === "plugin" ? [[status.source.id, status] as const] : [],
    ),
  )
  const states = descriptor.toolSourceIDs.map((id) => sources.get(id))
  const observed = states.filter((status): status is ToolCatalog.SourceStatus => status !== undefined)
  if (observed.length !== states.length) {
    if (initializing) return { name, state: "pending" }
    return { name, state: "failed", message: "Plugin tool sources were not observed" }
  }
  if (observed.some((status) => status.state === "pending")) return { name, state: "pending" }
  if (observed.every((status) => status.state === "ready")) return { name, state: "ready" }
  return {
    name,
    state: "failed",
    message: `Unavailable tool sources: ${observed.filter((status) => status.state !== "ready").length}`,
  }
}

function mcpCapability(
  descriptor: RuntimeDescriptor,
  observations: RuntimeObservations,
  initializing: boolean,
): Plugin.RuntimeCapability {
  const name = "mcp" as const
  if (descriptor.mcpServers.length === 0) {
    return { name, state: "failed", message: "MCP server configuration was not materialized" }
  }
  const states = descriptor.mcpServers.map((server) => observations.mcp[server])
  if (states.some((status) => status === undefined)) {
    if (initializing) return { name, state: "pending" }
    return { name, state: "failed", message: "MCP server state was not observed" }
  }
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
