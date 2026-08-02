export * as PluginRuntime from "./runtime"

import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "../effect/app-node"

export const HookName = {
  sessionMessageBefore: "session.message.before",
  sessionChatParams: "session.chat.params",
  sessionChatHeaders: "session.chat.headers",
  sessionMessagesTransform: "session.chat.messages.transform",
  sessionSystemTransform: "session.chat.system.transform",
  sessionCompacting: "session.compacting",
  sessionCompactionAutocontinue: "session.compaction.autocontinue",
  sessionTextComplete: "session.text.complete",
  permissionAsk: "permission.ask",
  shellEnv: "shell.env",
  toolExecuteBefore: "tool.execute.before",
  toolExecuteAfter: "tool.execute.after",
  toolDefinition: "tool.definition",
  commandExecuteBefore: "command.execute.before",
  providerSmallModel: "provider.small-model",
  sessionStop: "session.stop",
  sessionSubagentStop: "session.subagent.stop",
} as const

export type HookName = (typeof HookName)[keyof typeof HookName]

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Mutable<Value> {
  readonly value: {
    readonly get: () => Value
    readonly set: (value: Value) => void
    readonly update: (transform: (value: Value) => Value) => void
  }
  readonly get: () => Value
}

export function mutable<Value>(initial: Value): Mutable<Value> {
  let current = initial
  return {
    value: {
      get: () => current,
      set: (value) => {
        current = value
      },
      update: (transform) => {
        current = transform(current)
      },
    },
    get: () => current,
  }
}

export interface Owner {
  readonly id: string
  readonly order: number
}

export const CurrentOwner = Context.Reference<Owner | undefined>("@opencode/PluginRuntime/CurrentOwner", {
  defaultValue: () => undefined,
})

type Callback<Event> = (event: Event) => Effect.Effect<void> | void

type Entry = {
  readonly owner: Owner | undefined
  readonly sequence: number
  readonly callback: Callback<any>
}

export interface Interface {
  readonly hook: <Event>(
    name: HookName,
    callback: Callback<Event>,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly run: <Event>(name: HookName, event: Event) => Effect.Effect<Event>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginRuntime") {}

export function make(): Interface {
  let registrations = new Map<HookName, readonly Entry[]>()
  let sequence = 0

  const ordered = (left: Entry, right: Entry) => {
    if (left.owner && right.owner && left.owner.order !== right.owner.order)
      return left.owner.order - right.owner.order
    return left.sequence - right.sequence
  }

  const hook = Effect.fn("PluginRuntime.hook")(function* <Event>(name: HookName, callback: Callback<Event>) {
    const scope = yield* Scope.Scope
    const owner = yield* CurrentOwner
    const entry: Entry = { owner, sequence: sequence++, callback }
    let active = true
    const dispose = Effect.sync(() => {
      if (!active) return
      active = false
      const next = (registrations.get(name) ?? []).filter((item) => item !== entry)
      if (next.length > 0) registrations.set(name, next)
      else registrations.delete(name)
    })

    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        registrations.set(name, [...(registrations.get(name) ?? []), entry].toSorted(ordered))
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      }),
    )
  })

  const run = Effect.fn("PluginRuntime.run")(function* <Event>(name: HookName, event: Event) {
    const snapshot = registrations.get(name) ?? []
    for (const registration of snapshot) {
      const result = registration.callback(event)
      if (Effect.isEffect(result)) yield* result
    }
    return event
  })

  return Service.of({ hook, run })
}

export const locationLayer = Layer.sync(Service, make)

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [] })
