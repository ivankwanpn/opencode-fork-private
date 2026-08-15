import { Location } from "@opencode-ai/schema/location"
import { RuntimeSnapshot } from "@opencode-ai/schema/plugin"
import { PositiveInt } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const Marketplace = Schema.Struct({
  name: Schema.String,
  source: Schema.String,
  lastUpdated: Schema.String,
  pluginCount: Schema.Number,
  error: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginMarketplace" })

export const Plugin = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  marketplace: Schema.String,
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  capabilities: Schema.Array(Schema.String),
  mcpServers: Schema.Array(Schema.String),
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
}).annotate({ identifier: "MarketplacePlugin" })

export const CapabilityTier = Schema.Union([
  Schema.Literal("declarative"),
  Schema.Literal("runtime"),
  Schema.Literal("trusted-runtime"),
])
const DirectTarget = Schema.Union([Schema.Literal("server"), Schema.Literal("tui")])
const ManagedMcpType = Schema.Union([Schema.Literal("local"), Schema.Literal("remote")])

export const DirectCapability = Schema.Struct({
  name: Schema.String,
  tier: CapabilityTier,
}).annotate({ identifier: "DirectPluginCapability" })

export const DirectPlugin = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.String,
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  targets: Schema.Array(DirectTarget),
  requestedCapabilities: Schema.Array(DirectCapability),
  approvedCapabilities: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
  installedAt: Schema.String,
}).annotate({ identifier: "DirectPlugin" })

export const ManagedMcp = Schema.Struct({
  name: Schema.String,
  type: ManagedMcpType,
  enabled: Schema.Boolean,
}).annotate({ identifier: "ManagedMcp" })

export const DirectPluginInspection = Schema.Struct({
  source: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  targets: Schema.Array(DirectTarget),
  requestedCapabilities: Schema.Array(DirectCapability),
}).annotate({ identifier: "DirectPluginInspection" })

export const McpTimeout = Schema.Struct({
  startup: Schema.optional(PositiveInt),
  request: Schema.optional(PositiveInt),
}).annotate({ identifier: "ManagedMcpTimeout" })

export const McpLocal = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.Array(Schema.String),
  cwd: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  timeout: Schema.optional(McpTimeout),
}).annotate({ identifier: "ManagedMcpLocalConfig" })

export const McpRemote = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  oauth: Schema.optional(Schema.Literal(false)),
  timeout: Schema.optional(McpTimeout),
}).annotate({ identifier: "ManagedMcpRemoteConfig" })

export const McpConfig = Schema.Union([McpLocal, McpRemote])

export const Catalog = Schema.Struct({
  marketplaces: Schema.Array(Marketplace),
  plugins: Schema.Array(Plugin),
  directPlugins: Schema.Array(DirectPlugin),
  mcpServers: Schema.Array(ManagedMcp),
}).annotate({ identifier: "PluginCatalog" })

const NamePayload = Schema.Struct({ name: Schema.String })
const PluginPayload = Schema.Struct({ id: Schema.String })
const DirectPluginPayload = Schema.Struct({
  source: Schema.String,
  trusted: Schema.Boolean,
  approvedCapabilities: Schema.Array(Schema.String),
})
const McpPayload = Schema.Struct({ name: Schema.String, config: McpConfig })

export const PluginGroup = HttpApiGroup.make("server.plugins")
  .add(
    HttpApiEndpoint.get("plugins.runtime", "/api/plugins/runtime", {
      query: LocationQuery,
      success: Location.response(RuntimeSnapshot),
      error: ServiceUnavailableError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("plugins.list", "/api/plugins", {
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.marketplace.add", "/api/plugins/marketplace", {
      payload: Schema.Struct({ source: Schema.String }),
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.marketplace.refresh", "/api/plugins/marketplace/refresh", {
      payload: NamePayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("plugins.marketplace.remove", "/api/plugins/marketplace", {
      payload: NamePayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.install", "/api/plugins/install", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.uninstall", "/api/plugins/uninstall", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.enable", "/api/plugins/enable", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.disable", "/api/plugins/disable", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.direct.inspect", "/api/plugins/direct/inspect", {
      payload: Schema.Struct({ source: Schema.String }),
      success: DirectPluginInspection,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.direct.install", "/api/plugins/direct", {
      payload: DirectPluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("plugins.direct.uninstall", "/api/plugins/direct", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.direct.enable", "/api/plugins/direct/enable", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.direct.disable", "/api/plugins/direct/disable", {
      payload: PluginPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.mcp.install", "/api/plugins/mcp", {
      payload: McpPayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("plugins.mcp.remove", "/api/plugins/mcp", {
      payload: NamePayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.mcp.enable", "/api/plugins/mcp/enable", {
      payload: NamePayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .add(
    HttpApiEndpoint.post("plugins.mcp.disable", "/api/plugins/mcp/disable", {
      payload: NamePayload,
      success: Catalog,
      error: ServiceUnavailableError,
    }),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugins",
      description: "Marketplace, direct plugin, and managed MCP extension routes.",
    }),
  )

export type Marketplace = Schema.Schema.Type<typeof Marketplace>
export type Plugin = Schema.Schema.Type<typeof Plugin>
export type DirectCapability = Schema.Schema.Type<typeof DirectCapability>
export type DirectPlugin = Schema.Schema.Type<typeof DirectPlugin>
export type DirectPluginInspection = Schema.Schema.Type<typeof DirectPluginInspection>
export type ManagedMcp = Schema.Schema.Type<typeof ManagedMcp>
export type McpConfig = Schema.Schema.Type<typeof McpConfig>
export type Catalog = Schema.Schema.Type<typeof Catalog>
