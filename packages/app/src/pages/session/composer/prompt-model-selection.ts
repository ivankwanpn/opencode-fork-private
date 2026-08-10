import { batch, createMemo, startTransition } from "solid-js"
import { useModels } from "@/context/models"
import type { ModelKey, ModelSelection } from "@/context/local"
import { cycleModelVariant, getConfiguredAgentVariant, resolveModelVariant } from "@/context/model-variant"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useProviders } from "@/hooks/use-providers"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { modelVariantsForProtocol, resolveModelProtocol } from "./model-protocol-variants"

export function createPromptModelSelection(input: { agent: () => { model?: ModelKey; variant?: string } | undefined }) {
  const sdk = useSDK()
  const sync = useSync()
  const models = useModels()
  const prompt = usePrompt()
  const providers = useProviders(() => sdk().directory)
  const connected = createMemo(() => new Set(providers.connected().map((item) => item.id)))

  const valid = (model: ModelKey) => {
    const provider = providers.all().get(model.providerID)
    return !!provider?.models[model.modelID] && connected().has(model.providerID)
  }

  const configured = () => {
    const value = sync().data.config.model
    if (!value) return
    const [providerID, modelID] = value.split("/")
    const model = { providerID, modelID }
    if (valid(model)) return model
  }

  const recent = () => models.recent.list().find(valid)
  const fallback = () => {
    const defaults = providers.default()
    return providers.connected().flatMap((provider) => {
      const modelID = defaults[provider.id] ?? Object.values(provider.models)[0]?.id
      return modelID ? [{ providerID: provider.id, modelID }] : []
    })[0]
  }

  const current = () => {
    const key = [prompt.model.current(), input.agent()?.model, configured(), recent(), fallback()].find(
      (item): item is ModelKey => !!item && valid(item),
    )
    if (!key) return
    return models.find(key)
  }
  const recentModels = createMemo(() =>
    models.recent
      .list()
      .map(models.find)
      .filter((item): item is NonNullable<typeof item> => !!item),
  )
  const selectedProtocol = () => {
    const model = current()
    if (!model) return
    return resolveModelProtocol(
      model.protocols ?? [],
      prompt.model.current()?.protocol,
      models.protocol.get({ providerID: model.provider.id, modelID: model.id }),
    )
  }

  const selection = {
    ready: models.ready,
    current,
    recent: recentModels,
    list: models.list,
    cycle(direction: 1 | -1) {
      const items = recentModels()
      const item = current()
      if (!item) return
      const index = items.findIndex((entry) => entry.provider.id === item.provider.id && entry.id === item.id)
      if (index === -1) return
      const next = items[(index + direction + items.length) % items.length]
      if (next) selection.set({ providerID: next.provider.id, modelID: next.id })
    },
    set(item: ModelKey | undefined, options?: { recent?: boolean }) {
      const next = item
        ? {
            ...item,
            protocol: item.protocol ?? models.protocol.get(item),
          }
        : undefined
      startTransition(() =>
        batch(() => {
          prompt.model.set(next ? { ...next, variant: prompt.model.current()?.variant } : undefined)
          if (!next) return
          models.setVisibility(next, true)
          if (options?.recent) models.recent.push(next)
        }),
      )
    },
    visible: models.visible,
    setVisibility: models.setVisibility,
    variant: {
      configured() {
        const item = input.agent()
        const model = current()
        if (!item || !model) return
        return getConfiguredAgentVariant({
          agent: { model: item.model, variant: item.variant },
          model: { providerID: model.provider.id, modelID: model.id, variants: model.variants },
        })
      },
      selected() {
        return prompt.model.current()?.variant
      },
      current() {
        const resolved = resolveModelVariant({
          variants: this.list(),
          selected: this.selected(),
          configured: this.configured(),
        })
        if (resolved) return resolved
        const model = current()
        if (!model) return
        const saved = models.variant.get({
          providerID: model.provider.id,
          modelID: model.id,
          protocol: selectedProtocol(),
        })
        if (saved && this.list().includes(saved)) return saved
      },
      list() {
        const variants = Object.keys(current()?.variants ?? {})
        return modelVariantsForProtocol(variants, selectedProtocol())
      },
      set(value: string | undefined) {
        startTransition(() =>
          batch(() => {
            const model = current()
            if (!model) return
            prompt.model.set({
              providerID: model.provider.id,
              modelID: model.id,
              variant: value ?? null,
              protocol: selectedProtocol(),
            })
            models.variant.set(
              {
                providerID: model.provider.id,
                modelID: model.id,
                protocol: selectedProtocol(),
              },
              value,
            )
          }),
        )
      },
      cycle() {
        const variants = this.list()
        if (variants.length === 0) return
        this.set(
          cycleModelVariant({
            variants,
            selected: this.selected(),
            configured: this.configured(),
          }),
        )
      },
    },
    protocol: {
      list() {
        return [...(current()?.protocols ?? [])]
      },
      current: selectedProtocol,
      set(value: CustomProvider.Protocol) {
        const model = current()
        if (!model?.protocols?.includes(value)) return
        startTransition(() =>
          batch(() => {
            const key = {
              providerID: model.provider.id,
              modelID: model.id,
              protocol: value,
            }
            prompt.model.set({ ...key, variant: selection.variant.current() ?? null })
            models.protocol.set(key, value)
          }),
        )
      },
    },
  } satisfies ModelSelection

  return selection
}
