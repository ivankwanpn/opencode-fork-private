import type {
  AgentsListOutput,
  CommandsListOutput,
  IntegrationsListOutput,
  ModelsListOutput,
  ProvidersListOutput,
} from "@opencode-ai/client"
import type { Agent, Command, Model, Provider } from "@opencode-ai/sdk/v2"

type NativeAgent = AgentsListOutput["data"][number]
type NativeCommand = CommandsListOutput["data"][number]
type NativeModel = ModelsListOutput["data"][number]

export function legacyAgentFromNative(info: NativeAgent): Agent {
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
    permission: [],
    model: info.model ? { modelID: info.model.id, providerID: info.model.providerID } : undefined,
    variant: info.model?.variant,
    prompt: info.system,
    options: { ...info.request.body },
    steps: info.steps,
  }
}

export function legacyCommandFromNative(info: NativeCommand): Command {
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

function legacyModelFromNative(info: NativeModel): Model {
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

export function legacyProvidersFromNative(input: {
  providers: ProvidersListOutput["data"]
  models: ModelsListOutput["data"]
  integrations: IntegrationsListOutput["data"]
}): {
  providers: Provider[]
  defaults: Record<string, string>
  integrations: IntegrationsListOutput["data"]
} {
  const byProvider = new Map<string, NativeModel[]>()
  for (const model of input.models) {
    const list = byProvider.get(model.providerID)
    if (list) list.push(model)
    else byProvider.set(model.providerID, [model])
  }
  const defaults: Record<string, string> = {}
  const providers = input.providers.map((provider): Provider => {
    const models = byProvider.get(provider.id) ?? []
    if (models[0]) defaults[provider.id] = models[0].id
    return {
      id: provider.id,
      name: provider.name,
      source: "config",
      env: [],
      options: { ...provider.request.body },
      models: Object.fromEntries(models.map((model) => [model.id, legacyModelFromNative(model)])),
    }
  })
  return { providers, defaults, integrations: input.integrations }
}
