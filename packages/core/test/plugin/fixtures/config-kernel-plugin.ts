import { Effect } from "effect"
import { Plugin } from "@opencode-ai/schema/plugin"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"

export default {
  manifest: {
    id: Plugin.ID.make("configured-kernel"),
    version: "1.0.0",
    targets: ["core"],
    requires: [],
    capabilities: ["skill"],
    permissions: [],
    runtime: "trusted-in-process",
  },
  mount: () =>
    Effect.succeed({
      skills: [
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "configured-kernel-skill",
            description: "configured structured Kernel plugin fixture",
            location: AbsolutePath.make("/plugin/configured-kernel-skill.md"),
            content: "Configured Kernel skill.",
          }),
        }),
      ],
    }),
}
