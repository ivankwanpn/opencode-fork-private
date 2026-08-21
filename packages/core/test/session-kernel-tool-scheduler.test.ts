import { describe, expect, test } from "bun:test"
import { DateTime, Deferred, Effect, Fiber } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ToolScheduler, MaxActiveBodies } from "@opencode-ai/core/session/kernel/tool-scheduler"
import type { ToolRegistry } from "@opencode-ai/core/tool/registry"
import type { ToolCall } from "@opencode-ai/llm"

const runEffect = <A, R>(effect: Effect.Effect<A, unknown, R>) => Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, unknown, never>)

const call = (id: string): ToolCall => ({ type: "tool-call", id, name: "echo", input: { text: id } })
const settlement = (id: string): ToolRegistry.Settlement => ({
  result: { type: "text", value: `result-${id}` },
})

const prepared = (
  index: number,
  callID: string,
  concurrency: "parallel" | "exclusive",
  execute: () => Effect.Effect<ToolRegistry.Settlement>,
) => ({ index, call: call(callID), execute, concurrency, deadline: DateTime.makeUnsafe(0) })

describe("ToolScheduler", () => {
  test("runs parallel bodies concurrently but commits results in model order", async () =>
    runEffect(
      Effect.gen(function* () {
        const slowGate = yield* Deferred.make<void>()
        const slowStarted = yield* Deferred.make<void>()
        const scheduler = ToolScheduler.make()
        const executed: string[] = []
        const callExec = (id: string, start: () => Effect.Effect<void>, end?: () => Effect.Effect<void>) => () =>
          Effect.gen(function* () {
            executed.push(id)
            yield* start()
            yield* (end ? end() : Effect.void)
            return settlement(id)
          })
        const fastDone = yield* Deferred.make<string>()
        const slow = callExec("slow-0", () => Deferred.succeed(slowStarted, undefined).pipe(Effect.asVoid), () =>
          Deferred.await(slowGate),
        )
        const run = yield* scheduler
          .run([
            prepared(0, "slow-0", "parallel", slow),
            prepared(1, "fast-1", "parallel", () =>
              callExec("fast-1", () => Effect.void, () => Deferred.succeed(fastDone, "fast-1"))()),
          ])
          .pipe(Effect.forkScoped)
        yield* Deferred.await(slowStarted)
        // fast-1 completed while slow-0 is still gated.
        expect(yield* Deferred.await(fastDone)).toBe("fast-1")
        yield* Deferred.succeed(slowGate, undefined)
        const results = yield* Fiber.join(run)
        expect(results.map((item) => [item.index, item.outcome])).toEqual([
          [0, "success"],
          [1, "success"],
        ])
        expect(results.map((item) => item.callID)).toEqual(["slow-0", "fast-1"])
      }),
    ))

  test("drains parallel work around an exclusive call", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        const executed: string[] = []
        const gate = yield* Deferred.make<void>()
        const exclusiveGate = yield* Deferred.make<void>()
        const body = (id: string, gateToAwait: Deferred.Deferred<void>) => () =>
          Effect.gen(function* () {
            executed.push(id)
            yield* Deferred.await(gateToAwait)
            return settlement(id)
          })
        const run = yield* scheduler
          .run([
            prepared(0, "parallel-0", "parallel", body("parallel-0", gate)),
            prepared(1, "exclusive-1", "exclusive", body("exclusive-1", exclusiveGate)),
            prepared(2, "parallel-2", "parallel", body("parallel-2", gate)),
          ])
          .pipe(Effect.forkScoped)

        yield* Effect.yieldNow
        // The exclusive starts only after parallel-0 drained, so only
        // parallel-0 has begun and parallel-2 has not been reached yet.
        expect(executed).toEqual(["parallel-0"])
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.yieldNow
        expect(executed).toEqual(["parallel-0", "exclusive-1"])
        yield* Deferred.succeed(exclusiveGate, undefined)
        yield* Effect.yieldNow
        expect(executed).toEqual(["parallel-0", "exclusive-1", "parallel-2"])
        yield* Deferred.succeed(gate, undefined)
        const results = yield* Fiber.join(run)
        expect(results.map((item) => item.index)).toEqual([0, 1, 2])
      }),
    ))

  test("caps concurrent parallel bodies at ten and fulfils every slot", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        const gate = yield* Deferred.make<void>()
        let started = 0
        const body = (idx: number) => (): Effect.Effect<ToolRegistry.Settlement> =>
          Effect.gen(function* () {
            started += 1
            yield* Deferred.await(gate)
            return settlement(`cap-${idx}`)
          })
        const calls = Array.from({ length: 12 }, (_, index) =>
          prepared(index, `cap-${index}`, "parallel", body(index)),
        )
        const run = yield* scheduler.run(calls).pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        // Head-of-line replenishing caps at ten; the last two wait.
        expect(started).toBe(MaxActiveBodies)
        // Release the first ten; the next two launch and wait on the same gate.
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        const results = yield* Fiber.join(run)
        expect(results).toHaveLength(12)
        expect(results.every((item) => item.outcome === "success")).toBe(true)
      }),
    ))

  test("reports body errors as settlement errors without breaking the prefix", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        const results = yield* scheduler.run([
          prepared(0, "ok-0", "parallel", () => Effect.succeed(settlement("ok-0"))),
          prepared(1, "boom-1", "parallel", () => Effect.die(new Error("tool exploded"))),
          prepared(2, "ok-2", "parallel", () => Effect.succeed(settlement("ok-2"))),
        ])
        expect(results).toMatchObject([
          { index: 0, outcome: "success", callID: "ok-0" },
          { index: 1, outcome: "error", callID: "boom-1" },
          { index: 2, outcome: "success", callID: "ok-2" },
        ])
      }),
    ))

  test("returns an empty array for no calls", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        expect(yield* scheduler.run([])).toEqual([])
      }),
    ))
})
