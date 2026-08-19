import { describe, expect, test } from "bun:test"
import type { ProviderCatalogInfo } from "@opencode-ai/sdk/v2"
import { findModel, hasConnectedProvider } from "../../src/feature-plugins/catalog"

const model = (providerID: string, input = 0) => ({
  id: `${providerID}-model`,
  providerID,
  name: `${providerID} model`,
  api: { id: "native", type: "native" as const, settings: {} },
  capabilities: {
    tools: true,
    attachment: false,
    reasoning: false,
    temperature: true,
    input: ["text" as const],
    output: ["text" as const],
  },
  request: { headers: {}, body: {} },
  variants: [],
  time: { released: 1 },
  cost: [{ input, output: 0, cache: { read: 0, write: 0 } }],
  status: "active" as const,
  enabled: true,
  limit: { context: 128_000, output: 8_000 },
})

const catalog = (providerID: string, input = 0): ProviderCatalogInfo => ({
  providers: [
    {
      info: {
        id: providerID,
        name: providerID,
        api: { type: "native", settings: {} },
        request: { headers: {}, body: {} },
      },
      source: "config",
      env: [],
    },
  ],
  models: [model(providerID, input)],
  connected: [providerID],
  default: {},
})

describe("canonical TUI provider catalog", () => {
  test("TUI plugin state does not restore native V1 adapters", async () => {
    const adapters = await Bun.file(new URL("../../src/plugin/adapters.tsx", import.meta.url)).text()
    expect(adapters).not.toContain("legacyTranscriptFromNative")
    expect(adapters).not.toContain("legacyProvidersFromNative")
    expect(await Bun.file(new URL("../../src/plugin/native-v1-transcript.ts", import.meta.url)).exists()).toBe(false)
    expect(await Bun.file(new URL("../../src/plugin/native-v1-catalog.ts", import.meta.url)).exists()).toBe(false)
  })

  test("detects connected external providers and paid OpenCode models", () => {
    expect(hasConnectedProvider(undefined)).toBe(false)
    expect(hasConnectedProvider(catalog("opencode"))).toBe(false)
    expect(hasConnectedProvider(catalog("opencode", 1))).toBe(true)
    expect(hasConnectedProvider(catalog("anthropic"))).toBe(true)
  })

  test("finds only enabled models on connected providers", () => {
    const input = catalog("anthropic")
    expect(findModel(input, { providerID: "anthropic", id: "anthropic-model" })).toBe(input.models[0])
    input.connected = []
    expect(findModel(input, { providerID: "anthropic", id: "anthropic-model" })).toBeUndefined()
  })
})
