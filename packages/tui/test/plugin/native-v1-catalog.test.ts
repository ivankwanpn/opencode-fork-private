import { expect, test } from "bun:test"
import type { ProviderCatalogInfo } from "@opencode-ai/sdk/v2"
import {
  legacyAgentFromNative,
  legacyCommandFromNative,
  legacyProvidersFromNative,
} from "../../src/plugin/native-v1-catalog"

const catalog: ProviderCatalogInfo = {
  providers: [
    {
      info: {
        id: "connected",
        name: "Connected",
        api: { type: "aisdk", package: "@ai-sdk/openai" },
        request: { headers: {}, body: { region: "test" } },
      },
      source: "api",
      auth: "key",
      env: ["CONNECTED_API_KEY"],
    },
    {
      info: {
        id: "available-later",
        name: "Available later",
        api: { type: "aisdk", package: "@ai-sdk/openai" },
        request: { headers: {}, body: {} },
      },
      source: "custom",
      env: [],
    },
  ],
  models: [
    {
      id: "usable",
      providerID: "connected",
      name: "Usable",
      api: { id: "usable", type: "aisdk", package: "@ai-sdk/openai" },
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      request: { headers: { Test: "yes" }, body: { temperature: 0.5 } },
      variants: [{ id: "fast", headers: {}, body: { speed: "fast" } }],
      time: { released: 1 },
      cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
      status: "active",
      enabled: true,
      limit: { context: 128_000, output: 8_192 },
    },
    {
      id: "disabled",
      providerID: "connected",
      name: "Disabled",
      api: { id: "disabled", type: "aisdk", package: "@ai-sdk/openai" },
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      request: { headers: {}, body: {} },
      variants: [],
      time: { released: 1 },
      cost: [],
      status: "active",
      enabled: false,
      limit: { context: 128_000, output: 8_192 },
    },
    {
      id: "unconnected",
      providerID: "available-later",
      name: "Unconnected",
      api: { id: "unconnected", type: "aisdk", package: "@ai-sdk/openai" },
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      request: { headers: {}, body: {} },
      variants: [],
      time: { released: 1 },
      cost: [],
      status: "active",
      enabled: true,
      limit: { context: 128_000, output: 8_192 },
    },
  ],
  connected: ["connected"],
  default: { connected: "usable", "available-later": "unconnected" },
}

test("projects only connected providers and enabled models across the plugin V1 boundary", () => {
  const result = legacyProvidersFromNative(catalog)

  expect(result.defaults).toEqual({ connected: "usable" })
  expect(result.providers).toHaveLength(1)
  expect(result.providers[0]).toMatchObject({
    id: "connected",
    name: "Connected",
    source: "api",
    auth: "key",
    env: ["CONNECTED_API_KEY"],
    options: { region: "test" },
  })
  expect(Object.keys(result.providers[0]!.models)).toEqual(["usable"])
  expect(result.providers[0]!.models.usable).toMatchObject({
    name: "Usable",
    headers: { Test: "yes" },
    options: { temperature: 0.5 },
    variants: { fast: { speed: "fast" } },
  })
})

test("projects native agents and commands only at the plugin V1 boundary", () => {
  expect(
    legacyAgentFromNative({
      id: "build",
      model: { id: "usable", providerID: "connected", variant: "fast" },
      request: { headers: {}, body: { topP: 0.9, temperature: 0.2 } },
      system: "Build carefully",
      mode: "primary",
      hidden: false,
      permissions: [],
    }),
  ).toMatchObject({
    name: "build",
    model: { modelID: "usable", providerID: "connected" },
    variant: "fast",
    topP: 0.9,
    temperature: 0.2,
    prompt: "Build carefully",
  })
  expect(
    legacyCommandFromNative({
      name: "review",
      template: "Review $ARGUMENTS",
      model: { id: "usable", providerID: "connected" },
    }),
  ).toMatchObject({ name: "review", model: "connected/usable", template: "Review $ARGUMENTS" })
})
