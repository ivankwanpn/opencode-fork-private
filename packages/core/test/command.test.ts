import { describe, expect } from "bun:test"
import type { CommandRuntimeHookSpec } from "@opencode-ai/plugin/v2/effect"
import { Effect, Layer } from "effect"
import { CommandV2 } from "@opencode-ai/core/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { testEffect } from "./lib/effect"

const runtime = PluginRuntime.make()
const it = testEffect(
  AppNodeBuilder.build(CommandV2.node, [
    [PluginRuntime.node, Layer.succeed(PluginRuntime.Service, runtime)],
  ]),
)

describe("CommandV2", () => {
  it.effect("applies command transforms and preserves later overrides", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      yield* command.transform((editor) => {
        editor.update("review", (command) => {
          command.template = "First"
          command.description = "Review code"
        })
        editor.update("review", (command) => {
          command.template = "Second"
          command.model = {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          }
        })
      })

      expect(yield* command.get("review")).toEqual(
        CommandV2.Info.make({
          name: "review",
          template: "Second",
          description: "Review code",
          model: {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          },
        }),
      )
      expect(yield* command.list()).toEqual([
        CommandV2.Info.make({
          name: "review",
          template: "Second",
          description: "Review code",
          model: {
            id: ModelV2.ID.make("claude"),
            providerID: ProviderV2.ID.make("anthropic"),
            variant: ModelV2.VariantID.make("high"),
          },
        }),
      ])
    }),
  )

  it.effect("runs command hooks over resolved parts", () =>
    Effect.gen(function* () {
      yield* runtime.hook<CommandRuntimeHookSpec["execute.before"]>(
        PluginRuntime.HookName.commandExecuteBefore,
        (event) =>
          event.parts.update((parts) =>
            parts.map((part) =>
              part.type === "text" ? { ...part, text: `${part.text} [command]` } : part,
            ),
          ),
      )
      const command = yield* CommandV2.Service
      const parts = yield* command.beforeExecute({
        command: "review",
        sessionID: "ses_command",
        arguments: "src",
        parts: [
          {
            id: "prt_command",
            sessionID: "ses_command",
            messageID: "msg_command",
            type: "text",
            text: "Review src",
          },
        ],
      })

      expect(parts).toMatchObject([{ type: "text", text: "Review src [command]" }])
    }),
  )
})
