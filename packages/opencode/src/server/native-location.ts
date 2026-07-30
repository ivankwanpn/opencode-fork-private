import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { LocationMiddleware, requestRef } from "@opencode-ai/server/location"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const instances = yield* InstanceStore.Service
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const location = requestRef(request)
        const instance = yield* instances.load({ directory: location.directory })
        return yield* effect.pipe(
          Effect.provide(locations.get(location)),
          Effect.provideService(InstanceRef, instance),
          Effect.provideService(WorkspaceRef, location.workspaceID),
        )
      }),
    )
  }),
)

export * as NativeLocation from "./native-location"
