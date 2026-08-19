import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { evaluateStopHooks } from "@opencode-ai/core/session/stop-hook"
import { define } from "@opencode-ai/plugin/v2/promise"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("fromPromise", () => {
  it.effect("loads a promise plugin and registers a transform hook", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-example",
        setup: async (ctx) => {
          expect(ctx.options.mode).toBe("strict")
          await ctx.agent.transform((draft) => {
            draft.update("reviewer", (item) => {
              item.description = "Reviews code"
              item.mode = "subagent"
            })
          })
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect({ ...host, options: { mode: "strict" } })

      expect(yield* agents.get(AgentV2.ID.make("reviewer"))).toMatchObject({
        description: "Reviews code",
        mode: "subagent",
      })
    }),
  )

  it.effect("disposes a hook registration on request", () =>
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-dispose",
        setup: async (ctx) => {
          const registration = await ctx.agent.transform((draft) => {
            draft.update("temp", (item) => {
              item.description = "temporary"
            })
          })
          await registration.dispose()
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect(host)

      expect(yield* agents.get(AgentV2.ID.make("temp"))).toBeUndefined()
    }),
  )

  it.effect("routes session.stop and session.subagent.stop hooks through the host", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)

      const promisePlugin = define({
        id: "promise-stop-hooks",
        setup: async (ctx) => {
          await ctx.session.hook("session.stop", (event) => {
            event.outcome.set({ action: "continue", continuation: [{ type: "text", text: "run tests" }] })
          })
          await ctx.session.hook("session.subagent.stop", (event) => {
            event.outcome.set({ action: "stop", reason: "subagent verified" })
          })
        },
      })

      const adapted = PluginPromise.fromPromise(promisePlugin)
      yield* adapted.effect(host)

      const mainOutcome = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
      expect(mainOutcome).toMatchObject({ action: "continue", continuation: [{ type: "text", text: "run tests" }] })
      const subagentOutcome = yield* evaluateStopHooks({ lastAssistantMessage: "done", agent: "reviewer" })
      expect(subagentOutcome).toMatchObject({ action: "stop", reason: "subagent verified" })
    }),
  )

  it.effect("routes Promise AISDK options hooks through the Effect host", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const plugin = yield* PluginV2.Service
      const host = yield* PluginHost.make(plugin)
      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("provider"), ModelV2.ID.make("model")),
        api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
      })

      const adapted = PluginPromise.fromPromise(
        define({
          id: "promise-aisdk-options",
          setup: async (ctx) => {
            await ctx.aisdk.options(async (event) => {
              expect(event.model.id).toBe(ModelV2.ID.make("model"))
              expect(event.package).toBe("test-provider")
              await Promise.resolve()
              event.options.promise = "active"
            })
          },
        }),
      )
      yield* adapted.effect(host)

      expect((yield* aisdk.runOptions({ model, package: "test-provider", options: { base: true } })).options).toEqual({
        base: true,
        promise: "active",
      })
    }),
  )
})
