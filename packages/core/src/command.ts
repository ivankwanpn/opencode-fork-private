export * as CommandV2 from "./command"

import path from "path"
import type { Part } from "@opencode-ai/sdk/v2/types"
import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Types } from "effect"
import { Command } from "@opencode-ai/schema/command"
import { State } from "./state"
import { PluginRuntime } from "./plugin/runtime"
import { SkillV2 } from "./skill"

export const Info = Command.Info
export type Info = Command.Info

export const INIT = "init"
export const REVIEW = "review"

export interface Source {
  readonly list: () => Effect.Effect<readonly Info[]>
  readonly get: (name: string) => Effect.Effect<Info | undefined>
}

export type Data = {
  commands: Map<string, Types.DeepMutable<Info>>
  sources: Source[]
}

export type Draft = {
  list: () => readonly Info[]
  get: (name: string) => Info | undefined
  update: (name: string, update: (command: Types.DeepMutable<Info>) => void) => void
  remove: (name: string) => void
  source: (source: Source) => void
}

export interface Interface extends State.Transformable<Draft> {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly beforeExecute: (input: {
    readonly command: string
    readonly sessionID: string
    readonly arguments: string
    readonly parts: readonly Part[]
  }) => Effect.Effect<readonly Part[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const plugins = yield* PluginRuntime.Service
    const skills = yield* SkillV2.Service
    const state = State.create<Data, Draft>({
      initial: () => ({ commands: new Map(), sources: [] }),
      draft: (draft) => ({
        list: () => Array.from(draft.commands.values()) as Info[],
        get: (name) => draft.commands.get(name),
        update: (name, update) => {
          const current = draft.commands.get(name) ?? ({ name, template: "" } as Types.DeepMutable<Info>)
          if (!draft.commands.has(name)) draft.commands.set(name, current)
          update(current)
          current.name = name
        },
        remove: (name) => {
          draft.commands.delete(name)
        },
        source: (source) => {
          draft.sources.push(source)
        },
      }),
    })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("CommandV2.get")(function* (name) {
        const current = state.get()
        for (const source of current.sources.toReversed()) {
          const command = yield* source.get(name)
          if (command) return command
        }
        const command = current.commands.get(name)
        if (command) return command
        const skill = (yield* skills.list()).find((item) => item.name === name && item.slash !== false)
        return skill && fromSkill(skill)
      }),
      list: Effect.fn("CommandV2.list")(function* () {
        const current = state.get()
        const commands = new Map(current.commands)
        for (const source of current.sources) {
          for (const command of yield* source.list()) commands.set(command.name, command as Types.DeepMutable<Info>)
        }
        const names = new Set(commands.keys())
        return [
          ...commands.values(),
          ...(yield* skills.list()).filter((skill) => skill.slash !== false && !names.has(skill.name)).map(fromSkill),
        ]
      }),
      beforeExecute: Effect.fn("CommandV2.beforeExecute")(function* (input) {
        const parts = PluginRuntime.mutable(input.parts)
        yield* plugins.run(PluginRuntime.HookName.commandExecuteBefore, {
          command: input.command,
          sessionID: input.sessionID,
          arguments: input.arguments,
          parts: parts.value,
        })
        return parts.get()
      }),
    })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({ service: Service, layer, deps: [PluginRuntime.node, SkillV2.node] })

function fromSkill(skill: SkillV2.Info) {
  return Info.make({
    name: skill.name,
    template: [
      skill.content,
      "",
      `Base directory for this skill: ${path.dirname(skill.location)}`,
      "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
    ].join("\n"),
    ...(skill.description === undefined ? {} : { description: skill.description }),
  })
}
