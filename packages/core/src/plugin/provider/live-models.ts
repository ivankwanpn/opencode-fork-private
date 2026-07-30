import type { CatalogDraft } from "@opencode-ai/plugin/v2/effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { Catalog } from "../../catalog"
import { EventV2 } from "../../event"
import { Integration } from "../../integration"
import { ModelsDev } from "../../models-dev"
import { ProviderV2 } from "../../provider"
import { fetchProviderModels, supportsProviderModelDiscovery, type ProviderModel } from "../../provider-models"

export const LiveModelsPlugin = define({
  id: "live-models",
  effect: Effect.fn(function* (ctx) {
    const events = yield* EventV2.Service
    const catalog = yield* Catalog.Service
    const snapshots = new Map<string, ProviderModel[]>()
    const hiddenByLive = new Set<string>()
    const addedByLive = new Set<string>()

    yield* ctx.catalog.transform((draft) => {
      for (const record of draft.provider.list()) {
        applyLiveModels(draft, record.provider.id, snapshots.get(record.provider.id), hiddenByLive, addedByLive)
      }
    })

    const refresh = Effect.fn("LiveModelsPlugin.refresh")(function* () {
      const providers = yield* catalog.provider.all()
      yield* Effect.forEach(providers, (provider) => refreshProvider(provider).pipe(Effect.catch(() => Effect.void)))
      yield* ctx.catalog.reload()
    })

    function refreshProvider(provider: ProviderV2.Info) {
      return Effect.gen(function* () {
        if (!supportsLiveModels(provider)) return
        const api = provider.api
        if (api.type !== "aisdk" || !api.url) return
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
        const result = yield* Effect.tryPromise(() =>
          fetchProviderModels({
            baseURL,
            packageName: api.package,
            apiKey,
            headers,
            modelsURL,
          }),
        )
        snapshots.set(provider.id, result.models)
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

export function supportsLiveModels(provider: ProviderV2.Info) {
  if (provider.api.type !== "aisdk") return false
  return supportsProviderModelDiscovery({
    providerID: provider.id,
    packageName: provider.api.package,
    baseURL: provider.api.url,
  })
}

export function applyLiveModels(
  catalog: LiveModelsCatalog,
  providerID: string,
  live: readonly ProviderModel[] | undefined,
  hiddenByLive: Set<string>,
  addedByLive: Set<string>,
) {
  const record = catalog.provider.get(providerID)
  if (!record) return

  const liveIDs = live ? new Set(live.map((model) => model.id)) : undefined
  for (const key of addedByLive) {
    if (!key.startsWith(`${providerID}/`)) continue
    const modelID = key.slice(providerID.length + 1)
    if (!liveIDs || !liveIDs.has(modelID)) {
      catalog.model.remove(providerID, modelID)
      addedByLive.delete(key)
      hiddenByLive.delete(key)
    }
  }

  for (const [modelID, model] of record.models) {
    const key = `${providerID}/${modelID}`
    if (!liveIDs) {
      if (hiddenByLive.delete(key)) model.enabled = true
      continue
    }
    if (liveIDs.has(model.api.id)) {
      if (hiddenByLive.delete(key)) model.enabled = true
      continue
    }
    if (model.enabled) hiddenByLive.add(key)
    model.enabled = false
  }

  if (!live || record.provider.api.type !== "aisdk") return
  for (const item of live) {
    if (record.models.has(item.id)) continue
    catalog.model.update(providerID, item.id, (model) => {
      model.name = item.name ?? item.id
      model.api = { ...record.provider.api, id: item.id }
      model.capabilities = { tools: false, input: ["text"], output: ["text"] }
      model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
      model.limit = {
        context: item.context ?? 0,
        ...(item.input === undefined ? {} : { input: item.input }),
        output: item.output ?? 0,
      }
      model.status = "active"
      model.enabled = true
      model.variants = []
    })
    addedByLive.add(`${providerID}/${item.id}`)
  }
}

type LiveModelsCatalog = {
  readonly provider: {
    get(providerID: string): ReturnType<CatalogDraft["provider"]["get"]>
  }
  readonly model: {
    update: CatalogDraft["model"]["update"]
    remove: CatalogDraft["model"]["remove"]
  }
}
