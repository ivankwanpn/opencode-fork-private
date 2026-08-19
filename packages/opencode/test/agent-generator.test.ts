import { AgentGenerator } from "@/agent/generator"
import { Config } from "@/config/config"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { Plugin } from "@/plugin"
import { Project } from "@/project/project"
import { Provider } from "@/provider/provider"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap } from "effect"
import { MockLanguageModelV3, simulateReadableStream } from "ai/test"
import { it } from "./lib/effect"

const directory = "C:/workspace/agent-generator"
const workspaceID = WorkspaceV2.ID.make("wrk_workspace-test")
const providerID = ProviderV2.ID.make("test-provider")
const defaultModel = model(providerID, "default-model")
const explicitModel = model(providerID, "explicit-model")

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

const generated = {
  identifier: "generated-agent",
  whenToUse: "When the generated agent is needed",
  systemPrompt: "Act as the generated agent",
}

type Options = {
  readonly models?: readonly ModelV2.Info[]
  readonly defaultModel?: ModelV2.Info
  readonly providers?: readonly ProviderV2.Info[]
  readonly credential?: Credential.Value
  readonly agents?: readonly AgentV2.Info[]
  readonly transform?: string
}

function model(id: ProviderV2.ID, modelID: string) {
  const branded = ModelV2.ID.make(modelID)
  return ModelV2.Info.make({
    ...ModelV2.Info.empty(id, branded),
    api: {
      type: "aisdk",
      id: branded,
      package: "@ai-sdk/openai",
      settings: {},
    },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 128_000, output: 4_096 },
  })
}

function provider(id: ProviderV2.ID) {
  return ProviderV2.Info.make({
    ...ProviderV2.Info.empty(id),
    integrationID: Integration.ID.make(id),
    api: { type: "aisdk", package: "@ai-sdk/openai", settings: {} },
  })
}

function agent(id: string) {
  return AgentV2.Info.make({
    ...AgentV2.Info.empty(AgentV2.ID.make(id)),
    mode: "subagent",
  })
}

function makeLayer(options: Options = {}) {
  const refs: Location.Ref[] = []
  const selected: ModelV2.Info[] = []
  const language = new MockLanguageModelV3({
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(generated) }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    },
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: JSON.stringify(generated) },
          { type: "text-end", id: "text" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
        ],
      }),
    },
  })
  const models = [...(options.models ?? [defaultModel, explicitModel])]
  const providers = [...(options.providers ?? [provider(providerID)])]
  const connection = {
    type: "credential" as const,
    id: Credential.ID.make("credential-test"),
    label: "test",
  }
  const locations = Layer.effect(
    LocationServiceMap.Service,
    Effect.map(
      LayerMap.make(
        (ref: Location.Ref) => {
          refs.push(ref)
          return Layer.mergeAll(
            Layer.mock(Catalog.Service, {
              transform: () => Effect.succeed({ dispose: Effect.void }),
              reload: () => Effect.void,
              provider: {
                get: (id) => Effect.succeed(providers.find((item) => item.id === id)),
                all: () => Effect.succeed(providers),
                available: () => Effect.succeed(providers),
              },
              model: {
                get: (id, modelID) =>
                  Effect.succeed(models.find((item) => item.providerID === id && item.id === modelID)),
                all: () => Effect.succeed(models),
                available: () => Effect.succeed(models),
                default: () => Effect.succeed(options.defaultModel ?? models[0]),
                small: () => Effect.succeed(undefined),
              },
            }),
            Layer.succeed(AISDK.Service, AISDK.Service.of({
              hook: {
                options: () => Effect.succeed({ dispose: Effect.void }),
                sdk: () => Effect.succeed({ dispose: Effect.void }),
                language: () => Effect.succeed({ dispose: Effect.void }),
              },
              runOptions: (event) => Effect.succeed(event),
              runSDK: (event) => Effect.succeed(event),
              runLanguage: (event) => Effect.succeed(event),
              language: (item) =>
                Effect.sync(() => {
                  selected.push(item)
                  return language
                }),
            })),
            Layer.succeed(Integration.Service, Integration.Service.of({
              transform: () => Effect.succeed({ dispose: Effect.void }),
              reload: () => Effect.void,
              get: () => Effect.succeed(undefined),
              list: () => Effect.succeed([]),
              connection: {
                active: () => Effect.succeed(options.credential ? connection : undefined),
                resolve: () => Effect.succeed(options.credential),
                key: () => Effect.void,
                oauth: () => Effect.die("not implemented"),
                update: () => Effect.void,
                remove: () => Effect.void,
              },
              attempt: {
                status: () => Effect.die("not implemented"),
                complete: () => Effect.die("not implemented"),
                cancel: () => Effect.void,
                latest: () => Effect.succeed(undefined),
              },
            })),
            Layer.mock(AgentV2.Service, {
              all: () => Effect.succeed([...(options.agents ?? [])]),
            }),
          ) as unknown as Layer.Layer<LocationServices>
        },
        { idleTimeToLive: "1 minute" },
      ),
      LocationServiceMap.Service.of,
    ),
  )
  const trigger: Plugin.Interface["trigger"] = (_name, _input, output) =>
      Effect.sync(() => {
        const transformed = output as { system: string[] }
        if (options.transform) transformed.system.push(options.transform)
        return output
      })
  const plugin = Layer.succeed(Plugin.Service, Plugin.Service.of({
    trigger,
    list: () => Effect.succeed([]),
    entries: () => Effect.succeed([]),
    init: () => Effect.void,
  }))
  const layer = AppNodeBuilder.build(AgentGenerator.node, [
    [Config.node, Layer.mock(Config.Service, { get: () => Effect.succeed({}) })],
    [Plugin.node, plugin],
    [LocationServiceMap.node, locations],
  ])
  return { language, layer, refs, selected }
}

