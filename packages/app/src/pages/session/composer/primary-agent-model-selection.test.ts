import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { ModelKey, ModelSelection } from "@/context/local"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import {
  createPrimaryAgentModelSelection,
  syncPrimaryAgentModelSelection,
} from "./primary-agent-model-selection"

type SelectedModel = NonNullable<ReturnType<ModelSelection["current"]>>

function selectedModel(model: ModelKey) {
  return {
    id: model.modelID,
    provider: { id: model.providerID },
  } as SelectedModel
}

function modelSelection(initial?: ModelKey) {
  const current = createSignal(initial ? selectedModel(initial) : undefined)
  const variant = createSignal<string | undefined>(initial?.variant)
  const protocol = createSignal<CustomProvider.Protocol | undefined>(initial?.protocol)
  const calls = {
    model: [] as Array<ModelKey | undefined>,
    variant: [] as Array<string | undefined>,
    protocol: [] as CustomProvider.Protocol[],
  }
  const ready = Object.assign(() => true, { promise: undefined as Promise<unknown> | undefined })
  const selection = {
    ready,
    current: current[0],
    recent: () => [],
    list: () => [],
    cycle() {},
    set(value: ModelKey | undefined) {
      calls.model.push(value)
      current[1](value ? selectedModel(value) : undefined)
      protocol[1](value?.protocol)
    },
    visible: () => true,
    setVisibility() {},
    variant: {
      configured: () => undefined,
      selected: variant[0],
      current: variant[0],
      list: () => [],
      set(value: string | undefined) {
        calls.variant.push(value)
        variant[1](value)
      },
      cycle() {},
    },
    protocol: {
      list: () => [],
      current: protocol[0],
      set(value: CustomProvider.Protocol) {
        calls.protocol.push(value)
        protocol[1](value)
      },
    },
  } satisfies ModelSelection
  return { selection, calls }
}

describe("primary agent model selection", () => {
  test("applies settings changes to the Composer without writing them back", () => {
    createRoot((dispose) => {
      const source = modelSelection({ providerID: "openai", modelID: "old", protocol: "openai-responses" })
      syncPrimaryAgentModelSelection(
        {
          name: "build",
          model: { providerID: "anthropic", modelID: "claude", protocol: "anthropic-messages" },
          variant: "high",
        },
        source.selection,
      )

      expect(source.calls.model).toEqual([
        { providerID: "anthropic", modelID: "claude", protocol: "anthropic-messages" },
      ])
      expect(source.calls.variant).toEqual(["high"])
      dispose()
    })
  })

  test("clears the Composer override when settings restore the agent default", () => {
    createRoot((dispose) => {
      const source = modelSelection({ providerID: "openai", modelID: "old", protocol: "openai-responses" })
      syncPrimaryAgentModelSelection({ name: "plan" }, source.selection)

      expect(source.calls.model).toEqual([undefined])
      expect(source.calls.variant).toEqual([undefined])
      dispose()
    })
  })

  test("reacts when an agent catalog refresh changes the configured model", async () => {
    const result = createRoot((dispose) => {
      const source = modelSelection({ providerID: "openai", modelID: "old", protocol: "openai-responses" })
      const agent = createSignal<{ name: string; model?: ModelKey; variant?: string }>({
        name: "build",
        model: { providerID: "openai", modelID: "old", protocol: "openai-responses" },
      })
      createPrimaryAgentModelSelection({
        selection: () => source.selection,
        agent: agent[0],
        protocolFor: () => "openai-responses",
        update() {},
      })
      return { agent, dispose, source }
    })

    await Promise.resolve()
    result.agent[1]({
      name: "build",
      model: { providerID: "anthropic", modelID: "claude", protocol: "anthropic-messages" },
      variant: "high",
    })
    await Promise.resolve()

    expect(result.source.selection.current()).toMatchObject({ id: "claude", provider: { id: "anthropic" } })
    expect(result.source.selection.variant.current()).toBe("high")
    result.dispose()
  })

  test("persists Composer model, protocol, and variant changes for primary agents only", () => {
    createRoot((dispose) => {
      const source = modelSelection()
      const updates: Array<{ agent: string; patch: Record<string, unknown> }> = []
      const selection = createPrimaryAgentModelSelection({
        selection: () => source.selection,
        agent: () => ({ name: "build" }),
        protocolFor: () => "openai-responses",
        update: (agent, patch) => {
          updates.push({ agent, patch })
        },
      })

      selection.set({ providerID: "openai", modelID: "gpt-5" })
      selection.protocol.set("openai-compatible")
      selection.variant.set("xhigh")

      expect(updates).toEqual([
        {
          agent: "build",
          patch: { model: "openai/gpt-5", protocol: "openai-responses", variant: null },
        },
        { agent: "build", patch: { protocol: "openai-compatible" } },
        { agent: "build", patch: { variant: "xhigh" } },
      ])
      dispose()
    })
  })

  test("does not persist Composer changes for custom primary agents", () => {
    createRoot((dispose) => {
      const source = modelSelection()
      const updates: Array<Record<string, unknown>> = []
      const selection = createPrimaryAgentModelSelection({
        selection: () => source.selection,
        agent: () => ({ name: "review" }),
        protocolFor: () => "openai-responses",
        update: (_, patch) => {
          updates.push(patch)
        },
      })

      selection.set({ providerID: "openai", modelID: "gpt-5" })
      selection.variant.set("high")

      expect(updates).toEqual([])
      dispose()
    })
  })

  test("restores the configured agent selection when persistence fails", async () => {
    const result = createRoot((dispose) => {
      const configured = { providerID: "anthropic", modelID: "claude", protocol: "anthropic-messages" } as const
      const source = modelSelection(configured)
      const selection = createPrimaryAgentModelSelection({
        selection: () => source.selection,
        agent: () => ({ name: "build", model: configured, variant: "high" }),
        protocolFor: () => "openai-responses",
        update: () => Promise.reject(new Error("save failed")),
      })
      return { dispose, selection, source }
    })

    result.selection.set({ providerID: "openai", modelID: "gpt-5" })
    await Promise.resolve()
    await Promise.resolve()

    expect(result.source.selection.current()).toMatchObject({ id: "claude", provider: { id: "anthropic" } })
    expect(result.source.calls.variant).toEqual(["high"])
    result.dispose()
  })
})
