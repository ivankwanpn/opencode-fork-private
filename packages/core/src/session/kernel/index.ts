export * as Kernel from "./index"

import { Context, Effect, Layer } from "effect"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionExecution } from "../execution"
import { SessionSchema } from "../schema"
import { LifecycleStore } from "./lifecycle-store"

export interface KernelExecution {
  readonly lifecycle: LifecycleStore.Interface
  /**
   * Inert execution surface until Task 5 installs the coordinator: the Kernel
   * may create/read/fence execution rows, but provider work fails loudly with
   * KernelUnavailableError and never falls back to Classic.
   */
  readonly execution: SessionExecution.Interface
}

export class Service extends Context.Service<Service, KernelExecution>()("@opencode/v2/Kernel") {}

const unavailable = (sessionID: SessionSchema.ID) =>
  Effect.fail(new SessionSchema.KernelUnavailableError({ sessionID }))

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* LifecycleStore.Service
    return Service.of({
      lifecycle,
      execution: SessionExecution.Service.of({
        active: Effect.succeed(new Set()),
        // Provider work fails loudly. wake/wait/interrupt are truthful no-ops:
        // nothing can be running while the Kernel coordinator is not installed.
        resume: (sessionID) => unavailable(sessionID),
        exclusive: (sessionID) =>
          Effect.fail(new SessionExecution.BusyError({ sessionID })),
        wake: () => Effect.void,
        wait: () => Effect.void,
        interrupt: () => Effect.void,
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [LifecycleStore.node],
})
