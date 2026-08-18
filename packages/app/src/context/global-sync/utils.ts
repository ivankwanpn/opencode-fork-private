import type { AgentListOutput } from "@opencode-ai/client/promise"
import type { Agent, Project, Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import type { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import type { Project as CurrentProject } from "@opencode-ai/client/promise"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
export { pathKey as directoryKey, type PathKey as DirectoryKey } from "@/utils/path-key"

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function normalizeAgentList(input: AgentListOutput["data"] | Agent[]): Agent[] {
  if (input.every((agent) => !("request" in agent))) return input as Agent[]
  return (input as AgentListOutput["data"]).map((agent) => {
    // v2 伺服器回傳的 request 可能只有 {headers, body} 而沒有 settings,
    // 防禦性地存取避免讀取 undefined 的屬性。
    const settings = agent.request.settings ?? {}
    const protocol =
      agent.model && "protocol" in agent.model && typeof agent.model.protocol === "string"
        ? (agent.model.protocol as CustomProvider.Protocol)
        : undefined
    return {
      name: agent.id,
      description: agent.description,
      mode: agent.mode,
      hidden: agent.hidden,
      temperature: typeof settings.temperature === "number" ? settings.temperature : undefined,
      topP: typeof settings.topP === "number" ? settings.topP : undefined,
      color: agent.color,
      permission: agent.permissions.map((rule) => ({
        permission: rule.action,
        pattern: rule.resource,
        action: rule.effect,
      })),
      model: agent.model && {
        providerID: agent.model.providerID,
        modelID: agent.model.id,
        ...(protocol ? { protocol } : {}),
      },
      variant: agent.model?.variant,
      prompt: agent.system,
      options: settings,
      steps: agent.steps,
    }
  })
}

export function normalizeProviderList(
  input: ProviderCatalog.Info | ProviderListResponse,
): NormalizedProviderListResponse {
  if ("all" in input) {
    return {
      ...input,
      all: new Map(
        input.all.map((provider) => [
          provider.id,
          {
            ...provider,
            models: Object.fromEntries(
              Object.entries(provider.models).filter(([, model]) => model.status !== "deprecated"),
            ),
          },
        ]),
      ),
    }
  }
  const all = new Map<string, Provider>()

  for (const entry of input.providers) {
    all.set(entry.info.id, {
      id: entry.info.id,
      name: entry.info.name,
      source: entry.source,
      auth: entry.auth,
      env: [...entry.env],
      options: {
        ...(entry.info.api.settings ?? {}),
        ...entry.info.request.body,
      },
      models: {},
    })
  }

  for (const model of input.models) {
    const provider = all.get(model.providerID)
    const entry = input.providers.find((item) => item.info.id === model.providerID)
    if (!provider || !entry || !model.enabled || model.status === "deprecated") continue
    const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
    provider.models[model.id] = {
      id: model.id,
      providerID: model.providerID,
      api: {
        id: model.api.id,
        url: model.api.url ?? entry.info.api.url ?? "",
        npm:
          model.api.type === "aisdk"
            ? model.api.package
            : entry.info.api.type === "aisdk"
              ? entry.info.api.package
              : provider.id,
      },
      name: model.name,
      family: model.family,
      capabilities: {
        temperature: model.capabilities.temperature ?? false,
        reasoning: model.capabilities.reasoning ?? false,
        attachment: model.capabilities.attachment ?? model.capabilities.input.some((item) => item !== "text"),
        toolcall: model.capabilities.tools,
        input: {
          text: model.capabilities.input.includes("text"),
          audio: model.capabilities.input.includes("audio"),
          image: model.capabilities.input.includes("image"),
          video: model.capabilities.input.includes("video"),
          pdf: model.capabilities.input.includes("pdf"),
        },
        output: {
          text: model.capabilities.output.includes("text"),
          audio: model.capabilities.output.includes("audio"),
          image: model.capabilities.output.includes("image"),
          video: model.capabilities.output.includes("video"),
          pdf: model.capabilities.output.includes("pdf"),
        },
        interleaved: model.capabilities.interleaved ?? false,
      },
      cost: {
        input: cost?.input ?? 0,
        output: cost?.output ?? 0,
        cache: {
          read: cost?.cache.read ?? 0,
          write: cost?.cache.write ?? 0,
        },
      },
      limit: model.limit,
      status: model.status,
      options: {
        ...(model.api.settings ?? {}),
        ...model.request.body,
      },
      headers: model.request.headers,
      release_date: new Date(model.time.released).toISOString().slice(0, 10),
      variants: Object.fromEntries(model.variants.map((variant) => [variant.id, variant.body])),
      protocols: model.protocols ? [...model.protocols] : undefined,
    }
  }

  return {
    all,
    connected: [...input.connected],
    default: { ...input.default },
  }
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url && !project.icon?.override) return project
  return {
    ...project,
    icon: {
      ...project.icon,
      url: undefined,
      override: undefined,
    },
  }
}

export function normalizeProjectInfo(project: Project | CurrentProject): Project {
  return {
    ...project,
    vcs: project.vcs === "git" ? "git" : undefined,
  }
}
