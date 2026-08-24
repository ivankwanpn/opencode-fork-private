export * as Kernel from "./index"

import { Cause, Context, Effect, Layer, Option } from "effect"
import { and, eq, ne } from "drizzle-orm"
import { Database } from "../../database/database"
import { makeGlobalNode } from "../../effect/app-node"
import { LocationServiceMap } from "../../location-service-map"
import { SessionExecution } from "../execution"
import { SessionExecutionTable, SessionTable } from "../sql"
import { SessionStore } from "../store"
import { KernelDiagnostics } from "./diagnostics"
import { LifecycleStore } from "./lifecycle-store"
import { RecoveryExecutor } from "./recovery-executor"
import { RecoveryPlanner } from "./recovery-planner"
import { TurnCoordinator } from "./coordinator"
import { KernelPluginHost } from "./plugin-host"
import type { RecoveryPlan } from "./recovery-planner"

export interface KernelExecution {
  readonly lifecycle: LifecycleStore.Interface
  readonly coordinator: TurnCoordinator.Interface
  /** Fenced compaction; durable Started/Ended/Failed plus release under lease. */
  readonly compact: (
    input: SessionExecution.CompactInput,
  ) => Effect.Effect<SessionExecution.CompactResult, SessionExecution.BusyError>
  /**
   * Live execution surface: provider turns and compaction share the coordinator
   * and never fall back to Classic. Unsupported non-drain work fails as busy.
   */
  readonly execution: SessionExecution.Interface
  /** Idempotent startup/restart reconciliation over non-idle executions. */
  readonly reconcile: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, KernelExecution>()("@opencode/v2/Kernel") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const lifecycle = yield* LifecycleStore.Service
    const planner = yield* RecoveryPlanner.Service
    const executor = yield* RecoveryExecutor.Service
    const diagnostics = yield* KernelDiagnostics.Service
    const locations = yield* LocationServiceMap.Service
    const store = yield* SessionStore.Service
    const { db } = yield* Database.Service

    const adviseRecovery = Effect.fn("Kernel.adviseRecovery")(function* (plan: RecoveryPlan) {
      const session = yield* store.get(plan.sessionID)
      if (!session) return
      yield* Effect.gen(function* () {
        const host = yield* Effect.serviceOption(KernelPluginHost.Service)
        if (Option.isNone(host)) return
        yield* host.value.seams
          .run(KernelPluginHost.SeamName.recoveryAdvice, { sessionID: plan.sessionID, plan })
          .pipe(Effect.orDie)
      }).pipe(
        Effect.provide(locations.get(session.location)),
        Effect.catchCause((cause) =>
          Effect.logWarning("Kernel recovery advice failed", { sessionID: plan.sessionID, cause }).pipe(Effect.asVoid),
        ),
      )
    })

    // Startup/restart reconciliation: classify every non-idle kernel
    // execution and apply only idempotent terminal/read-model reconciliation.
    // Never runs provider, tool, shell, compaction, or notification-as-turn
    // work; zero provider calls by construction.
    const reconcile = Effect.fn("Kernel.reconcile")(function* () {
      const stale = yield* db
        .select({ sessionID: SessionExecutionTable.session_id })
        .from(SessionExecutionTable)
        .innerJoin(SessionTable, eq(SessionExecutionTable.session_id, SessionTable.id))
        .where(and(eq(SessionTable.engine, "kernel"), ne(SessionExecutionTable.state, "idle")))
        .all()
        .pipe(Effect.orDie)
      for (const row of stale) {
        yield* planner.plan(row.sessionID).pipe(
          Effect.tap((plan) => adviseRecovery(plan)),
          Effect.flatMap((plan) => executor.apply(plan)),
          Effect.catchCause((cause) =>
            Effect.logWarning("Kernel startup reconciliation failed", {
              sessionID: row.sessionID,
              cause,
            }).pipe(Effect.flatMap(() => diagnostics.increment("startup.reconcile_failed"))),
          ),
          Effect.tap(() => diagnostics.increment("startup.reconciled")),
          Effect.ignore,
        )
      }
    })
    yield* reconcile()

    const coordinator = yield* TurnCoordinator.Service
    const compact = (input: SessionExecution.CompactInput) =>
      coordinator
        .compact(input)
        .pipe(
          Effect.catchTag("SessionRunCoordinator.Busy", () =>
            Effect.fail(new SessionExecution.BusyError({ sessionID: input.sessionID })),
          ),
        )

    return Service.of({
      lifecycle,
      coordinator,
      compact,
      reconcile,
      execution: SessionExecution.Service.of({
        active: coordinator.active,
        // A turn interrupted by the user fence settles durably in the drain;
        // resume joiners observe the interruption as the desired outcome and
        // complete successfully instead of surfacing a cancelled turn.
        resume: (sessionID) =>
          coordinator
            .run(sessionID)
            .pipe(Effect.catchCause((cause) => (Cause.hasInterrupts(cause) ? Effect.void : Effect.die(cause)))),
        exclusive: (sessionID) => Effect.fail(new SessionExecution.BusyError({ sessionID })),
        compact,
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
  deps: [
    Database.node,
    KernelDiagnostics.node,
    LifecycleStore.node,
    RecoveryPlanner.node,
    RecoveryExecutor.node,
    TurnCoordinator.node,
    LocationServiceMap.node,
    SessionStore.node,
  ],
})
