import { test, expect, describe } from "bun:test"
import { resolvePluginProviders } from "../../src/cli/cmd/providers"
import { Integration } from "@opencode-ai/core/integration"

function integrationWithAuth(provider: string) {
  return new Integration.Info({
    id: Integration.ID.make(provider),
    name: provider,
    methods: [{ type: "key", label: "API key" }],
    connections: [],
  })
}

function integrationWithoutAuth(provider: string) {
  return new Integration.Info({
    id: Integration.ID.make(provider),
    name: provider,
    methods: [{ type: "env", names: ["TEST_KEY"] }],
    connections: [],
  })
}

describe("resolvePluginProviders", () => {
  test("returns plugin providers not in models.dev", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips providers already in models.dev", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("anthropic")],
      existingProviders: { anthropic: {} },
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("deduplicates across plugins", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey"), integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("respects disabled_providers", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("respects enabled_providers when provider is absent", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["anthropic"]),
      providerNames: {},
    })
    expect(result).toEqual([])
  })

  test("includes provider when in enabled set", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      enabled: new Set(["portkey"]),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("resolves name from providerNames", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: { portkey: "Portkey AI" },
    })
    expect(result).toEqual([{ id: "portkey", name: "Portkey AI" }])
  })

  test("falls back to id when no name configured", () => {
    const result = resolvePluginProviders({
      integrations: [integrationWithAuth("portkey")],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("skips integrations without interactive auth", () => {
    const result = resolvePluginProviders({
      integrations: [
        integrationWithoutAuth("env-one"),
        integrationWithAuth("portkey"),
        integrationWithoutAuth("env-two"),
      ],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([{ id: "portkey", name: "portkey" }])
  })

  test("returns empty for no integrations", () => {
    const result = resolvePluginProviders({
      integrations: [],
      existingProviders: {},
      disabled: new Set(),
      providerNames: {},
    })
    expect(result).toEqual([])
  })
})
