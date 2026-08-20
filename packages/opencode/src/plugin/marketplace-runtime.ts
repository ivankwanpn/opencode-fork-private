import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer } from "effect"
import { ClaudeMarketplaceManager, type ManagedPluginSource, type RuntimeDescriptor } from "./claude-marketplace"

export interface Interface {
  readonly sources: () => Effect.Effect<readonly ManagedPluginSource[]>
  readonly descriptors?: () => Effect.Effect<readonly RuntimeDescriptor[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MarketplacePluginRuntime") {}

export const layerWith = (manager: ClaudeMarketplaceManager) =>
  Layer.succeed(
    Service,
    Service.of({
      sources: () => Effect.promise(() => manager.enabledPluginSources()),
      descriptors: () => Effect.promise(() => manager.runtimeDescriptors()),
    }),
  )

export const node = LayerNode.make({
  service: Service,
  layer: layerWith(new ClaudeMarketplaceManager()),
  deps: [],
})

export * as MarketplacePluginRuntime from "./marketplace-runtime"
