import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"
import { legacyProvidersFromNative } from "@/compat/native-v1-catalog"

test("legacy provider projection preserves canonical runtime options", () => {
  const providerID = ProviderV2.ID.make("configured")
  const modelID = ModelV2.ID.make("chat")
  const provider = ProviderV2.Info.make({
    ...ProviderV2.Info.empty(providerID),
    api: {
      type: "aisdk",
      package: "@ai-sdk/openai-compatible",
      url: "https://gateway.example.test/v1",
      settings: { region: "test-region" },
    },
    request: {
      headers: { Authorization: "Bearer configured-key", "X-Tenant": "acme" },
      body: { custom: true },
    },
  })
  const model = ModelV2.Info.make({
    ...ModelV2.Info.empty(providerID, modelID),
    api: {
      type: "aisdk",
      id: modelID,
      package: "@ai-sdk/openai-compatible",
      url: "https://gateway.example.test/v1",
      settings: { region: "test-region" },
    },
  })
  const catalog = {
    providers: [{ info: provider, source: "config", auth: "key", env: [] }],
    models: [model],
    connected: [providerID],
    default: { [providerID]: modelID },
  } satisfies ProviderCatalog.Info

  const projected = legacyProvidersFromNative(catalog).providers[0]
  expect(projected?.options).toEqual({
    region: "test-region",
    custom: true,
    baseURL: "https://gateway.example.test/v1",
    headers: { Authorization: "Bearer configured-key", "X-Tenant": "acme" },
    apiKey: "configured-key",
  })
})
