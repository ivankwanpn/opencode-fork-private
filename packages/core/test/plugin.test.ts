import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { define } from "@opencode-ai/plugin/v2/effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

function mutable<Value>(initial: Value) {
  let current = initial
  return {
    value: {
      get: () => current,
      set: (value: Value) => {
        current = value
      },
      update: (transform: (value: Value) => Value) => {
        current = transform(current)
      },
    },
    get: () => current,
  }
}

describe("PluginV2", () => {
  it.effect("reports a plugin as initializing until activation completes", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const started = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const id = PluginV2.ID.make("status-loading")
      const loading = yield* plugins
        .add(id, () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate))))
        .pipe(Effect.forkChild)

      yield* Deferred.await(started)
      expect((yield* plugins.status())[id]).toEqual({ state: "initializing" })

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(loading)
      expect((yield* plugins.status())[id]).toEqual({ state: "ready" })
    }),
  )

  it.effect("retains a failed activation as inspectable runtime state", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("status-failed")

      yield* plugins.add(id, () => Effect.die("boom")).pipe(Effect.exit)

      expect((yield* plugins.status())[id]).toMatchObject({
        state: "failed",
        message: expect.stringContaining("boom"),
      })
    }),
  )

  it.effect("removes runtime state when a plugin is removed", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("status-removed")

      yield* plugins.add(id, () => Effect.void)
      expect((yield* plugins.status())[id]).toEqual({ state: "ready" })
      yield* plugins.remove(id)

      expect((yield* plugins.status())[id]).toBeUndefined()
    }),
  )

  it.effect("waits for a plugin and returns immediately once active", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("waited")
      const waiting = yield* plugins.wait(id).pipe(Effect.forkChild)

      yield* plugins.add(id, () => Effect.void)
      yield* Fiber.join(waiting)
      yield* plugins.wait(id)
    }),
  )

  it.effect("propagates plugin activation defects to waiters", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("failed")
      const waiting = yield* plugins.wait(id).pipe(Effect.exit, Effect.forkChild)

      const added = yield* plugins.add(id, () => Effect.die("boom")).pipe(Effect.exit)
      const pending = yield* Fiber.join(waiting)
      const later = yield* plugins.wait(id).pipe(Effect.exit)

      expect(Exit.isFailure(added)).toBe(true)
      expect(Exit.isFailure(pending)).toBe(true)
      expect(Exit.isFailure(later)).toBe(true)
    }),
  )

  it.effect("adds, replaces, and removes plugins", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      let description = "first"

      const managed = () =>
        define({
          id: "managed",
          effect: (ctx) =>
            ctx.agent
              .transform((agents) =>
                agents.update("configured", (agent) => {
                  agent.description = description
                }),
              )
              .pipe(Effect.asVoid),
        })

      yield* plugins.add(PluginV2.ID.make("managed"), managed().effect)

      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("first")

      description = "second"
      yield* plugins.add(PluginV2.ID.make("managed"), managed().effect)
      expect((yield* agents.get(AgentV2.ID.make("configured")))?.description).toBe("second")

      yield* plugins.remove(PluginV2.ID.make("managed"))
      expect(yield* agents.get(AgentV2.ID.make("configured"))).toBeUndefined()
    }),
  )

  it.effect("registers and disposes Effect runtime hooks through PluginHost", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const runtime = yield* PluginRuntime.Service
      const id = PluginV2.ID.make("runtime-hook")

      yield* plugins.add(
        id,
        define({
          id,
          effect: (ctx) =>
            ctx.tool
              .hook("execute.before", (event) => {
                event.args.update((args) => ({ ...(args as object), hooked: true }))
              })
              .pipe(Effect.asVoid),
        }).effect,
      )

      const first = mutable<unknown>({ value: 1 })
      yield* runtime.run(PluginRuntime.HookName.toolExecuteBefore, {
        tool: "test",
        sessionID: "ses_test",
        callID: "call_test",
        args: first.value,
      })
      expect(first.get()).toEqual({ value: 1, hooked: true })

      yield* plugins.remove(id)
      const second = mutable<unknown>({ value: 2 })
      yield* runtime.run(PluginRuntime.HookName.toolExecuteBefore, {
        tool: "test",
        sessionID: "ses_test",
        callID: "call_test",
        args: second.value,
      })
      expect(second.get()).toEqual({ value: 2 })
    }),
  )

  it.effect("retains plugin hook order when replacing an earlier plugin", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const runtime = yield* PluginRuntime.Service
      const calls: string[] = []
      const plugin = (id: string, label: string) =>
        define({
          id,
          effect: (ctx) =>
            ctx.tool
              .hook("execute.before", () => {
                calls.push(label)
              })
              .pipe(Effect.asVoid),
        })

      yield* plugins.add(PluginV2.ID.make("first-hook"), plugin("first-hook", "first:v1").effect)
      yield* plugins.add(PluginV2.ID.make("second-hook"), plugin("second-hook", "second").effect)
      yield* plugins.add(PluginV2.ID.make("first-hook"), plugin("first-hook", "first:v2").effect)

      const args = mutable<unknown>({})
      yield* runtime.run(PluginRuntime.HookName.toolExecuteBefore, {
        tool: "test",
        sessionID: "ses_test",
        callID: "call_test",
        args: args.value,
      })
      expect(calls).toEqual(["first:v2", "second"])
    }),
  )

  it.effect("adapts Promise runtime hooks and event subscriptions onto the Effect host", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const runtime = yield* PluginRuntime.Service
      const events = yield* EventV2.Service
      const received = yield* Deferred.make<{ readonly type: string; readonly properties: unknown }>()
      const promise = PluginPromise.fromPromise({
        id: "promise-hook",
        setup: async (ctx) => {
          await ctx.shell.hook("env", (event) => {
            event.env.update((env) => ({ ...env, PROMISE_PLUGIN: "active" }))
          })
          await ctx.event.subscribe("catalog.updated", (event) => {
            Deferred.doneUnsafe(received, Effect.succeed(event))
          })
        },
      })
      yield* plugins.add(PluginV2.ID.make(promise.id), promise.effect)

      const env = mutable<Record<string, string>>({ EXISTING: "value" })
      yield* runtime.run(PluginRuntime.HookName.shellEnv, {
        cwd: "/repo",
        env: env.value,
      })
      expect(env.get()).toEqual({ EXISTING: "value", PROMISE_PLUGIN: "active" })

      yield* Effect.yieldNow
      yield* events.publish(Catalog.Event.Updated, {})
      expect(yield* Deferred.await(received)).toMatchObject({ type: "catalog.updated", properties: {} })
    }),
  )
})
