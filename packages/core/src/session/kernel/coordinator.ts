export * as TurnCoordinator from "./coordinator"

import { Clock, Context, DateTime, Duration, Effect, Layer, Ref, Scope } from "effect"
import { LLM } from "@opencode-ai/llm"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { makeGlobalNode } from "../../effect/app-node"
import { LocationServiceMap } from "../../location-service-map"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { SessionEvent } from "../event"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionRunnerModel } from "../runner/model"
import { SessionCompaction } from "../compaction"
import { toLLMMessages } from "../runner/to-llm-message"
import { SessionRunCoordinator } from "../run-coordinator"
import { LifecycleStore } from "./lifecycle-store"
import { PublicationActor } from "./publication-actor"
import { ProviderReader } from "./provider-reader"
import { processIncarnation } from "./incarnation"

const retryDelayMs = (attempt: number) => Math.min(500 * 2 ** Math.max(0, attempt - 1), 10_000)

export interface Interface {
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly run: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Durable fence first, then abort provider/tool scopes. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Fenced compaction phase: acquire idle, compact, release idle. */
  readonly compact: (sessionID: SessionSchema.ID, reason: "auto" | "manual") => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/TurnCoordinator") {}

/**
 * One process-local coordinator per active Kernel Session: coalesces
 * same-Session wakes, allows different Sessions concurrently, creates the
 * turn cancellation scope, waits for publication and terminal commit, and
 * releases ownership only after durable settlement.
 */
export const make = Effect.fn("TurnCoordinator.make")(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const lifecycle = yield* LifecycleStore.Service
  const reader = yield* ProviderReader.Service
  const store = yield* SessionStore.Service
  const locations = yield* LocationServiceMap.Service
  const scope = yield* Scope.Scope
  // Per-session actor ownership: a global actor ref would let one session's
  // run stamp over another's, so interrupting session A could signal B.
  const currentActors = yield* Ref.make<ReadonlyMap<SessionSchema.ID, PublicationActor.Interface>>(new Map())

  const morePending = Effect.fn("TurnCoordinator.morePending")(function* (sessionID: SessionSchema.ID) {
    if (yield* SessionInput.hasPending(db, sessionID, "steer")) return true
    return yield* SessionInput.hasPending(db, sessionID, "queue")
  })

  const runTurn = Effect.fn("TurnCoordinator.runTurn")(function* (sessionID: SessionSchema.ID) {
    const snapshot = yield* lifecycle.get(sessionID)
    if (snapshot.state !== "idle") return false
    const session = yield* store.get(sessionID)
    if (!session || session.engine !== "kernel") return false
    // Idle promotes exactly one durable input per turn: steers first, then
    // the oldest queue entry. Anything still pending is the next loop pass.
    const steer = yield* SessionInput.pending(db, sessionID, "steer")
    const input = steer[0] ?? (yield* SessionInput.pending(db, sessionID, "queue"))[0]
    if (!input) return false

    const attemptID = EventV2.ID.create()
    const turnID = SessionMessage.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    const lease = yield* lifecycle.start({
      sessionID,
      inputID: input.id,
      turnID,
      attemptID,
      assistantMessageID,
      processIncarnation,
    })

    // The complete owned turn is interruptible, including retry backoff and
    // model/history preparation. Durable writes are already atomic and
    // uninterruptible at EventV2's transaction boundary; keeping the rest of
    // the turn masked would make the stop button wait for retry timers or a
    // blocked dependency before the cancellation finalizer can settle.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        let currentAttempt = attemptID
        let attemptNumber = 1
        let actor: PublicationActor.Interface | undefined
        let result: ProviderReader.ProviderTurnResult = { kind: "completed" }

        // One bounded retry for Task 5; later tasks generalize the retry budget.
        for (let round = 0; round < 2; round++) {
          const model = yield* SessionRunnerModel.Service.use((models) => models.resolve(session)).pipe(
            Effect.provide(locations.get(session.location)),
            Effect.orDie,
          )
          const history = yield* store.context(sessionID)
          const request = LLM.request({ model, messages: toLLMMessages(history, model) })
          const turnActor = yield* PublicationActor.make(events, {
            sessionID,
            attemptID: currentAttempt,
            assistantMessageID,
            agent: session.agent ?? "build",
            model: session.model ?? ModelV2.Ref.make({ id: ModelV2.ID.make(""), providerID: ProviderV2.ID.make("") }),
            location: session.location,
            // Incremental durable checkpoints commit under the current lease.
            // Once the interrupt fence fires, the lease is stale: the remaining
            // incremental content is dropped — the fenced settle publishes the
            // authoritative Ended full value instead.
            flush: (items) =>
              lifecycle.checkpoint({ lease, events: items }).pipe(
                Effect.catchTag("StaleExecutionError", () =>
                  Effect.logWarning("Dropping checkpoint for fenced lease", {
                    sessionID,
                    generation: lease.generation,
                  }).pipe(Effect.asVoid),
                ),
                Effect.asVoid,
              ),
          }).pipe(Effect.provideService(Scope.Scope, scope))
          actor = turnActor
          yield* Ref.update(currentActors, (map) => new Map(map).set(sessionID, turnActor))
          result = yield* reader.run({ actor: turnActor, request })
          yield* Ref.update(currentActors, (map) => {
            const next = new Map(map)
            next.delete(sessionID)
            return next
          })
          if (result.kind !== "error" || !result.retryable) break

          const now = yield* Clock.currentTimeMillis
          const delay = retryDelayMs(attemptNumber)
          yield* lifecycle.transition({
            lease,
            expectedState: "active",
            state: "retry_wait",
            retryAt: DateTime.makeUnsafe(now + delay),
            events: [
              // Each provider attempt is terminal before the next starts:
              // attempt-1 closes here, the row switches to attempt-2 below,
              // and the final terminalize closes attempt-2 exactly once.
              {
                definition: SessionEvent.ProviderAttempt.Ended,
                data: {
                  sessionID,
                  timestamp: DateTime.makeUnsafe(now),
                  attemptID: currentAttempt,
                  assistantMessageID,
                  outcome: "failed",
                  continuation: false,
                },
              },
              {
                definition: SessionEvent.Retried,
                data: {
                  sessionID,
                  timestamp: DateTime.makeUnsafe(now),
                  attemptID: currentAttempt,
                  attempt: attemptNumber + 1,
                  next: DateTime.makeUnsafe(now + delay),
                  error: {
                    message: String((result.error.data as { message?: unknown } | undefined)?.message ?? result.error.name),
                    isRetryable: true,
                  },
                },
              },
            ],
          })
          yield* Effect.sleep(Duration.millis(delay))
          const nextAttempt = EventV2.ID.create()
          yield* lifecycle.transition({
            lease,
            expectedState: "retry_wait",
            state: "active",
            phase: "dispatching",
            attemptID: nextAttempt,
            events: [
              {
                definition: SessionEvent.ProviderAttempt.Started,
                data: {
                  sessionID,
                  timestamp: yield* DateTime.now,
                  attemptID: nextAttempt,
                  assistantMessageID,
                  attempt: attemptNumber + 1,
                  retryOf: currentAttempt,
                },
              },
            ],
          })
          currentAttempt = nextAttempt
          attemptNumber += 1
        }

        const finalActor = actor
        if (finalActor) yield* finalActor.barrier
        if (result.kind === "interrupted") {
          if (finalActor) yield* finalActor.close("cancelled")
          yield* settleAfterInterrupt(sessionID)
          return yield* morePending(sessionID)
        }
        if (result.kind === "error") {
          if (finalActor) yield* finalActor.close("error")
          yield* lifecycle.terminalize({
            lease,
            outcome: "error",
            error: result.error,
          })
          return false
        }
        if (finalActor) yield* finalActor.close("completed")
        yield* lifecycle.terminalize({
          lease,
          outcome: "completed",
          resultMessageID: assistantMessageID,
        })
        return yield* morePending(sessionID)
      }).pipe(
        restore,
        // Fiber interruption skips the ordinary return path from any phase of
        // the turn. Settle the durable fence once, then always release the
        // process-local actor ownership entry.
        Effect.onInterrupt(() =>
          settleAfterInterrupt(sessionID).pipe(
            Effect.catchCause((cause) => Effect.logWarning("Kernel interrupt settlement failed", { sessionID, cause })),
          ),
        ),
        Effect.ensuring(
          Ref.update(currentActors, (map) => {
            const next = new Map(map)
            next.delete(sessionID)
            return next
          }),
        ),
      ),
    )
  })

  const settleAfterInterrupt = Effect.fn("TurnCoordinator.settleAfterInterrupt")(function* (
    sessionID: SessionSchema.ID,
  ) {
    const current = yield* lifecycle.get(sessionID)
    if (current.state === "idle") return
    // The durable fence cleared the lease and moved the row to cancelling;
    // settle under the fenced generation.
    yield* lifecycle.settle({
      sessionID,
      expectedGeneration: current.generation,
      outcome: "cancelled",
    })
  })

  const compact = Effect.fn("TurnCoordinator.compact")(function* (
    sessionID: SessionSchema.ID,
    reason: "auto" | "manual",
  ) {
    const session = yield* store.get(sessionID)
    if (!session || session.engine !== "kernel") return
    const lease = yield* lifecycle.acquireIdle(sessionID, "compacting").pipe(Effect.orDie)
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const compaction = yield* SessionCompaction.Service.use((service) => Effect.succeed(service)).pipe(
          Effect.provide(locations.get(session.location)),
        )
        yield* restore(compaction.compact({ session, reason }).pipe(Effect.orDie))
      }).pipe(
        Effect.ensuring(
          lifecycle.releaseIdle(lease).pipe(
            // A fenced release only means a newer owner already took over; the
            // durable compaction facts still stand.
            Effect.catchTag("StaleExecutionError", () => Effect.void),
          ),
        ),
      ),
    )
  })

  const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, never>({
    drain: (sessionID) =>
      // The drain absorbs its own interruption: the interrupt fence is
      // accepted by the store first, the reader stops interruptibly, the
      // settlement runs uninterruptibly (inside runTurn), and the drained
      // cause is consumed so the drain completes successfully.
      Effect.uninterruptibleMask((restore) =>
        restore(
          Effect.gen(function* () {
            // Durable pending check drives the loop instead of an effect
            // return value: each pass runs one fenced turn and promotes at
            // most one queue entry, so FIFO delivery is stable across turns.
            let pending = yield* morePending(sessionID)
            while (pending) {
              yield* runTurn(sessionID)
              pending = yield* morePending(sessionID)
            }
          }),
        )
          .pipe(
            // The catch runs uninterruptibly so a pending interrupt from the
            // drain is consumed here and the drain completes successfully.
            Effect.catchCause((cause) =>
              Effect.logWarning("Kernel turn failed", { sessionID, cause }).pipe(Effect.asVoid),
            ),
          ),
      ),
  })

  const interrupt = Effect.fn("TurnCoordinator.interrupt")(function* (sessionID: SessionSchema.ID) {
    // Durable fence before any cancellation work; the UI may only claim the
    // interrupt accepted after this commits. Persistence failure surfaces as a
    // defect so acceptance is never claimed silently.
    const snapshot = yield* lifecycle.get(sessionID).pipe(
      Effect.catchTag("Session.NotFoundError", () => Effect.die(`Session execution not found: ${sessionID}`)),
    )
    yield* lifecycle
      .acceptInterrupt({
        sessionID,
        expectedGeneration: snapshot.generation,
        reason: "user",
      })
      .pipe(Effect.catchTag("PersistenceError", (error) => Effect.die(error)))
    // Signal the actor (high-priority ingress) so the provider reader stops at
    // its next event, and interrupt the session's own drain fiber so a
    // provider stream blocked on the network is cancelled without waiting for
    // the next event. Accepted returns after the fence, not settlement; the
    // reader's own interrupt is consumed by the drain's uninterruptible catch.
    const actors = yield* Ref.get(currentActors)
    const actor = actors.get(sessionID)
    if (actor) yield* actor.interrupt("user")
    yield* coordinator.interrupt(sessionID)
  })

  return {
    active: coordinator.active,
    run: coordinator.run,
    wake: coordinator.wake,
    wait: coordinator.wait,
    interrupt,
    compact,
  } satisfies Interface
})

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    EventV2.node,
    LifecycleStore.node,
    ProviderReader.node,
    SessionStore.node,
    LocationServiceMap.node,
  ],
})
