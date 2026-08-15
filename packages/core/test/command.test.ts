import { describe, expect } from "bun:test"
import type { CommandRuntimeHookSpec } from "@opencode-ai/plugin/v2/effect"
import { Effect, Layer } from "effect"
import { CommandV2 } from "@opencode-ai/core/command"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "./lib/effect"

const runtime = PluginRuntime.make()
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([CommandV2.node, SkillV2.node]), [
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
            parts.map((part) => (part.type === "text" ? { ...part, text: `${part.text} [command]` } : part)),
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

  it.effect("exposes current skills as slash commands without overriding configured commands", () =>
    Effect.gen(function* () {
      const command = yield* CommandV2.Service
      const skill = yield* SkillV2.Service
      yield* command.transform((draft) =>
        draft.update("review", (item) => {
          item.template = "Configured review"
        }),
      )
      const registration = yield* skill.transform((draft) => {
        draft.source(
          SkillV2.EmbeddedSource.make({
            type: "embedded",
            skill: SkillV2.Info.make({
              name: "brainstorming",
              description: "Explore requirements before implementation",
              location: AbsolutePath.make("/plugins/superpowers/skills/brainstorming/SKILL.md"),
              content: "# Brainstorming\n\nExplore the idea.",
            }),
          }),
        )
        draft.source(
          SkillV2.EmbeddedSource.make({
            type: "embedded",
            skill: SkillV2.Info.make({
              name: "review",
              location: AbsolutePath.make("/plugins/superpowers/skills/review/SKILL.md"),
              content: "Skill review",
            }),
          }),
        )
        draft.source(
          SkillV2.EmbeddedSource.make({
            type: "embedded",
            skill: SkillV2.Info.make({
              name: "internal-only",
              slash: false,
              location: AbsolutePath.make("/plugins/superpowers/skills/internal-only/SKILL.md"),
              content: "Internal only",
            }),
          }),
        )
      })

      expect(yield* command.get("review")).toEqual(
        CommandV2.Info.make({ name: "review", template: "Configured review" }),
      )
      expect(yield* command.get("brainstorming")).toEqual(
        CommandV2.Info.make({
          name: "brainstorming",
          description: "Explore requirements before implementation",
          template: [
            "# Brainstorming\n\nExplore the idea.",
            "",
            "Base directory for this skill: /plugins/superpowers/skills/brainstorming",
            "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
          ].join("\n"),
        }),
      )
      expect((yield* command.list()).map((item) => item.name)).toEqual(["review", "brainstorming"])
      expect(yield* command.get("internal-only")).toBeUndefined()

      yield* registration.dispose
      expect(yield* command.get("brainstorming")).toBeUndefined()
      expect((yield* command.list()).map((item) => item.name)).toEqual(["review"])
    }),
  )
})
