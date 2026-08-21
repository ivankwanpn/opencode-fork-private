export * as KernelDiagnostics from "./diagnostics"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../../effect/app-node"

export interface CounterSample {
  readonly key: string
  readonly count: number
}

export interface LatencySample {
  readonly key: string
  readonly count: number
  readonly p50Ms: number
  readonly p95Ms: number
}

export interface Snapshot {
  readonly counters: ReadonlyArray<CounterSample>
  readonly latencies: ReadonlyArray<LatencySample>
}

export interface Interface {
  readonly increment: (key: string, amount?: number) => Effect.Effect<void>
  readonly add: (key: string, durationMillis: number) => Effect.Effect<void>
  readonly snapshot: () => Effect.Effect<Snapshot>
  readonly reset: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/KernelDiagnostics") {}

function percentile(values: readonly number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].toSorted((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return Math.round(sorted[index]! * 100) / 100
}

export const make = Effect.fn("KernelDiagnostics.make")(function* () {
  const counters = new Map<string, number>()
  const latencies = new Map<string, readonly number[]>()
  return Service.of({
    increment: Effect.fn("KernelDiagnostics.increment")(function* (key: string, amount = 1) {
      yield* Effect.sync(() => counters.set(key, (counters.get(key) ?? 0) + amount))
    }),
    add: Effect.fn("KernelDiagnostics.add")(function* (key: string, durationMillis: number) {
      yield* Effect.sync(() => latencies.set(key, [...(latencies.get(key) ?? []), durationMillis]))
    }),
    snapshot: () =>
      Effect.sync(() => ({
        counters: Array.from(counters)
          .map(([key, count]) => ({ key, count }))
          .toSorted((left, right) => left.key.localeCompare(right.key)),
        latencies: Array.from(latencies)
          .map(([key, values]) => ({
            key,
            count: values.length,
            p50Ms: percentile(values, 50),
            p95Ms: percentile(values, 95),
          }))
          .toSorted((left, right) => left.key.localeCompare(right.key)),
      })),
    reset: () =>
      Effect.sync(() => {
        counters.clear()
        latencies.clear()
      }),
  })
})

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
