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

type RuntimeFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>

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

  it.effect("configures Codex transport and resolves the OAuth credential for every request", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const credentials = yield* Credential.Service
      const requests: { url: string; headers: Headers }[] = []
      const runtimeFetch: RuntimeFetch = async (input, init) => {
        requests.push({
          url: input instanceof Request ? input.url : input.toString(),
          headers: new Headers(init?.headers),
        })
        return new Response("ok")
      }
      yield* addPlugin(makeOpenAIPlugin({ runtimeFetch }))
      const stored = yield* credentials.create({
        integrationID: Integration.ID.make(ProviderV2.ID.openai),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "first-access",
          refresh: "refresh-token",
          expires: Date.now() + 60 * 60 * 1000,
          metadata: { accountID: "first-account" },
        }),
      })
      const configured = yield* aisdk.runOptions({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "@ai-sdk/openai" },
        }),
        package: "@ai-sdk/openai",
        options: { name: "openai" },
      })
      const result = yield* aisdk.runSDK(configured)
      expect(result.options.apiKey).toBe("opencode-oauth-dummy-key")
      expect(result.options.baseURL).toBe("https://chatgpt.com/backend-api/codex")

      const runtime = result.options.fetch as typeof fetch
      yield* Effect.promise(() =>
        runtime("https://api.openai.com/v1/responses", {
          headers: { Authorization: "Bearer opencode-oauth-dummy-key", "x-keep": "yes" },
        }),
      )
      yield* credentials.update(stored.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "second-access",
          refresh: "refresh-token",
          expires: Date.now() + 60 * 60 * 1000,
          metadata: { accountID: "second-account" },
        }),
      })
      yield* Effect.promise(() => runtime("https://api.openai.com/chat/completions"))

      expect(requests.map((request) => request.url)).toEqual([
        "https://chatgpt.com/backend-api/codex/responses",
        "https://chatgpt.com/backend-api/codex/responses",
      ])
      expect(requests[0].headers.get("authorization")).toBe("Bearer first-access")
      expect(requests[0].headers.get("ChatGPT-Account-Id")).toBe("first-account")
      expect(requests[0].headers.get("x-keep")).toBe("yes")
      expect(requests[1].headers.get("authorization")).toBe("Bearer second-access")
      expect(requests[1].headers.get("ChatGPT-Account-Id")).toBe("second-account")
    }),
  )

  it.effect("refreshes an expired OAuth credential when the Codex transport sends a request", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const methodID = Integration.MethodID.make("chatgpt-browser")
      let authorization = ""
      let refreshes = 0
      yield* addPlugin(
        makeOpenAIPlugin({
          runtimeFetch: async (_input, init) => {
            authorization = new Headers(init?.headers).get("authorization") ?? ""
            return new Response("ok")
          },
        }),
      )
      const stored = yield* credentials.create({
        integrationID: Integration.ID.make(ProviderV2.ID.openai),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "initial-access",
          refresh: "initial-refresh",
          expires: Date.now() + 60 * 60 * 1000,
        }),
      })
      const configured = yield* aisdk.runOptions({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "@ai-sdk/openai" },
        }),
        package: "@ai-sdk/openai",
        options: { name: "openai" },
      })
      const result = yield* aisdk.runSDK(configured)
      yield* integrations.transform((editor) =>
        editor.method.update({
          integrationID: Integration.ID.make(ProviderV2.ID.openai),
          method: { id: methodID, type: "oauth", label: "ChatGPT" },
          authorize: () => Effect.die("not used"),
          refresh: (value) => {
            refreshes++
            return Effect.succeed(
              Credential.OAuth.make({
                ...value,
                access: "refreshed-access",
                refresh: "refreshed-token",
                expires: Date.now() + 60 * 60 * 1000,
              }),
            )
          },
        }),
      )
      yield* credentials.update(stored.id, {
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "initial-access",
          refresh: "initial-refresh",
          expires: Date.now() - 1,
        }),
      })

      yield* Effect.promise(() => (result.options.fetch as typeof fetch)("https://api.openai.com/v1/responses"))

      expect(refreshes).toBe(1)
      expect(authorization).toBe("Bearer refreshed-access")
      expect((yield* credentials.get(stored.id))?.value).toMatchObject({
        type: "oauth",
        access: "refreshed-access",
        refresh: "refreshed-token",
      })
    }),
  )

  it.effect("turns Codex authentication responses into actionable errors", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const credentials = yield* Credential.Service
      let status = 401
      yield* addPlugin(
        makeOpenAIPlugin({
          runtimeFetch: async () => new Response("denied", { status }),
        }),
      )
      yield* credentials.create({
        integrationID: Integration.ID.make(ProviderV2.ID.openai),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60 * 60 * 1000,
        }),
      })
      const configured = yield* aisdk.runOptions({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5")),
          api: { id: ModelV2.ID.make("gpt-5"), type: "aisdk", package: "@ai-sdk/openai" },
        }),
        package: "@ai-sdk/openai",
        options: { name: "openai" },
      })
      const result = yield* aisdk.runSDK(configured)
      const runtime = result.options.fetch as typeof fetch

      yield* Effect.promise(async () => {
        await expect(runtime("https://api.openai.com/v1/responses")).rejects.toThrow(
          "ChatGPT authentication is invalid or expired",
        )
        status = 403
        await expect(runtime("https://api.openai.com/v1/responses")).rejects.toThrow(
          "ChatGPT rejected the Codex request (HTTP 403)",
        )
      })
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
