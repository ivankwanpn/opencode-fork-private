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

export const UIContributionKind = Schema.Literals(["command", "panel"]).annotate({
  identifier: "PluginUIContributionKind",
})
export type UIContributionKind = typeof UIContributionKind.Type

export const UIContribution = Schema.Struct({
  id: Schema.String,
  kind: UIContributionKind,
  description: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginUIContribution" })
export type UIContribution = typeof UIContribution.Type

export const UIContributionInfo = Schema.Struct({
  ...UIContribution.fields,
  pluginID: ID,
  version: Schema.String,
  generation: Schema.Number,
  group: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginUIContributionInfo" })
export type UIContributionInfo = typeof UIContributionInfo.Type

export const RuntimeSnapshot = Schema.Struct({
  plugins: Schema.Array(RuntimeInfo),
  // Optional on the wire so a newer Desktop/Web client can still inspect an
  // older server. Current servers always emit the array.
  ui: Schema.optional(Schema.Array(UIContributionInfo)),
}).annotate({ identifier: "PluginRuntimeSnapshot" })
export type RuntimeSnapshot = typeof RuntimeSnapshot.Type

export const Target = Schema.Literals(["core", "desktop", "web", "tui", "cli", "acp"]).annotate({
  identifier: "PluginTarget",
})
export type Target = typeof Target.Type

export const Capability = Schema.Literals([
  "service",
  "tool",
  "hook",
  "command",
  "skill",
  "agent",
  "mcp",
  "lsp",
  "ui",
]).annotate({ identifier: "PluginCapability" })
export type Capability = typeof Capability.Type

export const Permission = Schema.Literals([
  "session.history.read",
  "session.metadata.read",
  "session.context.transform",
  "tool.register",
  "tool.exposure.transform",
  "tool.policy",
  "tool.execute.wrap",
  "filesystem.read",
  "filesystem.write",
  "process.spawn",
  "network.request",
  "credential.use",
  "credential.read",
  "provider.transform",
  "mcp.manage",
  "lsp.manage",
  "background-job.manage",
  "ui.command.register",
  "ui.panel.register",
]).annotate({ identifier: "PluginPermission" })
export type Permission = typeof Permission.Type

export const RuntimeClass = Schema.Literals(["trusted-in-process", "isolated-worker", "external"]).annotate({
  identifier: "PluginRuntimeClass",
})
export type RuntimeClass = typeof RuntimeClass.Type

export const ServiceRequirement = Schema.Struct({
  id: Schema.String,
  optional: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "PluginServiceRequirement" })
export type ServiceRequirement = typeof ServiceRequirement.Type

export const Manifest = Schema.Struct({
  id: ID,
  version: Schema.String,
  targets: Schema.Array(Target),
  requires: Schema.Array(ServiceRequirement),
  capabilities: Schema.Array(Capability),
  permissions: Schema.Array(Permission),
  runtime: RuntimeClass,
}).annotate({ identifier: "PluginManifest" })
export type Manifest = typeof Manifest.Type

export const ActivationState = Schema.Literals([
  "disabled",
  "resolving",
  "waiting_dependency",
  "activating",
  "ready",
  "degraded",
  "failed",
  "disposing",
]).annotate({ identifier: "PluginActivationState" })
export type ActivationState = typeof ActivationState.Type

export const ActivationError = Schema.Union([
  Schema.Struct({ type: Schema.Literal("dependency"), requirement: Schema.String }),
  Schema.Struct({ type: Schema.Literal("mount"), message: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("deadline"),
    operation: Schema.Literals(["mount", "dispose"]),
    durationMilliseconds: Schema.Number,
  }),
  Schema.Struct({ type: Schema.Literal("permission"), permission: Permission }),
  Schema.Struct({ type: Schema.Literal("fenced"), generation: Schema.Number }),
]).annotate({ identifier: "PluginActivationError" })
export type ActivationError = typeof ActivationError.Type

export const ActivationInfo = Schema.Struct({
  id: ID,
  version: Schema.String,
  generation: Schema.Number,
  state: ActivationState,
  runtime: RuntimeClass,
  group: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginActivationInfo" })
export type ActivationInfo = typeof ActivationInfo.Type

const Added = define({
  type: "plugin.added",
  schema: { id: ID },
})
export const Event = { Added, Definitions: inventory(Added) }
