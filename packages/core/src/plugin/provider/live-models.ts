import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { Catalog } from "../../catalog"
import { KeyedMutex } from "../../effect/keyed-mutex"
import { EventV2 } from "../../event"
import { Integration } from "../../integration"
import { ModelsDev } from "../../models-dev"
import { ProviderV2 } from "../../provider"
import {
  applyLiveModels,
  liveModelSourceKey,
  resolveLiveSnapshot,
  supportsLiveModels,
  type LiveModelsSnapshot,
} from "../../provider-discovery"
import { fetchProviderModels } from "../../provider-models"

export { applyLiveModels, resolveLiveSnapshot, supportsLiveModels, type LiveModelsSnapshot } from "../../provider-discovery"

export const LiveModelsPlugin = define({
  id: "live-models",
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const catalog = yield* Catalog.Service
    const refreshLocks = KeyedMutex.makeUnsafe<string>()
    const snapshots = new Map<string, LiveModelsSnapshot>()
    const hiddenByLive = new Set<string>()
    const addedByLive = new Set<string>()

    yield* ctx.catalog.transform((draft) => {
      for (const record of draft.provider.list()) {
        applyLiveModels(draft, record.provider.id, snapshots.get(record.provider.id)?.models, hiddenByLive, addedByLive)
      }
    })

    const refresh = Effect.fn("LiveModelsPlugin.refresh")(function* () {
      const providers = yield* catalog.provider.all()
      const providerIDs = new Set<string>(providers.map((provider) => provider.id))
      for (const providerID of snapshots.keys()) {
        if (!providerIDs.has(providerID)) snapshots.delete(providerID)
      }
      yield* Effect.forEach(providers, (provider) =>
        refreshLocks
          .withLock(provider.id)(refreshProvider(provider))
          .pipe(Effect.catch(() => Effect.void)),
      )
      yield* ctx.catalog.reload()
    })

    function refreshProvider(provider: ProviderV2.Info) {
      return Effect.gen(function* () {
        if (!supportsLiveModels(provider)) {
          snapshots.delete(provider.id)
          return
        }
        const api = provider.api
        if (api.type !== "aisdk" || !api.url) {
          snapshots.delete(provider.id)
          return
        }
        const baseURL = api.url

        const connection = yield* ctx.integration.connection.active(
          provider.integrationID ?? Integration.ID.make(provider.id),
        )
        const credential = connection
          ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
        if (credential?.type === "oauth") {
          snapshots.delete(provider.id)
          return
        }

        const apiKey =
          credential?.type === "key"
            ? credential.key
            : typeof provider.request.body.apiKey === "string"
              ? provider.request.body.apiKey
              : undefined
        const headers = provider.request.headers
        const hasCredentialHeader = Object.keys(headers).some((name) =>
          ["authorization", "x-api-key", "api-key", "x-goog-api-key"].includes(name.toLowerCase()),
        )
        if (!apiKey && !hasCredentialHeader) {
          snapshots.delete(provider.id)
          return
        }

        const modelsURL = ["modelsURL", "modelsUrl", "modelListURL"]
          .map((key) => provider.request.body[key])
          .find((value): value is string => typeof value === "string" && value.trim().length > 0)
        const source = liveModelSourceKey({ baseURL, packageName: api.package, modelsURL })
        const previous = snapshots.get(provider.id)
        const fetched = yield* Effect.tryPromise(() =>
          fetchProviderModels({
            baseURL,
            packageName: api.package,
            apiKey,
            headers,
            modelsURL,
          }),
        ).pipe(
          Effect.map((result) => result.models),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        const resolved = resolveLiveSnapshot({ source, fetched, previous })
        if (resolved.snapshot) snapshots.set(provider.id, resolved.snapshot)
        else snapshots.delete(provider.id)
      })
    }

    yield* refresh()
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.runForEach(() => refresh().pipe(Effect.ignore)),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() => refresh().pipe(Effect.ignore)),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
