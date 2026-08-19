export * as PluginV1Projection from "./v1-projection"

import type { Auth, CredentialValue, Model, ModelV2Info, Provider, ProviderV2Info } from "@opencode-ai/sdk/v2/types"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"

type ModelInfo = ModelV2.Info | ModelV2Info
type ProviderInfo = ProviderV2.Info | ProviderV2Info

const media = (values: readonly string[], type: "text" | "audio" | "image" | "video" | "pdf") =>
  values.some((value) => value === type || value.startsWith(`${type}/`))

const releaseDate = (released: number) => (released > 0 ? new Date(released).toISOString().slice(0, 10) : "")

export function model(info: ModelInfo): Model {
  const base = info.cost.find((cost) => cost.tier === undefined) ??
    info.cost[0] ?? {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    }
  const tiers = info.cost.flatMap((cost) =>
    cost.tier === undefined
      ? []
      : [
          {
            input: cost.input,
            output: cost.output,
            cache: { ...cost.cache },
            tier: { ...cost.tier },
          },
        ],
  )
  const over200K = tiers.find((cost) => cost.tier.type === "context" && cost.tier.size === 200_000)
  const input = info.capabilities.input
  const output = info.capabilities.output

  return {
    id: info.id,
    providerID: info.providerID,
    api: {
      id: info.api.id,
      url: info.api.url ?? "",
      npm: info.api.type === "aisdk" ? info.api.package : "",
    },
    name: info.name,
    family: info.family,
    capabilities: {
      temperature: info.capabilities.temperature ?? false,
      reasoning: info.capabilities.reasoning ?? false,
      attachment: info.capabilities.attachment ?? input.some((value) => !value.startsWith("text")),
      toolcall: info.capabilities.tools,
      input: {
        text: media(input, "text"),
        audio: media(input, "audio"),
        image: media(input, "image"),
        video: media(input, "video"),
        pdf: media(input, "pdf"),
      },
      output: {
        text: media(output, "text"),
        audio: media(output, "audio"),
        image: media(output, "image"),
        video: media(output, "video"),
        pdf: media(output, "pdf"),
      },
      interleaved: info.capabilities.interleaved ?? false,
    },
    cost: {
      input: base.input,
      output: base.output,
      cache: { ...base.cache },
      ...(tiers.length === 0 ? {} : { tiers }),
      ...(over200K === undefined
        ? {}
        : {
            experimentalOver200K: {
              input: over200K.input,
              output: over200K.output,
              cache: { ...over200K.cache },
            },
          }),
    },
    limit: { ...info.limit },
    status: info.status,
    options: { ...info.request.body },
    headers: { ...info.request.headers },
    release_date: releaseDate(info.time.released),
    variants: Object.fromEntries(info.variants.map((variant) => [variant.id, { ...variant.body }])),
    protocols: info.protocols ? [...info.protocols] : undefined,
  }
}

export function fromModel(
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
  info: Model,
  fallback?: ModelInfo,
): ModelV2.Info {
  const fallbackApi = fallback?.api
  const api = info.api.npm
    ? {
        type: "aisdk" as const,
        id: ModelV2.ID.make(info.api.id),
        package: info.api.npm,
        ...(info.api.url ? { url: info.api.url } : {}),
        settings:
          fallbackApi?.type === "aisdk" && fallbackApi.package === info.api.npm ? { ...fallbackApi.settings } : {},
      }
    : {
        type: "native" as const,
        id: ModelV2.ID.make(info.api.id),
        ...(info.api.url ? { url: info.api.url } : {}),
        settings: fallbackApi?.type === "native" ? { ...fallbackApi.settings } : {},
      }
  const variants =
    info.variants === undefined
      ? (fallback?.variants.map((variant) => ({
          id: ModelV2.VariantID.make(variant.id),
          headers: { ...variant.headers },
          body: { ...variant.body },
        })) ?? [])
      : Object.entries(info.variants).map(([id, body]) => ({
          id: ModelV2.VariantID.make(id),
          headers: { ...(fallback?.variants.find((variant) => variant.id === id)?.headers ?? {}) },
          body: { ...body },
        }))
  const released = Date.parse(info.release_date)
  return ModelV2.Info.make({
    id: modelID,
    providerID,
    name: info.name,
    family: info.family ? ModelV2.Family.make(info.family) : undefined,
    api,
    capabilities: {
      tools: info.capabilities.toolcall,
      input: mediaTypes(fallback?.capabilities.input, info.capabilities.input),
      output: mediaTypes(fallback?.capabilities.output, info.capabilities.output),
      temperature: info.capabilities.temperature,
      reasoning: info.capabilities.reasoning,
      attachment: info.capabilities.attachment,
      interleaved: info.capabilities.interleaved,
    },
    request: {
      headers: { ...info.headers },
      body: { ...info.options },
      variant: fallback?.request.variant,
    },
    variants,
    protocols: info.protocols ? [...info.protocols] : fallback?.protocols ? [...fallback.protocols] : undefined,
    time: { released: Number.isFinite(released) ? released : 0 },
    cost: legacyCost(info.cost),
    status: info.status,
    enabled: fallback?.enabled ?? true,
    limit: { ...info.limit },
  })
}

