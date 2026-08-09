import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { fetchCodexModels } from "@opencode-ai/core/plugin/provider/codex-models"
import { makeOpenAIPlugin, OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { ProviderModelDiscovery } from "@opencode-ai/core/provider-discovery"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(
  ProviderModelDiscovery.makeLayer({
    fetch: async () => Response.json({ data: [{ id: "compatible-model" }] }),
  }).pipe(Layer.provideMerge(PluginTestLayer)),
)

const addPlugin = (item = OpenAIPlugin) =>
  Effect.gen(function* () {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const integrations = yield* Integration.Service
  yield* item.effect(host).pipe(Effect.provideService(Integration.Service, integrations))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

describe("OpenAIPlugin", () => {
  it.effect("registers a dedicated Codex strategy for OAuth without exposing credentials", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const discovery = yield* ProviderModelDiscovery.Service
      let headers: Headers | undefined
      const codexFetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        headers = new Headers(init?.headers)
        return Response.json({ data: [{ id: "runtime-model", name: "Runtime", context_window: 200_000 }] })
      }) as unknown as typeof fetch
      yield* catalog.transform((draft) => {
        draft.provider.update(ProviderV2.ID.openai, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai", url: "https://api.openai.com/v1" }
        })
      })
      yield* credentials.create({
        integrationID: Integration.ID.make(ProviderV2.ID.openai),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "access-secret",
          refresh: "refresh-secret",
          expires: Date.now() + 60_000,
          metadata: { accountID: "account-secret" },
        }),
      })
      yield* addPlugin(
        makeOpenAIPlugin({
          fetchCodexModels: (auth) =>
            fetchCodexModels(auth, {
              fetch: codexFetch,
            }),
        }),
      )

      const result = yield* discovery.discover(ProviderV2.ID.openai)
      expect(result).toEqual({
        providerID: ProviderV2.ID.openai,
        source: "oauth",
        models: [{ id: "runtime-model", name: "Runtime", context: 200_000 }],
      })
      expect(headers?.get("ChatGPT-Account-Id")).toBe("account-secret")
      expect(JSON.stringify(result)).not.toContain("access-secret")
      expect(JSON.stringify(result)).not.toContain("refresh-secret")
      expect(JSON.stringify(result)).not.toContain("account-secret")
    }),
  )

  it.effect("refreshes rejected OAuth access once before retrying Codex discovery", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const discovery = yield* ProviderModelDiscovery.Service
      const methodID = Integration.MethodID.make("chatgpt-browser")
      let calls = 0
      let refreshes = 0
      yield* catalog.transform((draft) => {
        draft.provider.update(ProviderV2.ID.openai, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai", url: "https://api.openai.com/v1" }
        })
      })
      yield* addPlugin(
        makeOpenAIPlugin({
          fetchCodexModels: async (auth) => {
            calls++
            if (auth.access === "stale-access") throw new Error("Codex model discovery failed: 403")
            return [{ id: "fresh-runtime-model", context: 200_000 }]
          },
        }),
      )
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID: Integration.ID.make(ProviderV2.ID.openai),
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () =>
            Effect.succeed({
              mode: "auto" as const,
              url: "https://example.com/authorize",
              instructions: "Sign in",
              callback: Effect.never,
            }),
          refresh: (value) => {
            refreshes++
            return Effect.succeed(
              Credential.OAuth.make({
                ...value,
                access: "fresh-access",
                refresh: "rotated-refresh",
                expires: Date.now() + 60 * 60 * 1000,
              }),
            )
          },
        }),
      )
      const stored = yield* credentials.create({
        integrationID: Integration.ID.make(ProviderV2.ID.openai),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "stale-access",
          refresh: "refresh-token",
          expires: Date.now() + 60 * 60 * 1000,
          metadata: { accountID: "account-id" },
        }),
      })

      const result = yield* discovery.discover(ProviderV2.ID.openai)
      expect(result).toEqual({
        providerID: ProviderV2.ID.openai,
        source: "oauth",
        models: [{ id: "fresh-runtime-model", context: 200_000 }],
      })
      expect(calls).toBe(2)
      expect(refreshes).toBe(1)
      expect((yield* credentials.get(stored.id))?.value).toMatchObject({
        type: "oauth",
        access: "fresh-access",
        refresh: "rotated-refresh",
      })
      expect(JSON.stringify(result)).not.toContain("stale-access")
      expect(JSON.stringify(result)).not.toContain("rotated-refresh")
    }),
  )

  it.effect("falls through to compatible discovery for an OpenAI API key", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const discovery = yield* ProviderModelDiscovery.Service
      yield* catalog.transform((draft) => {
        draft.provider.update(ProviderV2.ID.openai, (provider) => {
          provider.api = { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.openai.com/v1" }
        })
      })
      yield* credentials.create({
        integrationID: Integration.ID.make(ProviderV2.ID.openai),
        value: Credential.Key.make({ type: "key", key: "api-key" }),
      })
      yield* addPlugin()

      expect((yield* discovery.discover(ProviderV2.ID.openai)).source).toBe("compatible")
    }),
  )

  it.effect("prefers the Codex device OAuth method before browser OAuth", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("openai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("chatgpt-headless"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (headless)",
        },
        {
          id: Integration.MethodID.make("chatgpt-browser"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
        },
      ])
    }),
  )

  it.effect("creates an OpenAI SDK for @ai-sdk/openai using the provider ID as SDK name", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-openai"), ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai",
        options: { name: "custom-openai", apiKey: "test" },
      })
      expect(result.sdk?.responses("gpt-5").provider).toBe("custom-openai.responses")
    }),
  )

  it.effect("ignores non-OpenAI SDK packages", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "openai" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses the Responses API for language models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("alias")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:gpt-5"])
      expect(result.language).toBeDefined()
    }),
  )

  it.effect("ignores non-OpenAI providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.anthropic, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "test-provider" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )

  it.effect("disables gpt-5-chat-latest during catalog transforms", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const item = ProviderV2.Info.make({
          ...ProviderV2.Info.empty(ProviderV2.ID.openai),
          api: { type: "aisdk", package: "@ai-sdk/openai" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5"), () => {})
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(required(yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5"))).enabled).toBe(true)
      expect(
        required(yield* catalog.model.get(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(false)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-OpenAI providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const item = ProviderV2.Info.make({
          ...ProviderV2.Info.empty(ProviderV2.ID.make("custom-openai")),
          api: { type: "aisdk", package: "test-provider" },
        })
        catalog.provider.update(item.id, (draft) => {
          draft.api = item.api
        })
        catalog.model.update(item.id, ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* catalog.model.get(ProviderV2.ID.make("custom-openai"), ModelV2.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(true)
    }),
  )
})
