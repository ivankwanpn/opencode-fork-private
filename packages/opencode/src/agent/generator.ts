import { OtelTracer } from "@effect/opentelemetry/Tracer"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV1Projection } from "@opencode-ai/core/plugin/v1-projection"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { type ModelMessage, generateObject, streamObject } from "ai"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { Provider } from "@/compat/provider-wire"
import { ProviderTransform } from "@/provider/transform"
import PROMPT_GENERATE from "./generate.txt"

const GeneratedAgent = Schema.Struct({
  identifier: Schema.String,
  whenToUse: Schema.String,
  systemPrompt: Schema.String,
})

export interface Interface {
  readonly generate: (input: {
    description: string
    model?: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
  }) => Effect.Effect<
    {
      identifier: string
      whenToUse: string
      systemPrompt: string
    },
    Provider.Error
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentGenerator") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const locations = yield* LocationServiceMap.Service

    return Service.of({
      generate: Effect.fn("AgentGenerator.generate")(function* (input) {
        const ctx = yield* InstanceState.context
        const workspaceID = yield* InstanceState.workspaceID
        const location = locations.get(
          Location.Ref.make({
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID === undefined ? {} : { workspaceID }),
          }),
        )
        const [catalog, aisdk, integration, agents] = yield* Effect.all([
          Catalog.Service,
          AISDK.Service,
          Integration.Service,
          AgentV2.Service,
        ]).pipe(Effect.provide(location))

        const cfg = yield* config.get()
        const available = yield* catalog.model.available()
        const canonical = input.model
          ? available.find((model) => model.providerID === input.model?.providerID && model.id === input.model.modelID)
          : yield* catalog.model.default()
        if (!canonical && input.model) {
          return yield* new Provider.ModelNotFoundError({
            providerID: input.model.providerID,
            modelID: input.model.modelID,
            suggestions: available
              .filter((model) => model.providerID === input.model?.providerID)
              .map((model) => model.id)
              .slice(0, 3),
          })
        }
        if (!canonical) {
          const providers = yield* catalog.provider.available()
          const provider = providers[0]
          if (!provider) return yield* new Provider.NoProvidersError()
          return yield* new Provider.NoModelsError({ providerID: provider.id })
        }
        const language = yield* aisdk.language(canonical).pipe(
          Effect.mapError((error) => new Provider.InitError({ providerID: error.providerID, cause: error.cause })),
        )
        const tracer = cfg.experimental?.openTelemetry
          ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer))
          : undefined

        const system = [PROMPT_GENERATE]
        const projected = PluginV1Projection.model(canonical)
        const model: Provider.Model = {
          ...projected,
          id: ModelV2.ID.make(projected.id),
          providerID: ProviderV2.ID.make(projected.providerID),
        }
        yield* plugin.trigger("experimental.chat.system.transform", { model }, { system })
        const existing = yield* agents.all()

        // OpenAI OAuth carries the system prompt through provider instructions.
        const provider = yield* catalog.provider.get(canonical.providerID)
        const connection =
          canonical.providerID === ProviderV2.ID.openai
            ? yield* integration.connection.active(provider?.integrationID ?? Integration.ID.make(canonical.providerID))
            : undefined
        const credential = connection ? yield* integration.connection.resolve(connection).pipe(Effect.orDie) : undefined
        const isOpenaiOauth = canonical.providerID === ProviderV2.ID.openai && credential?.type === "oauth"
        const params = {
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            tracer,
            metadata: {
              userId: cfg.username ?? "unknown",
            },
          },
          temperature: 0.3,
          messages: [
            ...(isOpenaiOauth
              ? []
              : system.map(
                  (item): ModelMessage => ({
                    role: "system",
                    content: item,
                  }),
                )),
            {
              role: "user",
              content: `Create an agent configuration based on this request: "${input.description}".\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existing.map((agent) => agent.id).join(", ")}\n  Return ONLY the JSON object, no other text, do not wrap in backticks`,
            },
          ],
          model: language,
          schema: Object.assign(
            Schema.toStandardSchemaV1(GeneratedAgent),
            Schema.toStandardJSONSchemaV1(GeneratedAgent),
          ),
        } satisfies Parameters<typeof generateObject>[0]

        if (isOpenaiOauth) {
          return yield* Effect.promise(async () => {
            const result = streamObject({
              ...params,
              providerOptions: ProviderTransform.providerOptions(model, {
                instructions: system.join("\n"),
                store: false,
              }),
              onError: () => {},
            })
            for await (const part of result.fullStream) {
              if (part.type === "error") throw part.error
            }
            return result.object
          })
        }

        return yield* Effect.promise(() => generateObject(params).then((result) => result.object))
      }),
    })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Plugin.node, LocationServiceMap.node],
})

export * as AgentGenerator from "./generator"
