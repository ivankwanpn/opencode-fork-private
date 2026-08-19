import type { Model } from "@opencode-ai/sdk/v2/client"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { modelVariantsForProtocol, resolveModelProtocol } from "@/pages/session/composer/model-protocol-variants"

export const subagentAgentIDs = ["general", "explore", "research", "worker"] as const
export const configurableAgentIDs = subagentAgentIDs
export type ConfigurableAgentID = (typeof configurableAgentIDs)[number]

export const agentRoleMetadata = {
  general: { descriptionKey: "settings.agents.role.general" },
  explore: { descriptionKey: "settings.agents.role.explore" },
  research: { descriptionKey: "settings.agents.role.research" },
  worker: { descriptionKey: "settings.agents.role.worker" },
} as const

const protocolByPackage: Readonly<Partial<Record<string, CustomProvider.Protocol>>> = {
  "@ai-sdk/openai": "openai-responses",
  "@ai-sdk/openai-compatible": "openai-compatible",
  "@ai-sdk/anthropic": "anthropic-messages",
}

type AgentModel = Pick<Model, "protocols"> & {
  api?: Pick<Model["api"], "npm">
}

export function parseAgentModel(value: string | null | undefined) {
  if (!value) return
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

export function formatAgentModel(model: { providerID: string; modelID: string }) {
  return `${model.providerID}/${model.modelID}`
}

export function agentModelProtocols(model: AgentModel | undefined) {
  if (!model) return []
  if (model.protocols !== undefined) return [...model.protocols]
  if (!model.api) return []
  const protocol = protocolByPackage[model.api.npm]
  return protocol ? [protocol] : []
}

export function resolveAgentProtocol(
  model: AgentModel | undefined,
  selected: CustomProvider.Protocol | null | undefined,
) {
  return resolveModelProtocol(agentModelProtocols(model), undefined, selected ?? undefined)
}

export function agentReasoningOptions(
  model: Pick<Model, "variants"> | undefined,
  protocol: CustomProvider.Protocol | undefined,
) {
  return modelVariantsForProtocol(Object.keys(model?.variants ?? {}), protocol)
}
