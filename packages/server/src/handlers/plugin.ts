import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { PluginCapability } from "../plugin-capability"

export const PluginHandler = HttpApiBuilder.group(Api, "server.plugins", (handlers) =>
  Effect.gen(function* () {
    const plugins = yield* PluginCapability.Service
    return handlers
      .handle("plugins.runtime", () => response(plugins.runtime()))
      .handle("plugins.list", () => plugins.list())
      .handle("plugins.marketplace.add", (ctx) => plugins.addMarketplace(ctx.payload.source))
      .handle("plugins.marketplace.refresh", (ctx) => plugins.refreshMarketplace(ctx.payload.name))
      .handle("plugins.marketplace.remove", (ctx) => plugins.removeMarketplace(ctx.payload.name))
      .handle("plugins.install", (ctx) => plugins.install(ctx.payload.id))
      .handle("plugins.uninstall", (ctx) => plugins.uninstall(ctx.payload.id))
      .handle("plugins.enable", (ctx) => plugins.enable(ctx.payload.id))
      .handle("plugins.disable", (ctx) => plugins.disable(ctx.payload.id))
      .handle("plugins.direct.inspect", (ctx) => plugins.inspectDirect(ctx.payload.source))
      .handle("plugins.direct.install", (ctx) =>
        plugins.installDirect(ctx.payload.source, ctx.payload.trusted, ctx.payload.approvedCapabilities),
      )
      .handle("plugins.direct.uninstall", (ctx) => plugins.uninstallDirect(ctx.payload.id))
      .handle("plugins.direct.enable", (ctx) => plugins.enableDirect(ctx.payload.id))
      .handle("plugins.direct.disable", (ctx) => plugins.disableDirect(ctx.payload.id))
      .handle("plugins.mcp.install", (ctx) => plugins.installMcp(ctx.payload.name, ctx.payload.config))
      .handle("plugins.mcp.remove", (ctx) => plugins.removeMcp(ctx.payload.name))
      .handle("plugins.mcp.enable", (ctx) => plugins.enableMcp(ctx.payload.name))
      .handle("plugins.mcp.disable", (ctx) => plugins.disableMcp(ctx.payload.name))
  }),
)
