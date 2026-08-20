import { Config } from "@/config/config"
import { legacyProvidersFromNative } from "@/compat/native-v1-catalog"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { markInstanceForDisposal } from "../lifecycle"

export const configHandlers = HttpApiBuilder.group(InstanceHttpApi, "config", (handlers) =>
  Effect.gen(function* () {
    const configSvc = yield* Config.Service
    const locations = yield* LocationServiceMap.Service

    const location = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      return yield* effect.pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({
              directory: AbsolutePath.make(ctx.directory),
              ...(workspaceID === undefined ? {} : { workspaceID }),
            }),
          ),
        ),
      )
    })

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      yield* configSvc.update(ctx.payload)
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const catalog = yield* location(CatalogSnapshot.Service.use((snapshot) => snapshot.get()))
      const providers = legacyProvidersFromNative(catalog)
      return Schema.decodeUnknownSync(Provider.ConfigProvidersResult)({
        providers: providers.providers.map((provider) => Provider.toPublicInfo(provider as unknown as Provider.Info)),
        default: providers.defaults,
      })
    })

    return handlers.handle("get", get).handle("update", update).handle("providers", providers)
  }),
)
