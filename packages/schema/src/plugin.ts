export * as Plugin from "./plugin"

import { Schema } from "effect"
import { define, inventory } from "./event"

export const ID = Schema.String.pipe(Schema.brand("Plugin.ID"))
export type ID = typeof ID.Type

export const LoadState = Schema.Literals(["initializing", "ready", "failed"]).annotate({
  identifier: "PluginLoadState",
})
export type LoadState = typeof LoadState.Type

export const LoadStatus = Schema.Struct({
  state: LoadState,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginLoadStatus" })
export type LoadStatus = typeof LoadStatus.Type

export const RuntimeState = Schema.Literals(["disabled", "initializing", "ready", "degraded", "failed"]).annotate({
  identifier: "PluginRuntimeState",
})
export type RuntimeState = typeof RuntimeState.Type

export const RuntimeCapabilityName = Schema.Literals(["skills", "commands", "mcp", "plugin", "tools"]).annotate({
  identifier: "PluginRuntimeCapabilityName",
})
export type RuntimeCapabilityName = typeof RuntimeCapabilityName.Type

export const RuntimeCapabilityState = Schema.Literals(["disabled", "pending", "ready", "failed"]).annotate({
  identifier: "PluginRuntimeCapabilityState",
})
export type RuntimeCapabilityState = typeof RuntimeCapabilityState.Type

export const RuntimeCapability = Schema.Struct({
  name: RuntimeCapabilityName,
  state: RuntimeCapabilityState,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginRuntimeCapability" })
export type RuntimeCapability = typeof RuntimeCapability.Type

export const RuntimeInfo = Schema.Struct({
  id: ID,
  state: RuntimeState,
  capabilities: Schema.Array(RuntimeCapability),
}).annotate({ identifier: "PluginRuntimeInfo" })
export type RuntimeInfo = typeof RuntimeInfo.Type

export const RuntimeSnapshot = Schema.Struct({
  plugins: Schema.Array(RuntimeInfo),
}).annotate({ identifier: "PluginRuntimeSnapshot" })
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type

const Added = define({
  type: "plugin.added",
  schema: { id: ID },
})
export const Event = { Added, Definitions: inventory(Added) }
