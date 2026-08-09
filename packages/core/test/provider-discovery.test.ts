import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { ProviderModelDiscovery } from "@opencode-ai/core/provider-discovery"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Policy } from "@opencode-ai/core/policy"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const providerID = ProviderV2.ID.make("provider-a")
const configuredID = ModelV2.ID.make("configured")

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("provider-discovery") })),
)
const catalogLayer = AppNodeBuilder.build(
  LayerNode.group([
    Catalog.node,
    Credential.node,
    EventV2.node,
    Integration.node,
    PluginRuntime.node,
    Policy.node,
  ]),
  [[Location.node, locationLayer]],
)
let inFlight = 0
let maxInFlight = 0
const discoveryLayer = ProviderModelDiscovery.makeLayer({
  fetch: async () => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await Promise.resolve()
    inFlight--
    return Response.json({ data: [{ id: "compatible-model" }] })
  },
}).pipe(Layer.provideMerge(catalogLayer))
const it = testEffect(discoveryLayer)

function catalogModelIDs() {
  return Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    return (yield* catalog.model.all())
      .filter((model) => model.providerID === providerID)
      .map((model) => model.id)
      .toSorted()
  })
}

function expectFailure<A>(effect: Effect.Effect<A, ProviderModelDiscovery.Failure>, kind: ProviderModelDiscovery.FailureKind) {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    expect(Exit.isFailure(exit)).toBe(true)
    if (!Exit.isFailure(exit)) return
    expect(Cause.squash(exit.cause)).toMatchObject({ kind })
  })
}

const configure = Effect.fn(function* () {
  const catalog = yield* Catalog.Service
  inFlight = 0
  maxInFlight = 0
  yield* catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.api = {
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://provider.example.com/v1",
      }
      provider.request.headers["x-provider"] = "configured"
      provider.request.body.apiKey = "test-key"
      provider.request.body.modelListURL = "https://provider.example.com/models"
    })
    draft.model.update(providerID, configuredID, (model) => {
      model.name = "Configured model"
      model.capabilities = { tools: true, input: ["text", "image"], output: ["text"], reasoning: true }
      model.cost = [{ input: 1, output: 2, cache: { read: 3, write: 4 } }]
      model.variants = [{ id: ModelV2.VariantID.make("high"), headers: { "x-variant": "high" }, body: { effort: "high" } }]
      model.request.headers["x-model"] = "configured"
      model.request.body.temperature = 0.7
      model.limit = { context: 123_456, input: 100_000, output: 10_000 }
    })
  })
})

describe("ProviderModelDiscovery", () => {
  it.effect("selects a registered strategy before the compatible fallback", () =>
    Effect.gen(function* () {
      yield* configure()
      const discovery = yield* ProviderModelDiscovery.Service
      yield* discovery.register(providerID, () =>
        Effect.succeed({ source: "provider", sourceKey: "dedicated", models: [{ id: "dedicated-model" }] }),
      )

      const result = yield* discovery.discover(providerID)
      expect(result.source).toBe("provider")
      expect(result.models.map((item) => item.id)).toEqual(["dedicated-model"])
      expect(inFlight).toBe(0)
    }),
  )

  it.effect("preserves configured model fields when compatible discovery adds a model", () =>
    Effect.gen(function* () {
      yield* configure()
      const discovery = yield* ProviderModelDiscovery.Service
      yield* discovery.discover(providerID)
      const catalog = yield* Catalog.Service

      expect(yield* catalog.model.get(providerID, configuredID)).toMatchObject({
        name: "Configured model",
        capabilities: { tools: true, reasoning: true },
        cost: [{ input: 1, output: 2, cache: { read: 3, write: 4 } }],
        variants: [{ id: "high", headers: { "x-variant": "high" }, body: { effort: "high" } }],
        request: { headers: { "x-provider": "configured", "x-model": "configured" }, body: { temperature: 0.7 } },
        limit: { context: 123_456, input: 100_000, output: 10_000 },
      })
      expect(yield* catalogModelIDs()).toEqual(["compatible-model", "configured"].map((id) => ModelV2.ID.make(id)))
    }),
  )

  it.effect("uses an OAuth access credential for compatible discovery", () =>
    Effect.gen(function* () {
      yield* configure()
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("test-oauth"),
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60_000,
        }),
      })
      const discovery = yield* ProviderModelDiscovery.Service

      expect((yield* discovery.discover(providerID)).source).toBe("oauth")
    }),
  )

  it.effect("retains the current catalog after a rejected discovery", () =>
    Effect.gen(function* () {
      yield* configure()
      const discovery = yield* ProviderModelDiscovery.Service
      const before = yield* catalogModelIDs()
      yield* discovery.register(providerID, () => Effect.fail(new ProviderModelDiscovery.Failure({ providerID, kind: "network" })))
      yield* expectFailure(discovery.discover(providerID), "network")
      expect(yield* catalogModelIDs()).toEqual(before)
    }),
  )

  it.effect("serializes same-provider requests", () =>
    Effect.gen(function* () {
      yield* configure()
      const discovery = yield* ProviderModelDiscovery.Service
      yield* Effect.all([discovery.discover(providerID), discovery.discover(providerID)], { concurrency: "unbounded" })
      expect(inFlight).toBe(0)
      expect(maxInFlight).toBe(1)
    }),
  )
})
