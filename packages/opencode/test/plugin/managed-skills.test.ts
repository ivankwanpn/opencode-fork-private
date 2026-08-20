import { expect, test } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { Effect } from "effect"
import { registerManagedSkills } from "@/plugin"

test("registers enabled marketplace skill directories directly in SkillV2", async () => {
  const directory = AbsolutePath.make("C:/plugins/superpowers/skills")
  const sources = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        yield* registerManagedSkills([
          {
            id: "superpowers@official",
            enabled: true,
            capabilities: ["skills"],
            skillDirectory: directory,
            commandNames: [],
            mcpServers: [],
            toolSourceIDs: [],
          },
          {
            id: "disabled@official",
            enabled: false,
            capabilities: ["skills"],
            skillDirectory: AbsolutePath.make("C:/plugins/disabled/skills"),
            commandNames: [],
            mcpServers: [],
            toolSourceIDs: [],
          },
        ])
        return yield* (yield* SkillV2.Service).sources()
      }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([SkillV2.node])))),
    ),
  )

  expect(sources).toEqual([SkillV2.DirectorySource.make({ type: "directory", path: directory })])
})
