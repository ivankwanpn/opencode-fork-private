export * as SessionSkill from "./skill"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { SkillV2 } from "../skill"
import { SessionSchema } from "./schema"

export type ResolveInput = {
  readonly session: SessionSchema.Info
  readonly name: string
}

export type ResolveResult = {
  readonly available: ReadonlyArray<string>
  readonly text?: string
}

export interface Interface {
  readonly resolve: (input: ResolveInput) => Effect.Effect<ResolveResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionSkill") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* AgentV2.Service
    const skills = yield* SkillV2.Service
    const fs = yield* FSUtil.Service

    return Service.of({
      resolve: Effect.fn("SessionSkill.resolve")(function* (input) {
        const selection = yield* agents.select(input.session.agent)
        const permitted = selection.info ? SkillV2.available(yield* skills.list(), selection.info) : []
        const available = permitted.map((skill) => skill.name).toSorted()
        const skill = permitted.find((skill) => skill.name === input.name)
        if (!skill) return { available }

        const directory = path.dirname(skill.location)
        const files =
          path.basename(skill.location) === "SKILL.md"
            ? (yield* fs
                .glob("**/*", { cwd: directory, absolute: true, include: "file", dot: true })
                .pipe(Effect.catch(() => Effect.succeed([] as string[]))))
                .filter((file) => path.basename(file) !== "SKILL.md")
                .toSorted()
                .slice(0, SkillV2.MODEL_FILE_LIMIT)
            : []

        return {
          available,
          text: SkillV2.toModelOutput(skill, files),
        }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [AgentV2.node, SkillV2.node, FSUtil.node],
})
