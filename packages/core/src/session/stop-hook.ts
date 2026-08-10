export * as SessionStopHook from "./stop-hook"

import { Effect } from "effect"
import { PluginRuntime } from "../plugin/runtime"

export const MAX_BLOCKS_PER_TURN = 3

export type PromptFragment = { readonly type: "text"; readonly text: string }

export type StopHookOutcome =
  | { readonly action: "stop"; readonly reason?: string }
  | { readonly action: "continue"; readonly continuation?: readonly PromptFragment[] }

export type StopHookEvent = {
  readonly lastAssistantMessage?: string
  readonly blockCount: number
  readonly outcome: PluginRuntime.Mutable<StopHookOutcome | undefined>["value"]
}

export const evaluateStopHooks = Effect.fn("SessionStopHook.evaluate")(function* (input: {
  readonly lastAssistantMessage?: string
  readonly blockCount?: number
  readonly agent?: string
}) {
  const runtime = yield* PluginRuntime.Service
  if ((input.blockCount ?? 0) >= MAX_BLOCKS_PER_TURN) return { action: "stop" as const }
  const hookName =
    input.agent === undefined
      ? PluginRuntime.HookName.sessionStop
      : PluginRuntime.HookName.sessionSubagentStop
  // Hooks publish their decision by writing to the event's outcome holder, the same pattern
  // `PluginRuntime.run` uses for `session.text.complete`. `run` folds callbacks but always
  // returns the event value, so a mutable holder carries the decision back to this caller.
  const outcome = PluginRuntime.mutable<StopHookOutcome | undefined>(undefined)
  // Fail open: a hook that throws, fails, or times out must not block the turn from ending
  // normally. The evaluation degrades to "stop" (turn ends) instead of propagating the failure.
  yield* runtime
    .run(hookName, {
      lastAssistantMessage: input.lastAssistantMessage,
      blockCount: input.blockCount ?? 0,
      outcome: outcome.value,
    })
    .pipe(Effect.catchCause(() => Effect.void))
  const decision = outcome.get()
  if (decision?.action === "continue")
    return { action: "continue" as const, continuation: decision.continuation }
  return { action: "stop" as const, reason: decision?.reason }
})
