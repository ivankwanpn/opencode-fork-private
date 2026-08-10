import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProjectLifecycleCapability } from "../project-lifecycle-capability"
import { HttpEffect } from "effect/unstable/http"

export const LocationHandler = HttpApiBuilder.group(Api, "server.location", (handlers) =>
  Effect.gen(function* () {
    const lifecycle = yield* ProjectLifecycleCapability.Service
    const locations = yield* LocationServiceMap.Service

    return handlers
      .handle(
        "location.get",
        Effect.fn(function* () {
          const location = yield* Location.Service
          return new Location.Info({
            directory: location.directory,
            workspaceID: location.workspaceID,
            project: location.project,
          })
        }),
      )
      .handle(
        "location.dispose",
        Effect.fn(function* () {
          const location = yield* Location.Service
          const dispose = yield* lifecycle.dispose()
          const ref = Location.Ref.make({
            directory: location.directory,
            workspaceID: location.workspaceID,
          })
          yield* HttpEffect.appendPreResponseHandler((_request, response) =>
            Effect.as(
              Effect.uninterruptible(
                Effect.all([dispose, locations.invalidate(ref)], {
                  concurrency: "unbounded",
                  discard: true,
                }),
              ),
              response,
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
