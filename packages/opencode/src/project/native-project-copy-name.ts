import { ProjectCopyNameCapability } from "@opencode-ai/server/project-copy-name-capability"
import { type LegacyAgentInfo } from "@/compat/agent-wire"
import { InstanceState } from "@/effect/instance-state"
import { LLM } from "@/session/llm"
import { Catalog } from "@opencode-ai/core/catalog"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV1Projection } from "@opencode-ai/core/plugin/v1-projection"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { MessageID, SessionID } from "@/session/schema"
import { Slug } from "@opencode-ai/core/util/slug"
import { LLMEvent } from "@opencode-ai/llm"
import { Effect, Layer, Stream } from "effect"

const agent: LegacyAgentInfo = {
  name: "project-copy-name",
  mode: "primary",
  permission: [],
  options: {},
  native: true,
  prompt: "",
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

export const layer = Layer.effect(
  ProjectCopyNameCapability.Service,
  Effect.gen(function* () {
    const llm = yield* LLM.Service
    const locations = yield* LocationServiceMap.Service
    return ProjectCopyNameCapability.Service.of({
      generate: (context) =>
        Effect.gen(function* () {
          const text = context?.trim()
          if (!text) return Slug.create()
          const ctx = yield* InstanceState.context
          const workspaceID = yield* InstanceState.workspaceID
          const catalog = yield* Catalog.Service.pipe(
            Effect.provide(
              locations.get(
                Location.Ref.make({
                  directory: AbsolutePath.make(ctx.directory),
                  ...(workspaceID === undefined ? {} : { workspaceID }),
                }),
              ),
            ),
          )
          const fallback = yield* catalog.model.default()
          if (!fallback) return Slug.create()
          const projected = PluginV1Projection.model((yield* catalog.model.small(fallback.providerID)) ?? fallback)
          const model = {
            ...projected,
            id: ModelV2.ID.make(projected.id),
            providerID: ProviderV2.ID.make(projected.providerID),
          }
          const sessionID = SessionID.descending()
          const result = yield* llm
            .stream({
              agent,
              user: {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: agent.name,
                model: { providerID: model.providerID, modelID: model.id },
              },
              system: [],
              small: true,
              tools: {},
              model,
              sessionID,
              retries: 2,
              messages: [{ role: "user", content: `Generate a short 2-3 word name that describes this task:\n${text}` }],
            })
            .pipe(
              Stream.filter(LLMEvent.is.textDelta),
              Stream.map((event) => event.text),
              Stream.mkString,
            )
          const output = result.trim()
          return output ? slugify(output.split(/\s+/).slice(0, 3).join(" ")) : Slug.create()
        }).pipe(Effect.catch(() => Effect.sync(() => Slug.create()))),
    })
  }),
)

export * as NativeProjectCopyName from "./native-project-copy-name"
