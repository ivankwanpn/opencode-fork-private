import { describe, expect } from "bun:test"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginRuntime.locationLayer)

describe("PluginRuntime", () => {
  it.effect("runs hooks sequentially in plugin and registration order", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      const hook = PluginRuntime.HookName.toolExecuteBefore
      type Event = { values: string[] }
      const register = (owner: PluginRuntime.Owner, value: string) =>
        runtime
          .hook(hook, (event: Event) => {
            event.values.push(value)
          })
          .pipe(Effect.provideService(PluginRuntime.CurrentOwner, owner))

      yield* register({ id: "later", order: 1 }, "later")
      yield* register({ id: "earlier", order: 0 }, "earlier:first")
      yield* register({ id: "earlier", order: 0 }, "earlier:second")

      const event = { values: [] as string[] }
      expect(yield* runtime.run(hook, event)).toBe(event)
      expect(event.values).toEqual(["earlier:first", "earlier:second", "later"])
    }),
  )

  it.effect("uses an invocation snapshot when a registration is disposed in flight", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      const hook = PluginRuntime.HookName.toolExecuteBefore
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let block = true

      yield* runtime.hook(hook, (event: { values: string[] }) => {
        event.values.push("first")
        if (!block) return
        return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
      })
      const second = yield* runtime.hook(hook, (event: { values: string[] }) => {
        event.values.push("second")
      })

      const current = { values: [] as string[] }
      const invocation = yield* runtime.run(hook, current).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* second.dispose
      yield* second.dispose
      block = false
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(invocation)
      expect(current.values).toEqual(["first", "second"])

      const next = { values: [] as string[] }
      yield* runtime.run(hook, next)
      expect(next.values).toEqual(["first"])
    }),
  )

  it.effect("removes hooks when their registration scope closes", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      const hook = PluginRuntime.HookName.shellEnv
      const scope = yield* Scope.make()
      yield* runtime
        .hook(hook, (event: { count: number }) => {
          event.count += 1
        })
        .pipe(Scope.provide(scope))

      const before = { count: 0 }
      yield* runtime.run(hook, before)
      expect(before.count).toBe(1)

      yield* Scope.close(scope, Exit.void)
      const after = { count: 0 }
      yield* runtime.run(hook, after)
      expect(after.count).toBe(0)
    }),
  )
})
