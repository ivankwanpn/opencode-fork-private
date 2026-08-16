import { createMemo, createEffect, on, untrack } from "solid-js"
import type { ModelKey, ModelSelection } from "@/context/local"
import { isPrimaryAgentID, type AgentOverride, type PrimaryAgentID } from "@/context/agent-config"

type PrimaryAgent = {
  name: string
  model?: ModelKey
  variant?: string
}

export function createPrimaryAgentModelSelection(input: {
  selection: () => ModelSelection
  agent: () => PrimaryAgent | undefined
  protocolFor: (model: ModelKey) => ModelKey["protocol"]
  update: (agent: PrimaryAgentID, patch: AgentOverride) => void | Promise<void>
}) {
  const source = input.selection()
  let updateRevision = 0
  const configured = createMemo(() => {
    const agent = input.agent()
    if (!isPrimaryAgentID(agent?.name)) return
    return [
      agent.name,
      agent.model?.providerID ?? "",
      agent.model?.modelID ?? "",
      agent.model?.protocol ?? "",
      agent.variant ?? "",
    ].join("\0")
  })

  createEffect(
    on(configured, () => {
      untrack(() => syncPrimaryAgentModelSelection(input.agent(), source))
    }),
  )

  const update = (patch: AgentOverride) => {
    const agent = input.agent()
    if (!isPrimaryAgentID(agent?.name)) return
    const result = input.update(agent.name, patch)
    if (!result) return
    const revision = ++updateRevision
    void result.catch(() => {
      if (revision !== updateRevision) return
      syncPrimaryAgentModelSelection(input.agent(), source)
    })
  }

  const snapshot = () => {
    const model = source.current()
    if (!model) {
      update({ model: null, protocol: null, variant: null })
      return
    }
    update({
      model: `${model.provider.id}/${model.id}`,
      protocol: source.protocol.current() ?? null,
      variant: source.variant.current() ?? null,
    })
  }

  const selection = {
    ready: source.ready,
    current: source.current,
    recent: source.recent,
    list: source.list,
    cycle(direction: 1 | -1) {
      source.cycle(direction)
      queueMicrotask(snapshot)
    },
    set(model: ModelKey | undefined, options?: { recent?: boolean }) {
      source.set(model, options)
      if (!model) {
        snapshot()
        return
      }
      update({
        model: `${model.providerID}/${model.modelID}`,
        protocol: model.protocol ?? input.protocolFor(model) ?? null,
        variant: model.variant ?? source.variant.current() ?? null,
      })
    },
    visible: source.visible,
    setVisibility: source.setVisibility,
    variant: {
      configured: source.variant.configured,
      selected: source.variant.selected,
      current: source.variant.current,
      list: source.variant.list,
      set(value: string | undefined) {
        source.variant.set(value)
        update({ variant: value ?? null })
      },
      cycle() {
        source.variant.cycle()
        queueMicrotask(() => update({ variant: source.variant.current() ?? null }))
      },
    },
    protocol: {
      list: source.protocol.list,
      current: source.protocol.current,
      set(value: NonNullable<ModelKey["protocol"]>) {
        source.protocol.set(value)
        update({ protocol: value })
      },
    },
  } satisfies ModelSelection

  return selection
}

export function syncPrimaryAgentModelSelection(agent: PrimaryAgent | undefined, selection: ModelSelection) {
  if (!isPrimaryAgentID(agent?.name)) return
  const model = agent.model
  if (!model) {
    selection.set(undefined)
    selection.variant.set(agent.variant)
    return
  }
  const current = selection.current()
  if (
    current?.provider.id !== model.providerID ||
    current?.id !== model.modelID ||
    selection.protocol.current() !== model.protocol
  ) {
    selection.set(model)
  }
  if (selection.variant.current() !== agent.variant) selection.variant.set(agent.variant)
}
