import type { Config } from "@opencode-ai/sdk/v2/client"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"

export const primaryAgentIDs = ["build", "plan"] as const
export type PrimaryAgentID = (typeof primaryAgentIDs)[number]

export type AgentOverride = {
  model?: string | null
  protocol?: CustomProvider.Protocol | null
  variant?: string | null
  [key: string]: unknown
}

export function isPrimaryAgentID(value: string | undefined): value is PrimaryAgentID {
  return primaryAgentIDs.some((id) => id === value)
}

export function agentOverride(config: Config, id: string): AgentOverride {
  const value = config.agent?.[id]
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as AgentOverride
}

export function normalizedAgentOverride(value: AgentOverride) {
  return {
    ...value,
    model: value.model ?? undefined,
    protocol: value.protocol ?? undefined,
    variant: value.variant ?? undefined,
  }
}
