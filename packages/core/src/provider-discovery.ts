export * as ProviderModelDiscovery from "./provider-discovery"

import { Context, Effect, Layer, Schema, Scope } from "effect"
import { ProviderDiscovery } from "@opencode-ai/schema/provider-discovery"
import type { CatalogDraft } from "@opencode-ai/plugin/v2/effect"
import { Catalog } from "./catalog"
import { Credential } from "./credential"
import { makeLocationNode } from "./effect/app-node"
import { KeyedMutex } from "./effect/keyed-mutex"
import { Integration } from "./integration"
import { ModelV2 } from "./model"
import { PluginRuntime } from "./plugin/runtime"
import { ProviderV2 } from "./provider"
import {
  fetchProviderModels,
  supportsProviderModelDiscovery,
  type ProviderModel,
  type ProviderModelDiscoveryOptions,
} from "./provider-models"

export const FailureKind = Schema.Literals([
  "unsupported",
  "missing-credential",
  "authentication",
  "network",
  "timeout",
  "invalid",
  "empty",
])
export type FailureKind = typeof FailureKind.Type

export class Failure extends Schema.TaggedErrorClass<Failure>()("ProviderModelDiscovery.Failure", {
  providerID: ProviderV2.ID,
  kind: FailureKind,
}) {}

export type StrategyResult = {
  readonly source: ProviderDiscovery.Source
  readonly sourceKey: string
  readonly models: readonly ProviderModel[]
}

export type Strategy = (input: {
  readonly provider: ProviderV2.Info
  readonly credential?: Credential.Value
}) => Effect.Effect<StrategyResult | undefined, Failure>

