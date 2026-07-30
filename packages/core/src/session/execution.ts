export * as SessionExecution from "./execution"

import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Node } from "../effect/app-node"
import { SessionRunner } from "./runner/index"
import { SessionSchema } from "./schema"

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("Session.ExecutionBusyError", {
  sessionID: SessionSchema.ID,
}) {}

export interface Interface {
  /** Snapshots active execution owned by this process. */
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  /** Starts execution while idle or joins the active execution. */
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionRunner.RunError>
  /** Runs non-drain work only while idle under the same ownership and interrupt boundary. */
  readonly exclusive: <E>(
    sessionID: SessionSchema.ID,
    work: Effect.Effect<void, E>,
  ) => Effect.Effect<void, E | BusyError>
  /** Registers newly recorded work. Repeated wakeups may coalesce. */
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Waits for current ownership and all registered successors without starting execution. */
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Interrupt active work owned by this process. Idle interruption is a no-op. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
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
