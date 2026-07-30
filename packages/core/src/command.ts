export * as CommandV2 from "./command"

import type { Part } from "@opencode-ai/sdk/v2/types"
import { makeLocationNode } from "./effect/app-node"
import { Context, Effect, Layer, Types } from "effect"
import { Command } from "@opencode-ai/schema/command"
import { State } from "./state"
import { PluginRuntime } from "./plugin/runtime"

export const Info = Command.Info
export type Info = Command.Info

export type Data = {
  commands: Map<string, Types.DeepMutable<Info>>
}

export type Draft = {
  list: () => readonly Info[]
  get: (name: string) => Info | undefined
  update: (name: string, update: (command: Types.DeepMutable<Info>) => void) => void
  remove: (name: string) => void
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
    const state = State.create<Data, Draft>({
      initial: () => ({ commands: new Map() }),
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
      }),
    })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("CommandV2.get")(function* (name) {
        return state.get().commands.get(name)
      }),
      list: Effect.fn("CommandV2.list")(function* () {
        return Array.from(state.get().commands.values())
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

export const node = makeLocationNode({ service: Service, layer, deps: [PluginRuntime.node] })
