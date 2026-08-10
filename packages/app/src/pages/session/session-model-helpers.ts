import type { UserMessage } from "@opencode-ai/sdk/v2"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

type ModelSelection = {
  model: {
    current(): { id: string; provider: { id: string } } | undefined
    set(model: { providerID: string; modelID: string }): void
    variant: {
      current(): string | undefined
      set(variant: string | undefined): void
    }
    protocol?: {
      current(): CustomProvider.Protocol | undefined
      set(protocol: CustomProvider.Protocol): void
    }
  }
}

type PromptState = {
  model: {
    current():
      | { providerID: string; modelID: string; variant?: string | null; protocol?: CustomProvider.Protocol }
      | undefined
    set(model: {
      providerID: string
      modelID: string
      variant?: string | null
      protocol?: CustomProvider.Protocol
    }): void
  }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}

export const syncPromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = local.model.current()
  if (!model) return
  const next = {
    providerID: model.provider.id,
    modelID: model.id,
    variant: local.model.variant.current(),
    protocol: local.model.protocol?.current(),
  }
  const current = prompt.model.current()
  if (
    current?.providerID === next.providerID &&
    current.modelID === next.modelID &&
    current.variant === next.variant &&
    current.protocol === next.protocol
  )
    return
  prompt.model.set(next)
}

export const restorePromptModel = (local: ModelSelection, prompt: PromptState) => {
  const model = prompt.model.current()
  if (!model) return false
  const current = local.model.current()
  if (
    current?.provider.id === model.providerID &&
    current.id === model.modelID &&
    local.model.variant.current() === (model.variant ?? undefined) &&
    local.model.protocol?.current() === model.protocol
  )
    return true
  local.model.set({ providerID: model.providerID, modelID: model.modelID })
  local.model.variant.set(model.variant ?? undefined)
  if (model.protocol) local.model.protocol?.set(model.protocol)
  return true
}
