export * as SessionExecutionRouter from "./router"

import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../../database/database"
import { SessionCommand } from "../command"
import { SessionSchema } from "../schema"
import { SessionTable } from "../sql"
import type { SessionExecution } from "../execution"
import { Kernel } from "../kernel"

/**
 * Chooses the execution engine for a Session. Each Session fixes its engine at
 * creation; the router reads the stored engine and returns the matching
 * implementation. A missing engine registration fails with
 * KernelUnavailableError — the Kernel never falls back to Classic.
 */
export interface Interface {
  readonly resolve: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionExecution.Interface, SessionCommand.NotFoundError | SessionSchema.KernelUnavailableError>
  /** Union of the active snapshots of every registered engine. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionExecutionRouter") {}

/** Materializes the router from the engines installed in this process. */
export const make = (
  engines: Readonly<Partial<Record<SessionSchema.ExecutionEngine, SessionExecution.Interface>>>,
  db: Database.Interface["db"],
): Interface => {
  const registered = new Map(
    Object.entries(engines) as Array<[SessionSchema.ExecutionEngine, SessionExecution.Interface]>,
  )
  return {
    active: Effect.all([...registered.values()].map((engine) => engine.active), {
      concurrency: "unbounded",
    }).pipe(Effect.map((sets) => new Set<SessionSchema.ID>(sets.flatMap((set) => [...set])))),
    resolve: Effect.fn("SessionExecutionRouter.resolve")(function* (sessionID) {
      const row = yield* db
        .select({ engine: SessionTable.engine })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new SessionCommand.NotFoundError({ sessionID })
      const engine = registered.get(row.engine)
      if (!engine) return yield* new SessionSchema.KernelUnavailableError({ sessionID })
      return engine
    }),
  }
}

export const layer = (engines: Readonly<Partial<Record<SessionSchema.ExecutionEngine, SessionExecution.Interface>>>) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const kernel = yield* Kernel.Service
      return Service.of(make({ ...engines, kernel: kernel.execution }, db))
    }),
  )
