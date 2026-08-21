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
import { TurnCoordinator } from "./coordinator"

export interface KernelExecution {
  readonly lifecycle: LifecycleStore.Interface
  readonly coordinator: TurnCoordinator.Interface
  /**
   * Live execution surface: provider turns run through the coordinator, which
   * never falls back to Classic. Non-drain work (shell, compaction, recovery)
   * is not implemented yet and fails as busy.
   */
  readonly execution: SessionExecution.Interface
}

export class Service extends Context.Service<Service, KernelExecution>()("@opencode/v2/Kernel") {}

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

    const coordinator = yield* TurnCoordinator.Service
    return Service.of({
      lifecycle,
      coordinator,
      execution: SessionExecution.Service.of({
        active: coordinator.active,
        resume: (sessionID) => coordinator.run(sessionID),
        exclusive: (sessionID) => Effect.fail(new SessionExecution.BusyError({ sessionID })),
        wake: (sessionID) => coordinator.wake(sessionID),
        wait: (sessionID) => coordinator.wait(sessionID),
        interrupt: (sessionID) => coordinator.interrupt(sessionID),
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, LifecycleStore.node, RecoveryPlanner.node, RecoveryExecutor.node, TurnCoordinator.node],
})
