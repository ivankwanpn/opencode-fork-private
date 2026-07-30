import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (config: Config.Interface) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provideService(Config.Service, config))
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

function request(headers: Record<string, string>, variant?: string) {
  return {
    headers,
    variant,
  }
}

const decode = Schema.decodeUnknownSync(Config.Info)

describe("ConfigProviderPlugin.Plugin", () => {
  it.effect("keeps configured model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.opencode
      const modelID = ModelV2.ID.make("alpha-gpt-next")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  opencode: {
                    api: { type: "aisdk", package: "@ai-sdk/openai", url: "https://opencode.test/v1" },
                    models: {
                      "alpha-gpt-next": {
                        variants: [
                          {
                            id: "high",
                            body: {
                              reasoningEffort: "high",
                              reasoningSummary: "auto",
                              include: ["reasoning.encrypted_content"],
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              }),
            }),
          ]),
      })

      yield* addPlugin(config)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.variants).toMatchObject([
        {
          id: "high",
          body: {
            reasoningEffort: "high",
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        },
      ])
    }),
  )

  it.effect("keeps layered model variant bodies unchanged", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.opencode
      const modelID = ModelV2.ID.make("alpha-gpt-next")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  opencode: {
                    api: { type: "aisdk", package: "@ai-sdk/openai", url: "https://opencode.test/v1" },
                  },
                },
              }),
            }),
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  opencode: {
                    models: {
                      "alpha-gpt-next": {
                        variants: [{ id: "high", body: { reasoningEffort: "high" } }],
                      },
                    },
                  },
                },
              }),
            }),
          ]),
      })

      yield* addPlugin(config)

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.variants[0]).toMatchObject({
        id: "high",
        body: { reasoningEffort: "high" },
      })
    }),
  )

  it.effect("injects a stored key for a configured provider without env credentials", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const providerID = ProviderV2.ID.make("custom-provider")
      const modelID = ModelV2.ID.make("chat")
      const integrationID = Integration.ID.make("custom-provider")
      const credential = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "native-secret" }),
      })
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  "custom-provider": {
                    api: {
                      type: "aisdk",
                      package: "@ai-sdk/openai-compatible",
                      url: "https://api.example.com/v1",
                    },
                    models: { chat: {} },
                  },
                },
              }),
            }),
          ]),
      })

      yield* addPlugin(config)

      const observed: Record<string, unknown>[] = []
      yield* aisdk.hook.sdk((event) =>
        Effect.sync(() => {
          observed.push({ ...event.options })
          event.sdk = { languageModel: () => ({}) }
        }),
      )
      yield* aisdk.language(required(yield* catalog.model.get(providerID, modelID)))

      const integration = required(yield* integrations.get(integrationID))
      expect(integration.methods).toContainEqual({ type: "key", label: "API key" })
      expect(integration.connections).toEqual([{ type: "credential", id: credential.id, label: "default" }])
      expect(observed).toHaveLength(1)
      expect(observed[0]).toMatchObject({
        name: "custom-provider",
        baseURL: "https://api.example.com/v1",
        apiKey: "native-secret",
      })
    }),
  )

  it.effect("keeps configured settings and body apiKey values over stored credentials", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const settingsProviderID = ProviderV2.ID.make("settings-provider")
      const bodyProviderID = ProviderV2.ID.make("body-provider")
      const modelID = ModelV2.ID.make("chat")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  "settings-provider": {
                    api: {
                      type: "aisdk",
                      package: "@ai-sdk/openai-compatible",
                      settings: { apiKey: "settings-secret" },
                    },
                    models: { chat: {} },
                  },
                  "body-provider": {
                    api: { type: "aisdk", package: "@ai-sdk/openai-compatible" },
                    request: { body: { apiKey: "body-secret" } },
                    models: { chat: {} },
                  },
                },
              }),
            }),
          ]),
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("settings-provider"),
        value: Credential.Key.make({ type: "key", key: "stored-settings-secret" }),
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("body-provider"),
        value: Credential.Key.make({ type: "key", key: "stored-body-secret" }),
      })

      yield* addPlugin(config)

      const observed = new Map<string, unknown>()
      yield* aisdk.hook.sdk((event) =>
        Effect.sync(() => {
          observed.set(event.model.providerID, event.options.apiKey)
          event.sdk = { languageModel: () => ({}) }
        }),
      )
      yield* aisdk.language(required(yield* catalog.model.get(settingsProviderID, modelID)))
      yield* aisdk.language(required(yield* catalog.model.get(bodyProviderID, modelID)))

      expect(observed.get(settingsProviderID)).toBe("settings-secret")
      expect(observed.get(bodyProviderID)).toBe("body-secret")
      expect((yield* integrations.get(Integration.ID.make("settings-provider")))?.connections).toHaveLength(1)
      expect((yield* integrations.get(Integration.ID.make("body-provider")))?.connections).toHaveLength(1)
    }),
  )

  it.effect("keeps an empty configured apiKey over a stored credential", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const providerID = ProviderV2.ID.make("empty-key-provider")
      const modelID = ModelV2.ID.make("chat")
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([
            new Config.Document({
              type: "document",
              info: decode({
                providers: {
                  "empty-key-provider": {
                    api: {
                      type: "aisdk",
                      package: "@ai-sdk/openai-compatible",
                      settings: { apiKey: "" },
                    },
                    models: { chat: {} },
                  },
                },
              }),
            }),
          ]),
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("empty-key-provider"),
        value: Credential.Key.make({ type: "key", key: "stored-secret" }),
      })

      yield* addPlugin(config)

      const observed: unknown[] = []
      yield* aisdk.hook.sdk((event) =>
        Effect.sync(() => {
          observed.push(event.options.apiKey)
          event.sdk = { languageModel: () => ({}) }
        }),
      )
      yield* aisdk.language(required(yield* catalog.model.get(providerID, modelID)))

      expect(observed).toEqual([""])
    }),
  )

  it.effect("loads configured providers and applies later model overrides", () =>
    withEnv({ CUSTOM_API_KEY: "secret" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        const integrations = yield* Integration.Service
        const providerID = ProviderV2.ID.make("custom")
        const modelID = ModelV2.ID.make("chat")
        const config = Config.Service.of({
          entries: () =>
            Effect.succeed([
              new Config.Document({
                type: "document",
                info: decode({
                  model: "custom/first",
                  providers: {
                    custom: {
                      name: "Configured",
                      env: ["CUSTOM_API_KEY"],
                      api: { type: "native", settings: {} },
                      request: request({ first: "first", shared: "first" }),
                      models: {
                        chat: {
                          name: "First",
                          capabilities: { tools: true, input: ["text"], output: ["text"] },
                          disabled: true,
                          limit: { context: 100, output: 50 },
                          cost: { input: 1, output: 2 },
                          request: request({ first: "first", shared: "first" }, "retained"),
                          variants: [
                            {
                              id: "fast",
                              headers: { first: "first", shared: "first" },
                            },
                          ],
                        },
                      },
                    },
                  },
                }),
              }),
              new Config.Document({
                type: "document",
                info: decode({
                  model: "custom/default",
                  providers: {
                    custom: {
                      api: { type: "aisdk", package: "custom-sdk", url: "https://example.test" },
                      request: request({ last: "last", shared: "last" }),
                      models: {
                        default: {
                          name: "Default",
                        },
                        chat: {
                          api: { id: "api-chat" },
                          name: "Last",
                          limit: { output: 75 },
                          request: request({ last: "last", shared: "last" }),
                          variants: [
                            {
                              id: "fast",
                              headers: { last: "last", shared: "last" },
                            },
                            {
                              id: "slow",
                              headers: { slow: "slow" },
                            },
                          ],
                        },
                      },
                    },
                  },
                }),
              }),
              new Config.Document({
                type: "document",
                info: decode({
                  providers: {
                    custom: { name: "Renamed" },
                  },
                }),
              }),
            ]),
        })

        yield* addPlugin(config)

        const provider = required(yield* catalog.provider.get(providerID))
        const model = required(yield* catalog.model.get(providerID, modelID))
        expect((yield* catalog.model.default())?.id).toBe(ModelV2.ID.make("default"))
        expect(provider.name).toBe("Renamed")
        expect((yield* integrations.get(Integration.ID.make("custom")))?.methods).toContainEqual({
          type: "env",
          names: ["CUSTOM_API_KEY"],
        })
        expect((yield* integrations.get(Integration.ID.make("custom")))?.name).toBe("Renamed")
        expect(provider.disabled).toBeUndefined()
        expect(provider.api).toEqual({ type: "aisdk", package: "custom-sdk", url: "https://example.test" })
        expect(provider.request.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.api.id).toBe(ModelV2.ID.make("api-chat"))
        expect(model.name).toBe("Last")
        expect(model.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
        expect(model.enabled).toBe(false)
        expect(model.limit).toEqual({ context: 100, output: 75 })
        expect(model.cost).toEqual([{ input: 1, output: 2, cache: { read: 0, write: 0 }, tier: undefined }])
        expect(model.request.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.request.variant).toBe("retained")
        expect(model.variants.map((variant) => variant.id)).toEqual([
          ModelV2.VariantID.make("fast"),
          ModelV2.VariantID.make("slow"),
        ])
        expect(model.variants[0]?.headers).toEqual({ first: "first", shared: "last", last: "last" })
        expect(model.variants[1]?.headers).toEqual({ slow: "slow" })
      }),
    ),
  )
})
