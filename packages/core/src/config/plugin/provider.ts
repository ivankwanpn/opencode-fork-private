export * as ConfigProviderPlugin from "./provider"

import { define } from "../../plugin/internal"
import { Effect, Schema } from "effect"
import { Catalog, type Draft } from "../../catalog"
import { Config } from "../../config"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { ConfigV1 } from "../../v1/config/config"
import { ConfigMigrateV1 } from "../../v1/config/migrate"
import { ConfigProviderV1 } from "../../v1/config/provider"

export const Plugin = define({
  id: "config-provider",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service
    const entries = yield* config.entries()
    const files = entries.filter((entry): entry is Config.Document => entry.type === "document")
    const configuredProviderIDs = new Set(files.flatMap((file) => Object.keys(file.info.providers ?? {})))
    yield* ctx.integration.transform(
      Effect.fn(function* (integrations) {
        for (const id of configuredProviderIDs) {
          const integrationID = Integration.ID.make(id)
          for (const file of files) {
            const item = file.info.providers?.[id]
            if (!item) continue
            integrations.update(integrationID, (integration) => {
              integration.name = item.name ?? integration.name
            })
            integrations.method.update({
              integrationID,
              method: { type: "key", label: "API key" },
            })
            if (item.env !== undefined) {
              integrations.method.update({
                integrationID,
                method: { type: "env", names: [...item.env] },
              })
            }
          }
        }
      }),
    )

    yield* ctx.aisdk.sdk(
      Effect.fn(function* (event) {
        if (event.options.apiKey !== undefined) return
        if (!configuredProviderIDs.has(event.model.providerID)) return
        const integrationID = Integration.ID.make(event.model.providerID)
        const connection = yield* integrations.connection.active(integrationID)
        if (!connection) return
        const credential = yield* integrations.connection
          .resolve(connection)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (credential?.type === "key") event.options.apiKey = credential.key
      }),
    )

    yield* catalog.transform(
      Effect.fn(function* (catalog) {
        apply(catalog, entries, files)
      }),
    )
  }),
})

export const OverridePlugin = define({
  id: "config-provider-override",
  effect: Effect.fn(function* () {
    const config = yield* Config.Service
    const catalog = yield* Catalog.Service
    const entries = yield* config.entries()
    const files = entries.filter((entry): entry is Config.Document => entry.type === "document")
    yield* catalog.transform((draft) => apply(draft, entries, files))
  }),
})

function apply(catalog: Draft, entries: readonly Config.Entry[], files: readonly Config.Document[]) {
  const configuredDefault = Config.latest(entries, "model")
  if (configuredDefault !== undefined) {
    const model = ModelV2.parse(configuredDefault)
    catalog.model.default.set(model.providerID, model.modelID)
  }
  for (const file of files) {
    for (const [id, item] of Object.entries(file.info.providers ?? {})) {
      project(catalog, id, item)
    }
  }
  const filters = files.map((file) => file.info.provider_filter)
  const enabled = filters.findLast((filter) => filter?.enabled !== undefined)?.enabled
  const disabled = new Set(filters.findLast((filter) => filter?.disabled !== undefined)?.disabled ?? [])
  const allowed = enabled === undefined ? undefined : new Set(enabled)
  for (const record of catalog.provider.list()) {
    if ((!allowed || allowed.has(record.provider.id)) && !disabled.has(record.provider.id)) continue
    catalog.provider.update(record.provider.id, (provider) => {
      provider.disabled = true
    })
  }
}

export function project(catalog: Draft, providerID: string, item: NonNullable<Config.Info["providers"]>[string]) {
  const provider = ProviderV2.ID.make(providerID)
  catalog.provider.update(provider, (provider) => {
    if (item.name !== undefined) provider.name = item.name
    if (item.api !== undefined) provider.api = { ...item.api }
    if (item.request !== undefined) {
      Object.assign(provider.request.headers, item.request.headers)
      Object.assign(provider.request.body, item.request.body)
    }
  })
  for (const [id, config] of Object.entries(item.models ?? {})) {
    catalog.model.update(provider, ModelV2.ID.make(id), (model) => {
      if (config.family !== undefined) model.family = config.family
      if (config.name !== undefined) model.name = config.name
      if (config.protocols !== undefined) model.protocols = [...config.protocols]
      if (config.api !== undefined) model.api = { ...model.api, ...config.api }
      if (config.capabilities !== undefined) {
        model.capabilities = {
          tools: config.capabilities.tools,
          input: [...config.capabilities.input],
          output: [...config.capabilities.output],
          ...(config.capabilities.temperature === undefined ? {} : { temperature: config.capabilities.temperature }),
          ...(config.capabilities.reasoning === undefined ? {} : { reasoning: config.capabilities.reasoning }),
          ...(config.capabilities.attachment === undefined ? {} : { attachment: config.capabilities.attachment }),
          ...(config.capabilities.interleaved === undefined ? {} : { interleaved: config.capabilities.interleaved }),
        }
      }
      if (config.request !== undefined) {
        Object.assign(model.request.headers, config.request.headers)
        Object.assign(model.request.body, config.request.body)
        if (config.request.variant !== undefined) model.request.variant = config.request.variant
      }
      if (config.variants !== undefined) {
        for (const variant of config.variants) {
          let existing = model.variants.find((item) => item.id === variant.id)
          if (!existing) {
            existing = {
              id: variant.id,
              headers: {},
              body: {},
            }
            model.variants.push(existing)
          }
          Object.assign(existing.headers, variant.headers)
          Object.assign(existing.body, variant.body)
        }
      }
      if (config.cost !== undefined) {
        model.cost = (Array.isArray(config.cost) ? config.cost : [config.cost]).map((cost) => ({
          tier: cost.tier && { ...cost.tier },
          input: cost.input,
          output: cost.output,
          cache: {
            read: cost.cache?.read ?? 0,
            write: cost.cache?.write ?? 0,
          },
        }))
      }
      if (config.disabled !== undefined) model.enabled = !config.disabled
      if (config.limit !== undefined) model.limit = { ...model.limit, ...config.limit }
    })
  }
}

export function projectV1(catalog: Draft, providerID: string, item: ConfigProviderV1.Info) {
  const provider = Schema.decodeUnknownSync(Config.Info)(
    ConfigMigrateV1.migrate({ provider: { [providerID]: item } } satisfies ConfigV1.Info),
  ).providers?.[providerID]
  if (provider) project(catalog, providerID, provider)
}
