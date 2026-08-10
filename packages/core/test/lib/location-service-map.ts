import type { LocationServices } from "@opencode-ai/core/location-services"
import { AgentV2 } from "@opencode-ai/core/agent"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { Layer, LayerMap, Effect } from "effect"

export const pluginLocationMap = (
  runtime: PluginRuntime.Interface = PluginRuntime.make(),
  attachment: SessionAttachment.Interface = {
    materializeFile: (file) => Effect.succeed(file),
    materialize: (prompt) => Effect.succeed(prompt),
  },
  materializeAgents: SessionPromptExpansion.Interface["materializeAgents"] = (prompt) => Effect.succeed(prompt),
) => {
  const expansion = SessionPromptExpansion.Service.of({
    resolve: (prompt) =>
      Effect.succeed(
        prompt.text.includes("@research")
          ? { ...prompt, agents: [...(prompt.agents ?? []), { name: "research" }] }
          : prompt,
      ),
    materializeAgents,
    command: (input) =>
      input.command === "missing"
        ? Effect.fail(
            new SessionPromptExpansion.CommandNotFoundError({
              command: input.command,
              available: ["review"],
            }),
          )
        : Effect.succeed({
            prompt: Prompt.make({ text: `Expanded /${input.command}: ${input.arguments}` }),
            agent:
              input.command === "switch"
                ? AgentV2.ID.make("review")
                : (input.agent ?? input.session.agent ?? AgentV2.defaultID),
            model:
              input.command === "switch"
                ? {
                    providerID: ProviderV2.ID.make("command-provider"),
                    id: ModelV2.ID.make("command-model"),
                  }
                : (input.model ?? input.session.model),
            subtask: false,
          }),
  })
  const services = Layer.mergeAll(
    Layer.succeed(PluginRuntime.Service, runtime),
    Layer.succeed(SessionAttachment.Service, SessionAttachment.Service.of(attachment)),
    Layer.succeed(SessionPromptExpansion.Service, expansion),
  )
  const layer = Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make(() => services as unknown as Layer.Layer<LocationServices>, { idleTimeToLive: "1 minute" }),
  )
  return {
    runtime,
    replacement: [LocationServiceMap.node, layer] as const,
  }
}
