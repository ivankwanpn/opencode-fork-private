import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ServiceUnavailableError } from "../errors"

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

export const Catalog = Schema.Struct({
  marketplaces: Schema.Array(Marketplace),
  plugins: Schema.Array(Plugin),
}).annotate({ identifier: "PluginCatalog" })

const NamePayload = Schema.Struct({ name: Schema.String })
const PluginPayload = Schema.Struct({ id: Schema.String })

export const PluginGroup = HttpApiGroup.make("server.plugins")
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
  .annotateMerge(
    OpenApi.annotations({
      title: "plugins",
      description: "Claude Code marketplace and plugin management routes.",
    }),
  )

export type Marketplace = Schema.Schema.Type<typeof Marketplace>
export type Plugin = Schema.Schema.Type<typeof Plugin>
export type Catalog = Schema.Schema.Type<typeof Catalog>