function run(layer: Layer.Layer<AgentGenerator.Service>, input: Parameters<AgentGenerator.Interface["generate"]>[0]) {
  return AgentGenerator.Service.use((service) => service.generate(input)).pipe(
    Effect.provide(layer),
    Effect.provideService(InstanceRef, {
      directory,
      worktree: directory,
      project: Project.Info.make({
        id: ProjectV2.ID.make("project-test"),
        worktree: directory,
        time: { created: 0, updated: 0 },
        sandboxes: [],
      }),
    }),
    Effect.provideService(WorkspaceRef, workspaceID),
  )
}

describe("agent generator V2 model runtime", () => {
  it.effect("uses the V2 default and keeps plugin transforms, existing IDs, and workspace location", () => {
    const setup = makeLayer({ agents: [agent("existing-one"), agent("existing-two")], transform: "plugin-system" })
    return Effect.gen(function* () {
      expect(yield* run(setup.layer, { description: "Generate one" })).toEqual(generated)
      expect(setup.selected).toEqual([defaultModel])
      expect(setup.refs).toEqual([Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID })])
      expect(setup.language.doGenerateCalls).toHaveLength(1)
      const prompt = setup.language.doGenerateCalls[0].prompt
      expect(prompt.some((message) => message.role === "system" && message.content === "plugin-system")).toBe(true)
      const user = prompt.find((message) => message.role === "user")
      expect(JSON.stringify(user)).toContain("existing-one, existing-two")
    })
  })

  it.effect("uses an explicitly requested available canonical model", () => {
    const setup = makeLayer()
    return Effect.gen(function* () {
      yield* run(setup.layer, {
        description: "Generate one",
        model: { providerID, modelID: explicitModel.id },
      })
      expect(setup.selected).toEqual([explicitModel])
    })
  })

  it.effect("rejects an explicitly requested unavailable model before AISDK initialization", () => {
    const setup = makeLayer()
    return Effect.gen(function* () {
      const error = yield* run(setup.layer, {
        description: "Generate one",
        model: { providerID, modelID: ModelV2.ID.make("missing-model") },
      }).pipe(Effect.flip)
      expect(Provider.ModelNotFoundError.isInstance(error)).toBe(true)
      if (!Provider.ModelNotFoundError.isInstance(error)) return
      expect(error.providerID).toBe(providerID)
      expect(error.suggestions).toEqual([defaultModel.id, explicitModel.id])
      expect(setup.selected).toEqual([])
    })
  })

  it.effect("passes transformed system instructions through OpenAI OAuth without a system message", () => {
    const openaiModel = model(ProviderV2.ID.openai, "gpt-test")
    const setup = makeLayer({
      models: [openaiModel],
      defaultModel: openaiModel,
      providers: [provider(ProviderV2.ID.openai)],
      credential: Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("oauth"),
        refresh: "refresh",
        access: "access",
        expires: Date.now() + 60_000,
      }),
      transform: "oauth-plugin-system",
    })
    return Effect.gen(function* () {
      expect(yield* run(setup.layer, { description: "Generate with OAuth" })).toEqual(generated)
      expect(setup.language.doGenerateCalls).toHaveLength(0)
      expect(setup.language.doStreamCalls).toHaveLength(1)
      const request = setup.language.doStreamCalls[0]
      expect(request.prompt.some((message) => message.role === "system")).toBe(false)
      expect(request.providerOptions?.openai).toMatchObject({
        instructions: expect.stringContaining("oauth-plugin-system"),
        store: false,
      })
    })
  })
})
