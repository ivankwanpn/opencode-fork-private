import type { Model } from "@opencode-ai/sdk/v2/client"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { modelVariantsForProtocol, resolveModelProtocol } from "@/pages/session/composer/model-protocol-variants"

export const configurableAgentIDs = ["build", "plan", "general", "explore"] as const
export type ConfigurableAgentID = (typeof configurableAgentIDs)[number]

export function parseAgentModel(value: string | null | undefined) {
  if (!value) return
  const separator = value.indexOf("/")
  if (separator <= 0 || separator === value.length - 1) return
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

export function formatAgentModel(model: { providerID: string; modelID: string }) {
  return `${model.providerID}/${model.modelID}`
}

export function resolveAgentProtocol(
  model: Pick<Model, "protocols"> | undefined,
  selected: CustomProvider.Protocol | null | undefined,
) {
  return resolveModelProtocol([...(model?.protocols ?? [])], undefined, selected ?? undefined)
}

export function agentReasoningOptions(
  model: Pick<Model, "variants"> | undefined,
  protocol: CustomProvider.Protocol | undefined,
) {
  return modelVariantsForProtocol(Object.keys(model?.variants ?? {}), protocol)
}