export function auth(value: CredentialValue | undefined): Auth | undefined {
  if (!value) return
  if (value.type === "key") {
    const metadata = Object.fromEntries(
      Object.entries(value.metadata ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
    return {
      type: "api",
      key: value.key,
      ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
    }
  }
  const accountId = stringMetadata(value.metadata, "accountID", "accountId")
  const enterpriseUrl = stringMetadata(value.metadata, "enterpriseUrl")
  return {
    type: "oauth",
    refresh: value.refresh,
    access: value.access,
    expires: value.expires,
    ...(accountId ? { accountId } : {}),
    ...(enterpriseUrl ? { enterpriseUrl } : {}),
  }
}

function mediaTypes(
  fallback: readonly string[] | undefined,
  capabilities: Model["capabilities"]["input"] | Model["capabilities"]["output"],
) {
  return (["text", "audio", "image", "video", "pdf"] as const).flatMap((type) => {
    if (!capabilities[type]) return []
    const existing = fallback?.filter((value) => value === type || value.startsWith(`${type}/`)) ?? []
    return existing.length > 0 ? existing : [type]
  })
}

function legacyCost(info: Model["cost"]): ModelV2.Info["cost"] {
  const tiers = new Map(
    (info.tiers ?? []).map((cost) => [
      cost.tier.size,
      {
        tier: { ...cost.tier },
        input: cost.input,
        output: cost.output,
        cache: { ...cost.cache },
      },
    ]),
  )
  if (info.experimentalOver200K) {
    tiers.set(200_000, {
      tier: { type: "context", size: 200_000 },
      input: info.experimentalOver200K.input,
      output: info.experimentalOver200K.output,
      cache: { ...info.experimentalOver200K.cache },
    })
  }
  return [
    {
      input: info.input,
      output: info.output,
      cache: { ...info.cache },
    },
    ...tiers.values(),
  ]
}

function stringMetadata(metadata: Record<string, unknown> | undefined, ...keys: string[]) {
  return keys.map((key) => metadata?.[key]).find((value): value is string => typeof value === "string")
}

export function source(info: ProviderInfo, connection?: { readonly type: "env" | "credential" }): Provider["source"] {
  if (connection?.type === "env") return "env"
  if (connection?.type === "credential") return "api"
  if (ProviderV2.hasConfiguredCredentials(info)) return "config"
  return "custom"
}

export function provider(
  info: ProviderInfo,
  models: Iterable<ModelInfo>,
  options: {
    readonly source?: Provider["source"]
    readonly env?: readonly string[]
    readonly auth?: Provider["auth"]
    readonly key?: string
    readonly request?: Readonly<Record<string, unknown>>
  } = {},
): Provider {
  const projected = Array.from(models, model)
  return {
    id: info.id,
    name: info.name,
    source: options.source ?? source(info),
    env: [...(options.env ?? [])],
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.key === undefined ? {} : { key: options.key }),
    options: { ...(options.request ?? info.request.body) },
    models: Object.fromEntries(projected.map((item) => [item.id, item])),
  }
}
