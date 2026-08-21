import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Fiber } from "effect"
import { ToolScheduler, MaxActiveBodies } from "@opencode-ai/core/session/kernel/tool-scheduler"
import type { ToolRegistry } from "@opencode-ai/core/tool/registry"
import type { ToolCall } from "@opencode-ai/llm"

const runEffect = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, unknown, never>)

const call = (id: string): ToolCall => ({ type: "tool-call", id, name: "echo", input: { text: id } })
const settlement = (id: string): ToolRegistry.Settlement => ({
  result: { type: "text", value: `result-${id}` },
})
const prepared = (index: number, callID: string, execute: () => Effect.Effect<ToolRegistry.Settlement>) => ({
  index,
  call: call(callID),
  execute,
  concurrency: "parallel" as const,
  deadline: DateTime.makeUnsafe(0),
})

describe("ToolScheduler faults", () => {
  test("turns a thrown body defect into an error settlement without aborting siblings", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        const results = yield* scheduler.run([
          prepared(0, "die-0", () => Effect.die(new Error("defect"))),
          prepared(1, "ok-1", () => Effect.succeed(settlement("ok-1"))),
        ])
        expect(results).toMatchObject([
          { index: 0, outcome: "error" },
          { index: 1, outcome: "success" },
        ])
      }),
    ))

  test("turns a typed body failure into an error settlement", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        const results = yield* scheduler.run([
          prepared(0, "fail-0", () => Effect.die(new Error("denied"))),
        ])
        expect(results).toMatchObject([{ index: 0, outcome: "error" }])
      }),
    ))

  test("an exclusive call after a full pool still fulfils every slot", async () =>
    runEffect(
      Effect.gen(function* () {
        const scheduler = ToolScheduler.make()
        const calls = [
          ...Array.from({ length: MaxActiveBodies }, (_, index) =>
            prepared(index, `p-${index}`, () => Effect.succeed(settlement(`p-${index}`))),
          ),
          {
            index: MaxActiveBodies,
            call: call("exclusive"),
            execute: () => Effect.succeed(settlement("exclusive")),
            concurrency: "exclusive" as const,
            deadline: DateTime.makeUnsafe(0),
          },
        ]
        const results = yield* scheduler.run(calls)
        expect(results).toHaveLength(MaxActiveBodies + 1)
        expect(results[MaxActiveBodies]).toMatchObject({ index: MaxActiveBodies, outcome: "success" })
      }),
    ))
})
