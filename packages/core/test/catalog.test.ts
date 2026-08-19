import { describe, expect } from "bun:test"
import type { MutableValue } from "@opencode-ai/plugin/v2/effect"
import type { Model, Provider } from "@opencode-ai/sdk/v2/types"
import { Effect, Fiber, Layer, Stream } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { Integration } from "@opencode-ai/core/integration"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { Policy } from "@opencode-ai/core/policy"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const catalogLayer = AppNodeBuilder.build(
  LayerNode.group([
    Catalog.node,
    CatalogSnapshot.node,
    EventV2.node,
    Credential.node,
    Integration.node,
    Policy.node,
    PluginRuntime.node,
  ]),
  [[Location.node, locationLayer]],
)
const it = testEffect(catalogLayer)

describe("CatalogV2", () => {
  it.effect("publishes an updated event after catalog changes", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const events = yield* EventV2.Service
      const updated = yield* events
        .subscribe(Catalog.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))

      expect((yield* Fiber.join(updated)).length).toBe(1)
    }),
  )

  it.effect("derives availability from active credentials without changing provider state", () => {
    const integrationID = Integration.ID.make("test")
    const localCatalogLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Catalog.node, Credential.node]), [[Location.node, locationLayer]]),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((editor) => editor.provider.update(ProviderV2.ID.make("test"), () => {}))
      yield* credentials.create({
        integrationID,
        label: "First",
        value: Credential.Key.make({ type: "key", key: "first", metadata: { tenant: "one" } }),
      })

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([ProviderV2.ID.make("test")])
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("test"))).request.body).toEqual({})
      yield* credentials.create({
        integrationID,
        label: "Second",
        value: Credential.Key.make({ type: "key", key: "second", metadata: { tenant: "two" } }),
      })
      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([ProviderV2.ID.make("test")])
      expect(required(yield* catalog.provider.get(ProviderV2.ID.make("test"))).request.body).toEqual({})
    }).pipe(Effect.provide(localCatalogLayer))
  })

  it.effect("builds one provider catalog snapshot with connection metadata and defaults", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const snapshot = yield* CatalogSnapshot.Service
      const providerID = ProviderV2.ID.make("snapshot")
      const integrationID = Integration.ID.make(providerID)
      const modelID = ModelV2.ID.make("model")

      yield* integrations.transform((editor) =>
        editor.method.update({ integrationID, method: { type: "key", label: "API key" } }),
      )
      yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })
      yield* catalog.transform((editor) => {
        editor.provider.update(providerID, (provider) => {
          provider.name = "Snapshot Provider"
        })
        editor.model.update(providerID, modelID, (model) => {
          model.name = "Snapshot Model"
        })
        editor.model.default.set(providerID, modelID)
      })

      expect(yield* snapshot.get()).toMatchObject({
        providers: [
          {
            info: { id: providerID, name: "Snapshot Provider" },
            source: "api",
            auth: "key",
            env: [],
          },
        ],
        connected: [providerID],
        default: { [providerID]: modelID },
      })
    }),
  )

  it.effect("derives availability from a provider's integration", () => {
    const integrationID = Integration.ID.make("gateway")
    const providerID = ProviderV2.ID.make("remote")
    const localCatalogLayer = Layer.fresh(
      AppNodeBuilder.build(LayerNode.group([Catalog.node, Credential.node, Integration.node]), [
        [Location.node, locationLayer],
      ]),
    )

    return Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* (yield* Integration.Service).transform((editor) => editor.update(integrationID, () => {}))
      yield* catalog.transform((editor) =>
        editor.provider.update(providerID, (provider) => {
          provider.integrationID = integrationID
        }),
      )
      expect(yield* catalog.provider.available()).toEqual([])

      yield* (yield* Credential.Service).create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toEqual([providerID])
    }).pipe(Effect.provide(localCatalogLayer))
  })

  it.effect("projects environment connections without a catalog plugin", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = process.env.CATALOG_TEST_API_KEY
        process.env.CATALOG_TEST_API_KEY = "secret"
        return previous
      }),
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          const providerID = ProviderV2.ID.make("test")
          yield* integrations.transform((editor) =>
            editor.method.update({
              integrationID: Integration.ID.make(providerID),
              method: { type: "env", names: ["CATALOG_TEST_API_KEY"] },
            }),
          )
          yield* catalog.transform((editor) => editor.provider.update(providerID, () => {}))

          expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(providerID)
        }),
      (previous) =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.CATALOG_TEST_API_KEY
          else process.env.CATALOG_TEST_API_KEY = previous
        }),
    ),
  )

  it.effect("normalizes provider baseURL into api url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) =>
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://default.example.com",
          }
          provider.request.body.baseURL = "https://override.example.com"
        }),
      )

      expect(required(yield* catalog.provider.get(providerID)).api).toEqual({
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
      })
    }),
  )

  it.effect("normalizes model baseURL into api url", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.api = {
            id: modelID,
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://model.example.com",
          }
          model.request.body.baseURL = "https://override.example.com"
        })
      })

      expect(required(yield* catalog.model.get(providerID, modelID)).api).toEqual({
        id: modelID,
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://override.example.com",
        settings: {},
      })
    }),
  )

  it.effect("resolves default model api from provider api", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
        })
        catalog.model.update(providerID, modelID, () => {})
      })

      expect(required(yield* catalog.model.get(providerID, modelID)).api).toEqual({
        id: modelID,
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://provider.example.com",
      })
    }),
  )

  it.effect("resolves provider and model request merges", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.request.headers.provider = "provider"
          provider.request.headers.shared = "provider"
          provider.request.body.provider = true
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.request.headers.model = "model"
          model.request.headers.shared = "model"
          model.request.body.model = true
          model.request.body.request = true
          model.request.body.shared = "model"
        })
      })

      const model = required(yield* catalog.model.get(providerID, modelID))
      expect(model.request.headers).toEqual({ provider: "provider", shared: "model", model: "model" })
      expect(model.request.body).toEqual({ provider: true, model: true, request: true, shared: "model" })
    }),
  )

  it.effect("falls back to newest available model when no default is configured", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("old"), (model) => {
          model.time.released = 1000
        })
        catalog.model.update(providerID, ModelV2.ID.make("new"), (model) => {
          model.time.released = 2000
        })
      })

      expect((yield* catalog.model.default())?.id).toMatch("new")
    }),
  )

  it.effect("uses a transform-provided default model until that transform is replaced", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const old = ModelV2.ID.make("old")
      const newest = ModelV2.ID.make("new")
      const models = (catalog: Catalog.Draft) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, old, (model) => {
          model.time.released = 1000
        })
        catalog.model.update(providerID, newest, (model) => {
          model.time.released = 2000
        })
      }

      let configured = true
      yield* catalog.transform((catalog) => {
        models(catalog)
        if (configured) catalog.model.default.set(providerID, old)
      })
      expect((yield* catalog.model.default())?.id).toBe(old)

      configured = false
      yield* catalog.reload()
      expect((yield* catalog.model.default())?.id).toBe(newest)
    }),
  )

  it.effect("ignores a configured default on a disabled provider", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const disabledProvider = ProviderV2.ID.make("disabled")
      const enabledProvider = ProviderV2.ID.make("enabled")
      const disabledModel = ModelV2.ID.make("configured")
      const fallbackModel = ModelV2.ID.make("fallback")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(disabledProvider, (provider) => {
          provider.disabled = true
        })
        catalog.model.update(disabledProvider, disabledModel, () => {})
        catalog.provider.update(enabledProvider, () => {})
        catalog.model.update(enabledProvider, fallbackModel, () => {})
        catalog.model.default.set(disabledProvider, disabledModel)
      })

      expect(yield* catalog.model.default()).toMatchObject({
        providerID: enabledProvider,
        id: fallbackModel,
      })
    }),
  )

  it.effect("small model prefers small keyword candidates before cost scoring", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("cheap-large"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 1, output: 1, cache: { read: 0, write: 0 } }]
          model.time.released = Date.now()
        })
        catalog.model.update(providerID, ModelV2.ID.make("expensive-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 10, output: 10, cache: { read: 0, write: 0 } }]
          model.time.released = Date.now()
        })
      })

      expect((yield* catalog.model.small(providerID))?.id).toMatch("expensive-mini")
    }),
  )

  it.effect("runs the compatibility small-model hook before native selection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const runtime = yield* PluginRuntime.Service
      const providerID = ProviderV2.ID.make("compat")
      const selectedID = ModelV2.ID.make("utility-large")
      let projected: Provider | undefined

      yield* runtime.hook<{
        readonly provider: Provider
        readonly model: MutableValue<Model | undefined>
      }>(PluginRuntime.HookName.providerSmallModel, (event) => {
        projected = event.provider
        event.model.set(event.provider.models[selectedID])
      })

      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.name = "Compatibility Provider"
          provider.api = {
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://provider.example.com",
          }
          provider.request.body.organization = "test"
        })
        catalog.model.update(providerID, selectedID, (model) => {
          model.api = {
            id: ModelV2.ID.make("openai/gpt-5"),
            type: "aisdk",
            package: "@ai-sdk/openai-compatible",
            url: "https://model.example.com",
          }
          model.capabilities = {
            tools: true,
            input: ["text", "image"],
            output: ["text"],
            temperature: true,
            reasoning: true,
            attachment: true,
            interleaved: { field: "reasoning_content" },
          }
          model.request.headers["x-model"] = "utility"
          model.request.body.modelOption = true
          model.variants = [
            {
              id: ModelV2.VariantID.make("high"),
              headers: {},
              body: { reasoning_effort: "high" },
            },
          ]
          model.time.released = Date.parse("2026-06-01")
          model.cost = [
            { input: 3, output: 4, cache: { read: 1, write: 2 } },
            {
              tier: { type: "context", size: 200_000 },
              input: 5,
              output: 6,
              cache: { read: 2, write: 3 },
            },
          ]
          model.limit = { context: 400_000, input: 300_000, output: 100_000 }
        })
        catalog.model.update(providerID, ModelV2.ID.make("native-mini"), (model) => {
          model.capabilities.input = ["text"]
          model.capabilities.output = ["text"]
          model.cost = [{ input: 1, output: 1, cache: { read: 0, write: 0 } }]
          model.time.released = Date.now()
        })
      })

      expect((yield* catalog.model.small(providerID))?.id).toBe(selectedID)
      expect(required(projected)).toMatchObject({
        id: providerID,
        name: "Compatibility Provider",
        source: "custom",
        env: [],
        options: { organization: "test" },
        models: {
          [selectedID]: {
            id: selectedID,
            providerID,
            api: {
              id: "openai/gpt-5",
              url: "https://model.example.com",
              npm: "@ai-sdk/openai-compatible",
            },
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: true,
              toolcall: true,
              input: { text: true, image: true },
              interleaved: { field: "reasoning_content" },
            },
            cost: {
              input: 3,
              output: 4,
              cache: { read: 1, write: 2 },
              experimentalOver200K: {
                input: 5,
                output: 6,
                cache: { read: 2, write: 3 },
              },
            },
            options: { organization: "test", modelOption: true },
            headers: { "x-model": "utility" },
            release_date: "2026-06-01",
            variants: { high: { reasoning_effort: "high" } },
          },
        },
      })
    }),
  )

  it.effect("removes providers denied by policy after loading", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const policy = yield* Policy.Service
      const providerID = ProviderV2.ID.make("blocked")
      yield* policy.load([new Policy.Info({ effect: "deny", action: "provider.use", resource: "blocked" })])
      yield* catalog.transform((catalog) => {
        catalog.provider.update(providerID, () => {})
        catalog.model.update(providerID, ModelV2.ID.make("model"), () => {})
      })

      expect(yield* catalog.provider.all()).toEqual([])
      expect(yield* catalog.model.all()).toEqual([])
      expect(yield* catalog.provider.get(providerID)).toBeUndefined()
    }),
  )
})
