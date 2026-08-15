import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { ClaudeMarketplaceManager, type ManagedPluginSource } from "./claude-marketplace"

export interface Interface {
  readonly sources: () => Effect.Effect<readonly ManagedPluginSource[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplacePluginRuntime") {}

export const layerWith = (manager: ClaudeMarketplaceManager) =>
  Layer.succeed(
    Service,
    Service.of({
      sources: () => Effect.promise(() => manager.enabledPluginSources()),
    }),
  )

export const node = LayerNode.make({
  service: Service,
  layer: layerWith(new ClaudeMarketplaceManager()),
  deps: [],
})

export * as MarketplacePluginRuntime from "./marketplace-runtime"
