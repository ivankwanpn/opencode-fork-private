import { Catalog } from "@opencode-ai/core/catalog"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { Location } from "@opencode-ai/core/location"
import { ProviderModelDiscovery } from "@opencode-ai/core/provider-discovery"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProviderModelDiscoveryError, ProviderNotFoundError } from "@opencode-ai/protocol/errors"
import { ConfigCapability } from "../config-capability"
import { response } from "../location"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.catalog",
        Effect.fn(function* () {
          const snapshot = yield* CatalogSnapshot.Service
          return yield* response(snapshot.get())
        }),
      )
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const catalog = yield* Catalog.Service
          return yield* response(catalog.provider.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const provider = yield* catalog.provider.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(provider))
        }),
      )
      .handle(
        "provider.models.discover",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const provider = yield* catalog.provider.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          const discovery = yield* ProviderModelDiscovery.Service
          return yield* response(
            discovery.discover(provider.id).pipe(
              Effect.mapError(
                (failure) =>
                  new ProviderModelDiscoveryError({
                    providerID: failure.providerID,
                    kind: failure.kind,
                    message: "Unable to discover provider models",
                  }),
              ),
            ),
          )
        }),
      )
      .handle(
        "provider.disconnect",
        Effect.fn(function* (ctx) {
          const capability = yield* ConfigCapability.Service
          yield* capability.disconnectProvider(ctx.params.providerID)
          return yield* response(Effect.succeed(true))
        }),
      )
      .handle(
        "provider.custom.discover",
        Effect.fn(function* (ctx) {
          const capability = yield* ConfigCapability.Service
          return yield* response(capability.discoverCustomProvider(ctx.payload))
        }),
      )
      .handle(
        "provider.custom.configure",
        Effect.fn(function* (ctx) {
          const capability = yield* ConfigCapability.Service
          const location = yield* Location.Service
          const ref = Location.Ref.make({
            directory: location.directory,
            workspaceID: location.workspaceID,
          })
          return yield* response(capability.configureCustomProvider(ctx.payload, ref))
        }),
      )
      .handle(
        "provider.custom.disconnect",
        Effect.fn(function* (ctx) {
          const capability = yield* ConfigCapability.Service
          const location = yield* Location.Service
          const ref = Location.Ref.make({
            directory: location.directory,
            workspaceID: location.workspaceID,
          })
          yield* capability.disconnectCustomProvider(ctx.params.providerID, ref)
          return yield* response(Effect.succeed(true))
        }),
      )
  }),
)
