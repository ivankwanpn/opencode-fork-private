import type {
  Agent,
  AgentV2Info,
  CommandV2Info,
  Model,
  ModelV2Info,
  Provider,
  ProviderCatalogInfo,
} from "@opencode-ai/sdk/v2"
import type { Command } from "@opencode-ai/sdk"
import type { AgentV2 } from "@opencode-ai/core/agent"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"

function projectLegacyAgent(info: AgentV2Info | AgentV2.Info) {
  const topP = info.request.body.topP
  const temperature = info.request.body.temperature
  return {
    name: info.id,
    description: info.description,
    mode: info.mode,
    hidden: info.hidden,
    color: info.color,
    topP: typeof topP === "number" ? topP : undefined,
    temperature: typeof temperature === "number" ? temperature : undefined,
    permission: info.permissions.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    model: info.model
      ? { modelID: info.model.id, providerID: info.model.providerID, protocol: info.model.protocol }
      : undefined,
    variant: info.model?.variant,
    prompt: info.system,
    options: { ...info.request.body },
    steps: info.steps,
  }
}

export function legacyAgentFromNative(info: AgentV2Info): Agent {
  return projectLegacyAgent(info)
}

export function legacyAgentFromCore(info: AgentV2.Info) {
  return {
    ...projectLegacyAgent(info),
    model: info.model
      ? {
          modelID: info.model.id,
          providerID: info.model.providerID,
          protocol: info.model.protocol,
        }
      : undefined,
  }
}

export function legacyCommandFromNative(info: CommandV2Info): Command & { hints: string[] } {
  return {
    name: info.name,
    description: info.description,
    agent: info.agent,
    model: info.model ? `${info.model.providerID}/${info.model.id}` : undefined,
    template: info.template,
    subtask: info.subtask,
    hints: [],
  }
}

function legacyModelFromNative(info: ModelV2Info | ModelV2.Info): Model {
  const base = info.cost.find((item) => item.tier === undefined) ?? info.cost[0]
  const tiers = info.cost.flatMap((item) =>
    item.tier
      ? [
          {
            input: item.input,
            output: item.output,
            cache: { read: item.cache.read, write: item.cache.write },
            tier: { type: "context" as const, size: item.tier.size },
          },
        ]
      : [],
  )
  const input = new Set(info.capabilities.input)
  const output = new Set(info.capabilities.output)
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
      temperature: info.capabilities.temperature === true,
      reasoning: info.capabilities.reasoning === true,
      attachment: info.capabilities.attachment === true,
      toolcall: info.capabilities.tools,
      input: {
        text: input.has("text"),
        audio: input.has("audio"),
        image: input.has("image"),
        video: input.has("video"),
        pdf: input.has("pdf"),
      },
      output: {
        text: output.has("text"),
        audio: output.has("audio"),
        image: output.has("image"),
        video: output.has("video"),
        pdf: output.has("pdf"),
      },
      interleaved: info.capabilities.interleaved ?? false,
    },
    cost: {
      input: base?.input ?? 0,
      output: base?.output ?? 0,
      cache: { read: base?.cache.read ?? 0, write: base?.cache.write ?? 0 },
      ...(tiers.length === 0 ? {} : { tiers }),
    },
    limit: info.limit,
    status: info.status,
    options: { ...info.request.body },
    headers: { ...info.request.headers },
    release_date: new Date(info.time.released).toISOString().slice(0, 10),
    variants:
      info.variants.length === 0
        ? undefined
        : Object.fromEntries(info.variants.map((variant) => [variant.id, { ...variant.body }])),
  }
}

export function legacyProvidersFromNative(catalog: ProviderCatalogInfo | ProviderCatalog.Info): {
  providers: Provider[]
  defaults: Record<string, string>
} {
  return projectLegacyProviders(catalog, true)
}

export function legacyAllProvidersFromNative(catalog: ProviderCatalogInfo | ProviderCatalog.Info): {
  providers: Provider[]
  defaults: Record<string, string>
} {
  return projectLegacyProviders(catalog, false)
}

function projectLegacyProviders(catalog: ProviderCatalogInfo | ProviderCatalog.Info, connectedOnly: boolean) {
  type LegacyModelInfo = ModelV2Info | ModelV2.Info
  const connected = new Set(catalog.connected)
  const visible = new Set(
    catalog.providers.flatMap((provider) =>
      provider.info.disabled || (connectedOnly && !connected.has(provider.info.id)) ? [] : [provider.info.id],
    ),
  )
  const models = catalog.models
    .filter((model) => visible.has(model.providerID) && model.enabled)
    .reduce((result, model) => {
      const list = result.get(model.providerID)
      if (list) list.push(model)
      if (!list) result.set(model.providerID, [model])
      return result
    }, new Map<string, LegacyModelInfo[]>())

  return {
    providers: catalog.providers.flatMap((provider) => {
      if (!visible.has(provider.info.id)) return []
      const apiKey =
        provider.info.api.settings?.apiKey === undefined && provider.info.request.body.apiKey === undefined
          ? credentialKey(provider.info.request.headers)
          : undefined
      const body = {
        ...(provider.info.api.settings ?? {}),
        ...provider.info.request.body,
      }
      const options = {
        ...body,
        ...(provider.info.api.url ? { baseURL: provider.info.api.url } : {}),
        ...(Object.keys(provider.info.request.headers).length
          ? { headers: { ...provider.info.request.headers } }
          : {}),
        ...(apiKey === undefined ? {} : { apiKey }),
      }
      return [
        {
          id: provider.info.id,
          name: provider.info.name,
          source: provider.source,
          auth: provider.auth,
          env: [...provider.env],
          options,
          models: Object.fromEntries(
            (models.get(provider.info.id) ?? []).map((model) => [model.id, legacyModelFromNative(model)]),
          ),
        },
      ]
    }),
    defaults: Object.fromEntries(
      Object.entries(catalog.default).filter(([providerID]) => visible.has(providerID)),
    ),
  }
}

function credentialKey(headers: Readonly<Record<string, string>>) {
  const entries = Object.entries(headers)
  const authorization = entries.find(([name]) => name.toLowerCase() === "authorization")?.[1]
  const bearer = authorization === undefined ? undefined : /^Bearer\s+(.+)$/i.exec(authorization)?.[1]
  if (bearer) return bearer
  return entries.find(([name, value]) =>
    ["x-api-key", "api-key", "x-goog-api-key"].includes(name.toLowerCase()) && value.length > 0,
  )?.[1]
}
