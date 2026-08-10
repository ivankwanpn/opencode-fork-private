export * as PluginV1Projection from "./v1-projection"

import type { Model, ModelV2Info, Provider, ProviderV2Info } from "@opencode-ai/sdk/v2/types"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"

type ModelInfo = ModelV2.Info | ModelV2Info
type ProviderInfo = ProviderV2.Info | ProviderV2Info

const media = (values: readonly string[], type: "text" | "audio" | "image" | "video" | "pdf") =>
  values.some((value) => value === type || value.startsWith(`${type}/`))

const releaseDate = (released: number) =>
  released > 0 ? new Date(released).toISOString().slice(0, 10) : ""

export function model(info: ModelInfo): Model {
  const base = info.cost.find((cost) => cost.tier === undefined) ?? info.cost[0] ?? {
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
      attachment:
        info.capabilities.attachment ??
        input.some((value) => !value.startsWith("text")),
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
  }
}

export function source(
  info: ProviderInfo,
  connection?: { readonly type: "env" | "credential" },
): Provider["source"] {
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
    ...(options.key === undefined ? {} : { key: options.key }),
    options: { ...(options.request ?? info.request.body) },
    models: Object.fromEntries(projected.map((item) => [item.id, item])),
  }
}
