export * as ToolScheduler from "./tool-scheduler"

import { Deferred, Duration, Effect, Exit, Fiber } from "effect"
import { DateTime } from "effect"
import type { ToolCall } from "@opencode-ai/llm"
import type { ToolRegistry } from "../../tool/registry"
import type { Tool } from "../../tool/tool"

export type ToolConcurrency = "parallel" | "exclusive"

export type ToolSettlementOutcome = "success" | "error" | "cancelled" | "abandoned"

export interface PreparedToolCall {
  readonly index: number
  readonly call: ToolCall
  readonly execute: () => Effect.Effect<ToolRegistry.Settlement, ToolRegistry.SettlementError>
  readonly concurrency: ToolConcurrency
  readonly onStart?: Effect.Effect<void>
  readonly onInterrupt?: (outcome: "cancelled" | "abandoned") => Effect.Effect<void>
  readonly deadline: DateTime.Utc
}

export interface ToolSettlement {
  readonly index: number
  readonly callID: string
  readonly outcome: ToolSettlementOutcome
  readonly result?: ToolRegistry.Settlement
  readonly error?: Tool.Failure
}

export interface Interface {
  /**
   * Bounded dispatch with head-of-line finalization: parallel bodies run
   * concurrently up to the cap, exclusive bodies drain all active work and
   * run alone, and the returned settlements are index-ordered so the caller
   * commits exactly the contiguous settled prefix in model order.
   */
  readonly run: (calls: readonly PreparedToolCall[]) => Effect.Effect<readonly ToolSettlement[], never, never>
}

/** Maximum concurrent tool bodies. */
export const MaxActiveBodies = 10

const runBodies = Effect.fn("ToolScheduler.runBodies")(function* (
  calls: readonly PreparedToolCall[],
  launched: Array<Fiber.Fiber<void, never> | undefined>,
) {
  const total = calls.length
  if (total === 0) return [] as ToolSettlement[]
  const settled = new Array<ToolSettlement>(total)
  const completions = new Array<Deferred.Deferred<void>>(total)
  for (let index = 0; index < total; index++) completions[index] = yield* Deferred.make<void>()

  const launch = (index: number) =>
    Effect.gen(function* () {
      const prepared = calls[index]!
      const fiber = yield* Effect.gen(function* () {
        yield* prepared.onStart ?? Effect.void
        const exit = yield* prepared.execute().pipe(Effect.exit)
        settled[index] = Exit.isSuccess(exit)
          ? { index, callID: prepared.call.id, outcome: "success", result: exit.value }
          : { index, callID: prepared.call.id, outcome: "error" }
        yield* Deferred.succeed(completions[index], undefined)
      }).pipe(Effect.forkDetach({ startImmediately: false }))
      launched[index] = fiber
    })

  const awaitOne = (index: number) => Effect.asVoid(Deferred.await(completions[index]))

  const inFlight: number[] = []
  for (let index = 0; index < total; index++) {
    const prepared = calls[index]!
    if (prepared.concurrency === "exclusive") {
      // Drain every active parallel body before running the exclusive body.
      for (const pending of [...inFlight]) yield* awaitOne(pending)
      inFlight.length = 0
      yield* launch(index)
      yield* awaitOne(index)
      continue
    }
    // Replenish to at most MaxActiveBodies; head-of-line waits on the oldest.
    while (inFlight.length >= MaxActiveBodies) {
      const oldest = inFlight.shift()!
      yield* awaitOne(oldest)
    }
    inFlight.push(index)
    yield* launch(index)
  }
  for (const pending of [...inFlight]) yield* awaitOne(pending)

  // Index order is the contiguous settled prefix; a settled slot after an
  // unresolved one is an invariant violation of the scheduler.
  const ordered: ToolSettlement[] = []
  for (let index = 0; index < total; index++) {
    const entry = settled[index]
    if (!entry) return yield* Effect.die(`Tool scheduler left slot ${index} unsettled`)
    ordered.push(entry)
  }
  return ordered
})

const interruptBodies = Effect.fn("ToolScheduler.interruptBodies")(function* (
  calls: readonly PreparedToolCall[],
  launched: readonly (Fiber.Fiber<void, never> | undefined)[],
) {
  const active = launched.filter((fiber): fiber is Fiber.Fiber<void, never> => fiber !== undefined)
  yield* Effect.sync(() => active.forEach((fiber) => fiber.interruptUnsafe()))
  if (active.length > 0)
    yield* Effect.raceFirst(Effect.forEach(active, Fiber.await, { discard: true }), Effect.sleep(Duration.seconds(3)))
  yield* Effect.forEach(
    calls,
    (call, index) => {
      const fiber = launched[index]
      const outcome = fiber !== undefined && fiber.pollUnsafe() === undefined ? "abandoned" : "cancelled"
      return call.onInterrupt?.(outcome) ?? Effect.void
    },
    { discard: true },
  )
})
export const make = (): Interface => ({
  run: (calls) =>
    Effect.scoped(
      Effect.gen(function* () {
        // A turn interrupt cancels every dispatched body (foreground shell
        // waiters cancel their jobs) while bodies that were never started are
        // never launched; the ordered settlement assertion dies with the drain.
        const launched: Array<Fiber.Fiber<void, never> | undefined> = []
        return yield* Effect.uninterruptibleMask((restore) =>
          restore(runBodies(calls, launched)).pipe(Effect.onInterrupt(() => interruptBodies(calls, launched))),
        )
      }),
    ),
})
