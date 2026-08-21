export * as SessionExecution from "./execution"

import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Node } from "../effect/app-node"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"
import { SessionExecutionRouter } from "./execution/router"
import { SessionCommand } from "./command"
import { Kernel } from "./kernel"
import { LifecycleStore } from "./kernel/lifecycle-store"
import { RecoveryExecutor } from "./kernel/recovery-executor"
import { RecoveryPlanner } from "./kernel/recovery-planner"

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("Session.ExecutionBusyError", {
  sessionID: SessionSchema.ID,
}) {}

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<void, SessionRunner.RunError | SessionCommand.NotFoundError | SessionSchema.KernelUnavailableError>
  /** Runs non-drain work only while idle under the same ownership and interrupt boundary. */
  readonly exclusive: <E>(
    sessionID: SessionSchema.ID,
    work: Effect.Effect<void, E>,
  ) => Effect.Effect<void, E | BusyError | SessionCommand.NotFoundError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Waits for current ownership and all registered successors without starting execution. */
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

/**
 * Routing facade: every call resolves the Session's stored engine and delegates
 * to the matching implementation. Kernel resolution fails with
 * KernelUnavailableError while the Kernel engine is not installed. `active`
 * unions the snapshots of every registered engine.
 */
export const routingFacade = (router: SessionExecutionRouter.Interface): Interface => {
  const unresolvedNoop = (sessionID: SessionSchema.ID, work: (engine: Interface) => Effect.Effect<void>) =>
    router.resolve(sessionID).pipe(
      Effect.flatMap((engine) => work(engine)),
      Effect.catchTags({
        KernelUnavailableError: () => Effect.void,
        "Session.NotFoundError": () => Effect.void,
      }),
    )
  return {
    active: router.active,
    resume: (sessionID) => router.resolve(sessionID).pipe(Effect.flatMap((engine) => engine.resume(sessionID))),
    exclusive: (sessionID, work) =>
      router.resolve(sessionID).pipe(
        Effect.flatMap((engine) => engine.exclusive(sessionID, work)),
        // Kernel Sessions cannot run Classic non-drain work (shell, compaction,
        // recovery); surface the missing capability as busy while Kernel is
        // not installed.
        Effect.catchTag("KernelUnavailableError", () => Effect.fail(new BusyError({ sessionID }))),
      ),
    wake: (sessionID) => unresolvedNoop(sessionID, (engine) => engine.wake(sessionID)),
    wait: (sessionID) => unresolvedNoop(sessionID, (engine) => engine.wait(sessionID)),
    interrupt: (sessionID) => unresolvedNoop(sessionID, (engine) => engine.interrupt(sessionID)),
  }
}

/** Provides the routing facade over the engines registered with the router. */
export const routingLayer = (
  engines: Readonly<Partial<Record<SessionSchema.ExecutionEngine, Interface>>>,
) => {
  // Replacement layers compile with no dependencies, so the router's
  // Database/EventV2/LifecycleStore/Kernel requirements are closed inside
  // against the graph's own nodes (mirroring the flaky-events layer in
  // session-create tests). Each provide builds its provider first, so the
  // closure is composed from the leaves up.
  const eventV2Closed = (EventV2.node.implementation as Layer.Layer<EventV2.Service>).pipe(
    Layer.provide(Database.node.implementation as Layer.Layer<Database.Service>),
  )
  const lifecycleClosed = (LifecycleStore.node.implementation as Layer.Layer<LifecycleStore.Service>).pipe(
    Layer.provide(eventV2Closed),
  )
  const plannerClosed = (RecoveryPlanner.node.implementation as Layer.Layer<RecoveryPlanner.Service>).pipe(
    Layer.provide(lifecycleClosed),
  )
  const executorClosed = (RecoveryExecutor.node.implementation as Layer.Layer<RecoveryExecutor.Service>).pipe(
    Layer.provide(lifecycleClosed),
  )
  const kernelClosed = (Kernel.node.implementation as Layer.Layer<Kernel.Service>).pipe(
    Layer.provide(
      Layer.mergeAll(
        lifecycleClosed,
        plannerClosed,
        executorClosed,
        Database.node.implementation as Layer.Layer<Database.Service>,
      ),
    ),
  )
  const routerClosed = SessionExecutionRouter.layer(engines).pipe(
    Layer.provide(kernelClosed),
  )
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const router = yield* SessionExecutionRouter.Service
      return Service.of(routingFacade(router))
    }),
  )
    .pipe(Layer.provide(routerClosed))
    .pipe(Layer.provide(Database.node.implementation as Layer.Layer<Database.Service>))
}

/** Routes execution from a Session ID to the runner owned by that Session's Location. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionExecution") {}

export const node = LayerNode.unbound(Service, Node.tags.values.global)

export const Current = Context.Reference<Interface | undefined>("@opencode/v2/SessionExecution/Current", {
  defaultValue: () => undefined,
})

const current = Effect.flatMap(Current, (service) =>
  service ? Effect.succeed(service) : Effect.die("Session execution is unavailable outside an active V2 drain"),
)

/**
 * Location services are constructed before the process-global execution
 * coordinator can close over their map. Resolve that coordinator from the
 * active drain instead of binding V2 tools to the recording-only V1 seam.
 */
export const forwardingLayer = Layer.succeed(
  Service,
  Service.of({
    active: current.pipe(Effect.flatMap((service) => service.active)),
    resume: (sessionID) => current.pipe(Effect.flatMap((service) => service.resume(sessionID))),
    exclusive: (sessionID, work) => current.pipe(Effect.flatMap((service) => service.exclusive(sessionID, work))),
    wake: (sessionID) => current.pipe(Effect.flatMap((service) => service.wake(sessionID))),
    wait: (sessionID) => current.pipe(Effect.flatMap((service) => service.wait(sessionID))),
    interrupt: (sessionID) => current.pipe(Effect.flatMap((service) => service.interrupt(sessionID))),
  }),
)

/** Low-level compatibility layer for callers that only need durable Session recording. */
export const noopLayer = Layer.succeed(
  Service,
  Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    exclusive: (_sessionID, work) => work,
    wake: () => Effect.void,
    wait: () => Effect.void,
    interrupt: () => Effect.void,
  }),
)
