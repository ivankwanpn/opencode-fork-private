import type { Plugin } from "@opencode-ai/schema/plugin"
import type { PluginLoadState } from "./plugin-load-state"

type RuntimeValue = {
  readonly data: {
    readonly plugins: readonly {
      readonly id: string
      readonly state: Plugin.RuntimeState
      readonly capabilities: readonly {
        readonly name: Plugin.RuntimeCapabilityName
        readonly state: Plugin.RuntimeCapabilityState
        readonly message?: string | null
      }[]
    }[]
  }
}

export type PluginRuntimePresentation = {
  readonly state: Plugin.RuntimeState
  readonly capabilities: readonly Plugin.RuntimeCapability[]
  readonly stale: boolean
  readonly message?: string
}

export function pluginRuntimePresentation(
  pluginID: string,
  runtime: PluginLoadState<RuntimeValue>,
): PluginRuntimePresentation {
  if (runtime.state === "idle" || runtime.state === "loading") {
    return { state: "initializing", capabilities: [], stale: false }
  }
  if (runtime.state === "failed") {
    return { state: "failed", capabilities: [], stale: false, message: runtime.error }
  }

  const plugin = runtime.value.data.plugins.find((item) => item.id === pluginID)
  if (plugin) {
    return {
      state: plugin.state,
      capabilities: plugin.capabilities.map((capability) => ({
        name: capability.name,
        state: capability.state,
        ...(capability.message !== undefined && capability.message !== null
          ? { message: capability.message }
          : {}),
      })),
      stale: runtime.state === "stale",
      ...(runtime.state === "stale" ? { message: runtime.error } : {}),
    }
  }
  if (runtime.state === "refreshing") {
    return { state: "initializing", capabilities: [], stale: false }
  }
  return {
    state: "failed",
    capabilities: [],
    stale: runtime.state === "stale",
    message: runtime.state === "stale" ? runtime.error : "Plugin runtime status is unavailable",
  }
}