export interface Interface {
  readonly register: (
    providerID: ProviderV2.ID,
    strategy: Strategy,
  ) => Effect.Effect<PluginRuntime.Registration, never, Scope.Scope>
  readonly discover: (providerID: ProviderV2.ID) => Effect.Effect<ProviderDiscovery.Result, Failure>
  readonly refresh: (providerID: ProviderV2.ID) => Effect.Effect<void>
  readonly refreshAll: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ProviderModelDiscovery") {}

export type LiveModelsSnapshot = {
  readonly source: string
  readonly models: readonly ProviderModel[]
}

export function resolveLiveSnapshot(input: {
  source: string
  fetched?: readonly ProviderModel[]
  previous?: LiveModelsSnapshot
}) {
  if (input.fetched?.length) {
    const snapshot = { source: input.source, models: input.fetched }
    return { live: snapshot.models, snapshot }
  }
  if (input.previous?.source !== input.source) return { live: undefined, snapshot: undefined }
  if (!input.previous) return { live: undefined, snapshot: undefined }
  return { live: input.previous.models, snapshot: input.previous }
}

export function liveModelSourceKey(input: { baseURL: string; packageName: string; modelsURL?: string }) {
  return JSON.stringify([input.baseURL.trim().replace(/\/+$/, ""), input.packageName, input.modelsURL?.trim() ?? ""])
}

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
    if (record.models.has(ModelV2.ID.make(item.id))) continue
    catalog.model.update(providerID, ModelV2.ID.make(item.id), (model) => {
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

type FetchProviderModels = NonNullable<ProviderModelDiscoveryOptions["fetch"]>

export function makeLayer(input: { readonly fetch?: FetchProviderModels } = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const integration = yield* Integration.Service
      const scope = yield* Scope.Scope
      const locks = KeyedMutex.makeUnsafe<ProviderV2.ID>()
      const strategies = new Map<ProviderV2.ID, Strategy>()
      const snapshots = new Map<ProviderV2.ID, LiveModelsSnapshot>()
      const hiddenByLive = new Set<string>()
      const addedByLive = new Set<string>()
      let projection: PluginRuntime.Registration | undefined

      const installProjection = Effect.fn("ProviderModelDiscovery.installProjection")(function* () {
        if (projection) yield* projection.dispose
        projection = yield* catalog
          .transform((draft) => {
            for (const record of draft.provider.list()) {
              applyLiveModels(draft, record.provider.id, snapshots.get(record.provider.id)?.models, hiddenByLive, addedByLive)
            }
          })
          .pipe(Scope.provide(scope))
      })

      const clear = Effect.fn("ProviderModelDiscovery.clear")(function* (providerID: ProviderV2.ID) {
        snapshots.delete(providerID)
        if (snapshots.size > 0) return yield* installProjection()
        if (!projection) return
        yield* projection.dispose
        projection = undefined
      })

      const resolveCredential = Effect.fn("ProviderModelDiscovery.resolveCredential")(function* (provider: ProviderV2.Info) {
        const connection = yield* integration.connection
          .active(provider.integrationID ?? Integration.ID.make(provider.id))
          .pipe(Effect.catch(() => Effect.fail(new Failure({ providerID: provider.id, kind: "authentication" }))))
        if (!connection) return undefined
        return yield* integration.connection
          .resolve(connection)
          .pipe(Effect.catch(() => Effect.fail(new Failure({ providerID: provider.id, kind: "authentication" }))))
      })

      const generic = Effect.fn("ProviderModelDiscovery.generic")(function* (
        provider: ProviderV2.Info,
        credential: Credential.Value | undefined,
      ) {
        if (!supportsLiveModels(provider)) return yield* new Failure({ providerID: provider.id, kind: "unsupported" })
        const api = provider.api
        if (api.type !== "aisdk" || !api.url) return yield* new Failure({ providerID: provider.id, kind: "unsupported" })
        const baseURL = api.url

        const apiKey =
          credential?.type === "key"
            ? credential.key
            : credential?.type === "oauth"
              ? credential.access
              : typeof provider.request.body.apiKey === "string"
                ? provider.request.body.apiKey
                : typeof api.settings?.apiKey === "string"
                  ? api.settings.apiKey
                  : undefined
        const hasCredentialHeader = Object.keys(provider.request.headers).some((name) =>
          ["authorization", "x-api-key", "api-key", "x-goog-api-key"].includes(name.toLowerCase()),
        )
        if (!apiKey && !hasCredentialHeader) {
          return yield* new Failure({ providerID: provider.id, kind: "missing-credential" })
        }
        const modelsURL = ["modelsURL", "modelsUrl", "modelListURL"]
          .map((key) => provider.request.body[key])
          .find((value): value is string => typeof value === "string" && value.trim().length > 0)
        const result = yield* Effect.tryPromise({
          try: () =>
            fetchProviderModels({
              baseURL,
              packageName: api.package,
              apiKey,
              headers: provider.request.headers,
              modelsURL,
              ...(input.fetch ? { fetch: input.fetch } : {}),
            }),
          catch: (cause) => new Failure({ providerID: provider.id, kind: failureKind(cause) }),
        })
        return {
          source: credential?.type === "oauth" ? ("oauth" as const) : ("compatible" as const),
          sourceKey: liveModelSourceKey({ baseURL, packageName: api.package, modelsURL }),
          models: result.models,
        }
      })

      const discover = Effect.fn("ProviderModelDiscovery.discover")(function* (providerID: ProviderV2.ID) {
        return yield* locks.withLock(providerID)(
          Effect.gen(function* () {
            const provider = yield* catalog.provider.get(providerID)
            if (!provider) return yield* new Failure({ providerID, kind: "unsupported" })
            const credential = yield* resolveCredential(provider)
            const strategy = strategies.get(providerID)
            const selected = strategy ? yield* strategy({ provider, credential }) : undefined
            const result = selected ?? (yield* generic(provider, credential))
            const models = uniqueModels(result.models)
            if (!models.length) return yield* new Failure({ providerID, kind: "empty" })
            snapshots.set(providerID, { source: result.sourceKey, models })
            yield* installProjection()
            return ProviderDiscovery.Result.make({ providerID, source: result.source, models })
          }),
        )
      })

      const refresh = Effect.fn("ProviderModelDiscovery.refresh")(function* (providerID: ProviderV2.ID) {
        yield* discover(providerID).pipe(
          Effect.asVoid,
          Effect.catch((failure) =>
            failure.kind === "unsupported" || failure.kind === "missing-credential" ? clear(providerID) : Effect.void,
          ),
        )
      })

      const refreshAll = Effect.fn("ProviderModelDiscovery.refreshAll")(function* () {
        const providers = yield* catalog.provider.all()
        const active = new Set(providers.map((provider) => provider.id))
        for (const providerID of snapshots.keys()) {
          if (!active.has(providerID)) snapshots.delete(providerID)
        }
        yield* Effect.forEach(providers, (provider) => refresh(provider.id), { concurrency: "unbounded", discard: true })
      })

      const register = Effect.fn("ProviderModelDiscovery.register")(function* (
        providerID: ProviderV2.ID,
        strategy: Strategy,
      ) {
        const scope = yield* Scope.Scope
        let active = true
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          if (strategies.get(providerID) === strategy) strategies.delete(providerID)
        })
        strategies.set(providerID, strategy)
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      })

      return Service.of({ register, discover, refresh, refreshAll })
    }),
  )
}

export const locationLayer = makeLayer()

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [Catalog.node, Integration.node],
})

function uniqueModels(models: readonly ProviderModel[]) {
  const unique = new Map<string, ProviderModel>()
  for (const model of models) {
    const id = model.id.trim()
    if (id && !unique.has(id)) unique.set(id, { ...model, id })
  }
  return [...unique.values()]
}

function failureKind(cause: unknown): FailureKind {
  if (cause instanceof DOMException && cause.name === "TimeoutError") return "timeout"
  if (cause instanceof Error && cause.name === "AbortError") return "timeout"
  const message = cause instanceof Error ? cause.message : ""
  if (/\b(401|403)\b/.test(message)) return "authentication"
  if (/empty catalog/i.test(message)) return "empty"
  if (cause instanceof SyntaxError || /json|parse/i.test(message)) return "invalid"
  return "network"
}
