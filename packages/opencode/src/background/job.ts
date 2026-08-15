import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { Effect, Layer } from "effect"

export {
  Service,
  type ExtendInput,
  type Info,
  type Interface,
  type StartInput,
  type Status,
  type WaitInput,
  type WaitResult,
} from "@opencode-ai/core/background-job"

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
const layer = Layer.effect(
  CoreBackgroundJob.Service,
  Effect.gen(function* () {
    const fallback = yield* CoreBackgroundJob.make
    const state = yield* InstanceState.make(() => CoreBackgroundJob.make)
    const use = <A, E, R>(select: (jobs: CoreBackgroundJob.Interface) => Effect.Effect<A, E, R>) =>
      Effect.flatMap(InstanceRef, (instance) => (instance ? InstanceState.useEffect(state, select) : select(fallback)))
    return CoreBackgroundJob.Service.of({
      list: () => use((jobs) => jobs.list()),
      get: (id) => use((jobs) => jobs.get(id)),
      start: (input) => use((jobs) => jobs.start(input)),
      update: (input) => use((jobs) => jobs.update(input)),
      extend: (input) => use((jobs) => jobs.extend(input)),
      wait: (input) => use((jobs) => jobs.wait(input)),
      waitForPromotion: (id) => use((jobs) => jobs.waitForPromotion(id)),
      promote: (id) => use((jobs) => jobs.promote(id)),
      cancel: (id) => use((jobs) => jobs.cancel(id)),
    })
  }),
)

export const node = LayerNode.make({ service: CoreBackgroundJob.Service, layer, deps: [] })

export * as BackgroundJob from "./job"
