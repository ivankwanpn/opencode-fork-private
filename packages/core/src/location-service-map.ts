import { Context, Effect, Layer, LayerMap } from "effect"
import { LayerNode } from "./effect/layer-node"
import { Node } from "./effect/app-node"
import { Location } from "./location"
import type { LocationError, LocationServices } from "./location-services"

export interface Interface extends LayerMap.LayerMap<Location.Ref, LocationServices, LocationError> {
  readonly invalidateAll?: () => Effect.Effect<void>
}

export class Service extends Context.Service<
  Service,
  Interface
>()("@opencode/example/LocationServiceMap") {
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }

  static invalidateAll = Effect.flatMap(Service, (locations) =>
    locations.invalidateAll ? locations.invalidateAll() : Effect.void,
  )
}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

export * as LocationServiceMap from "./location-service-map"
