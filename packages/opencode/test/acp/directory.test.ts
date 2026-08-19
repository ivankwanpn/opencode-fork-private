import { describe, expect } from "bun:test"
import { Directory } from "@/acp/directory"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { InstanceStore } from "@/project/instance-store"
import { CommandV2 } from "@opencode-ai/core/command"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Effect, Layer, LayerMap } from "effect"
import { it } from "../lib/effect"

const command = (name: string) => CommandV2.Info.make({ name, template: `run ${name}` })

const model = (providerID: ProviderV2.ID, id: string, variants?: Directory.ModelVariants): Provider.Model => ({
  id: ModelV2.ID.make(id),
  providerID,
  api: {
    id,
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  name: id,
  family: "test",
  capabilities: {
    temperature: true,
    reasoning: Boolean(variants),
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  },
  limit: {
    context: 128000,
    output: 4096,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
  ...(variants ? { variants } : {}),
})

const snapshot = (directory: string) => {
  const providerID = ProviderV2.ID.make(`provider-${directory}`)
  const modelID = ModelV2.ID.make(`model-${directory}`)
  const providers = {
    [providerID]: {
      id: providerID,
      name: `Provider ${directory}`,
      source: "config",
      env: [],
      options: {},
      models: {
        [modelID]: model(providerID, modelID, {
          low: { reasoningEffort: "low" },
          high: { reasoningEffort: "high" },
        }),
        [ModelV2.ID.make(`plain-${directory}`)]: model(providerID, `plain-${directory}`),
      },
    },
  } satisfies Record<ProviderV2.ID, Provider.Info>

  return Directory.build({
    directory,
    providers,
    modes: [
      { id: "build", name: `build-${directory}` },
      { id: "plan", name: `plan-${directory}`, description: "plan first" },
    ],
    defaultModeID: "build",
    commands: [command(`init-${directory}`), command(`review-${directory}`)],
    defaultModel: { providerID, modelID },
  })
}

const fakeLayer = (calls: string[]) =>
  LayerNode.compile(Directory.node, [
    [
      Directory.loaderNode,
      Layer.succeed(
        Directory.Loader,
        Directory.Loader.of({
          load: (directory) =>
            Effect.sync(() => {
              calls.push(directory)
              return snapshot(directory)
            }),
        }),
      ),
    ],
  ])

describe("ACP directory snapshot", () => {
  it.effect("loads sorted V2 commands from the directory location service map", () => {
    const loaded: Location.Ref[] = []
    const locationServices = Layer.effect(
      LocationServiceMap.Service,
      Effect.map(
        LayerMap.make(
          (ref: Location.Ref) => {
            loaded.push(ref)
            const agent = AgentV2.Info.make({
              id: AgentV2.defaultID,
              request: { headers: {}, body: {} },
              mode: "primary",
              hidden: false,
              permissions: [],
            })
            return Layer.mergeAll(
              Layer.mock(CommandV2.Service, {
                list: () => Effect.succeed([command("zeta"), command("alpha")]),
              }),
              Layer.mock(AgentV2.Service, {
                all: () => Effect.succeed([agent]),
                default: () => Effect.succeed(agent),
              }),
              Layer.mock(Catalog.Service, {
                transform: () => Effect.succeed({ dispose: Effect.void }),
                reload: () => Effect.void,
                provider: {
                  get: () => Effect.succeed(undefined),
                  all: () => Effect.succeed([]),
                  available: () => Effect.succeed([]),
                },
                model: {
                  get: () => Effect.succeed(undefined),
                  all: () => Effect.succeed([]),
                  available: () => Effect.succeed([]),
                  default: () => Effect.succeed(undefined),
                  small: () => Effect.succeed(undefined),
                },
              }),
              Layer.mock(CatalogSnapshot.Service, {
                get: () => Effect.succeed({ providers: [], models: [], connected: [], default: {} }),
              }),
            ) as unknown as Layer.Layer<LocationServices>
          },
          { idleTimeToLive: "1 minute" },
        ),
        LocationServiceMap.Service.of,
      ),
    )
    const dependencies = Layer.mergeAll(
      Layer.mock(InstanceStore.Service, {
        load: ({ directory }) =>
          Effect.succeed({
            directory,
            worktree: directory,
            project: {
              id: ProjectV2.ID.make("project"),
              worktree: directory,
              time: { created: 0, updated: 0 },
              sandboxes: [],
            },
          }),
      }),
      locationServices,
    )

    return Effect.gen(function* () {
      const loader = yield* Directory.Loader
      const result = yield* loader.load("/workspace/project")

      expect(result.availableCommands.map((item) => item.name)).toEqual(["alpha", "zeta"])
      expect(loaded).toEqual([Location.Ref.make({ directory: AbsolutePath.make("/workspace/project") })])
    }).pipe(Effect.provide(Directory.loaderLayer.pipe(Layer.provide(dependencies))))
  })

  it.effect("two concurrent callers share one load", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const directory = yield* Directory.Service
      const [first, second] = yield* Effect.all([directory.get("alpha"), directory.get("alpha")], {
        concurrency: "unbounded",
      })

      expect(calls).toEqual(["alpha"])
      expect(first).toBe(second)
    }).pipe(Effect.provide(fakeLayer(calls)))
  })

  it.effect("warm calls use cached data", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const directory = yield* Directory.Service
      const first = yield* directory.get("alpha")
      const second = yield* directory.get("alpha")

      expect(calls).toEqual(["alpha"])
      expect(first).toBe(second)
    }).pipe(Effect.provide(fakeLayer(calls)))
  })

  it.effect("different directories get different snapshots", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const directory = yield* Directory.Service
      const [alpha, beta] = yield* Effect.all([directory.get("alpha"), directory.get("beta")], {
        concurrency: "unbounded",
      })

      expect(calls.toSorted()).toEqual(["alpha", "beta"])
      expect(alpha.directory).toBe("alpha")
      expect(beta.directory).toBe("beta")
      expect(alpha.defaultModel?.providerID).not.toBe(beta.defaultModel?.providerID)
    }).pipe(Effect.provide(fakeLayer(calls)))
  })

  it.effect("model variant lookup works", () =>
    Effect.gen(function* () {
      const directory = yield* Directory.Service
      const alpha = yield* directory.get("alpha")
      const model = alpha.defaultModel!

      expect(directory.variants(alpha, model)).toEqual({
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
      })
      expect(directory.variants(alpha, { ...model, modelID: ModelV2.ID.make("missing") })).toBeUndefined()
    }).pipe(Effect.provide(fakeLayer([]))),
  )

  it.effect("commands and modes are included", () =>
    Effect.gen(function* () {
      const directory = yield* Directory.Service
      const alpha = yield* directory.get("alpha")

      expect(alpha.availableCommands.map((item) => item.name)).toEqual(["init-alpha", "review-alpha"])
      expect(alpha.availableModes).toEqual([
        { id: "build", name: "build-alpha" },
        { id: "plan", name: "plan-alpha", description: "plan first" },
      ])
      expect(alpha.defaultModeID).toBe("build")
    }).pipe(Effect.provide(fakeLayer([]))),
  )

  it.effect("falls back when the default mode is not available", () =>
    Effect.sync(() => {
      expect(
        Directory.build({
          directory: "alpha",
          providers: {},
          modes: [
            { id: "build", name: "Build" },
            { id: "plan", name: "Plan" },
          ],
          defaultModeID: "hidden",
          commands: [],
        }).defaultModeID,
      ).toBe("build")
    }),
  )
})
