export * as Kernel from "./index"

import { Context, Effect, Layer } from "effect"
import { ne } from "drizzle-orm"
import { Database } from "../../database/database"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionExecution } from "../execution"
import { SessionSchema } from "../schema"
import { SessionExecutionTable } from "../sql"
import { LifecycleStore } from "./lifecycle-store"
import { RecoveryExecutor } from "./recovery-executor"
import { RecoveryPlanner } from "./recovery-planner"

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
    const planner = yield* RecoveryPlanner.Service
    const executor = yield* RecoveryExecutor.Service
    const { db } = yield* Database.Service

    // Startup reconciliation: classify every non-idle kernel execution and
    // apply only idempotent terminal/read-model reconciliation. Startup never
    // runs provider, tool, shell, compaction, or notification-as-turn work.
    const stale = yield* db
      .select({ sessionID: SessionExecutionTable.session_id })
      .from(SessionExecutionTable)
      .where(ne(SessionExecutionTable.state, "idle"))
      .all()
      .pipe(Effect.orDie)
    for (const row of stale) {
      yield* planner
        .plan(row.sessionID)
        .pipe(
          Effect.flatMap((plan) => executor.apply(plan)),
          Effect.catchCause((cause) =>
            Effect.logWarning("Kernel startup reconciliation failed", {
              sessionID: row.sessionID,
              cause,
            }),
          ),
        )
    }

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
  deps: [Database.node, LifecycleStore.node, RecoveryPlanner.node, RecoveryExecutor.node],
})
