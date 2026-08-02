import { describe, expect } from "bun:test"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import {
  evaluateStopHooks,
  MAX_BLOCKS_PER_TURN,
  type StopHookEvent,
} from "@opencode-ai/core/session/stop-hook"

const it = testEffect(PluginRuntime.locationLayer)

describe("SessionStopHook", () => {
  it.effect("stop hook action=stop ends the turn without continuation", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook(PluginRuntime.HookName.sessionStop, (event: StopHookEvent) => {
        event.outcome.set({ action: "stop", reason: "verification complete" })
      })
      const outcome = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
      expect(outcome.action).toBe("stop")
    }),
  )

  it.effect("stop hook action=continue injects a synthetic input and respects the block cap", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      let calls = 0
      yield* runtime.hook(PluginRuntime.HookName.sessionStop, (event: StopHookEvent) => {
        calls++
        event.outcome.set({
          action: "continue",
          continuation: [{ type: "text", text: "run tests" }],
        })
      })
      const first = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
      expect(first.action).toBe("continue")
      expect(calls).toBe(1)
      // Reaching the per-turn block cap forces a stop without invoking the hook again.
      // (Adapted from the plan's `blockCount: 1`: MAX_BLOCKS_PER_TURN is 3, so 1 does not
      // exercise the cap boundary; using the exported constant keeps continue-below / stop-at
      // the cap intent while testing the real boundary.)
      const second = yield* evaluateStopHooks({
        lastAssistantMessage: "done",
        blockCount: MAX_BLOCKS_PER_TURN,
      })
      expect(second.action).toBe("stop")
      expect(calls).toBe(1)
    }),
  )

  it.effect("a failing stop hook fails open to stop and does not propagate", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook(PluginRuntime.HookName.sessionStop, () => Effect.die(new Error("boom")))
      const outcome = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
      expect(outcome.action).toBe("stop")
    }),
  )

  it.effect("a throwing stop hook fails open to stop and does not propagate", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook(PluginRuntime.HookName.sessionStop, () => {
        throw new Error("throw")
      })
      const outcome = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
      expect(outcome.action).toBe("stop")
    }),
  )

  it.effect("subagent evaluations run the subagent stop hook", () =>
    Effect.gen(function* () {
      const runtime = yield* PluginRuntime.Service
      let calls = 0
      yield* runtime.hook(PluginRuntime.HookName.sessionSubagentStop, (event: StopHookEvent) => {
        calls++
        event.outcome.set({ action: "stop" })
      })
      yield* evaluateStopHooks({ lastAssistantMessage: "done", agent: "subagent" })
      expect(calls).toBe(1)
    }),
  )
})
