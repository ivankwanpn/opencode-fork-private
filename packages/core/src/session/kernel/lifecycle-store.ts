export * as LifecycleStore from "./lifecycle-store"

import { Context, DateTime, Effect, Layer } from "effect"
import { and, eq, isNull, ne, sql } from "drizzle-orm"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionCommand } from "../command"
import { SessionEvent } from "../event"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionExecutionTable, TaskNotificationOutboxTable, TaskSubmissionTable } from "../sql"
import {
  ConflictError,
  InvariantError,
  PersistenceError,
  StaleExecutionError,
} from "./types"
import type {
  CheckpointInput,
  ExecutionLease,
  ExecutionSnapshot,
  InterruptInput,
  ReconcileInput,
  RecoveryReason,
  StartInput,
  TerminalInput,
  TransitionInput,
  TurnOutcome,
} from "./types"

type DB = Database.Interface["db"]

const fromRow = (row: typeof SessionExecutionTable.$inferSelect): ExecutionSnapshot => ({
  sessionID: SessionSchema.ID.make(row.session_id),
  engine: "kernel",
  generation: row.generation,
  lease:
    row.lease_token === null
      ? undefined
      : { sessionID: SessionSchema.ID.make(row.session_id), generation: row.generation, token: row.lease_token },
  processIncarnation: row.process_incarnation ?? undefined,
  state: row.state,
  phase: row.phase ?? undefined,
  turnID: row.turn_id ? SessionMessage.ID.make(row.turn_id) : undefined,
  inputID: row.input_id ? SessionMessage.ID.make(row.input_id) : undefined,
  attemptID: row.attempt_id ? EventV2.ID.make(row.attempt_id) : undefined,
  assistantMessageID: row.assistant_message_id ? SessionMessage.ID.make(row.assistant_message_id) : undefined,
  retryAt: row.retry_at === null ? undefined : DateTime.makeUnsafe(row.retry_at),
  recoveryReason: (row.recovery_reason as RecoveryReason | null) ?? undefined,
  startedSeq: row.started_seq ?? undefined,
  updatedSeq: row.updated_seq ?? undefined,
  timeUpdated: DateTime.makeUnsafe(row.time_updated),
})

const attemptOutcome = (outcome: TurnOutcome): "completed" | "failed" | "interrupted" | "abandoned" => {
  if (outcome === "completed") return "completed"
  if (outcome === "error") return "failed"
  if (outcome === "cancelled") return "interrupted"
  return "abandoned"
}

const taskStatus = (outcome: TurnOutcome): "completed" | "error" | "cancelled" | "recovery-required" => outcome

export interface Interface {
  readonly get: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<ExecutionSnapshot, SessionCommand.NotFoundError>
  readonly start: (input: StartInput) => Effect.Effect<ExecutionLease, ConflictError | InvariantError>
  readonly transition: (input: TransitionInput) => Effect.Effect<ExecutionSnapshot, StaleExecutionError>
  readonly checkpoint: (input: CheckpointInput) => Effect.Effect<readonly EventV2.Payload[], StaleExecutionError>
  readonly terminalize: (input: TerminalInput) => Effect.Effect<ExecutionSnapshot, StaleExecutionError>
  readonly acceptInterrupt: (input: InterruptInput) => Effect.Effect<ExecutionSnapshot, PersistenceError>
  /** Fenced recovery application for an absent owner; never used by live execution. */
  readonly reconcile: (input: ReconcileInput) => Effect.Effect<ExecutionSnapshot, StaleExecutionError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/LifecycleStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const get = Effect.fn("LifecycleStore.get")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select()
        .from(SessionExecutionTable)
        .where(eq(SessionExecutionTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new SessionCommand.NotFoundError({ sessionID })
      return fromRow(row)
    })

    const stale = (lease: ExecutionLease, expectedState: string) =>
      new StaleExecutionError({
        sessionID: lease.sessionID,
        generation: lease.generation,
        expectedState,
      })

    const catchCoordinationDefects = <A, E>(
      effect: Effect.Effect<A, E, never>,
      expected: ReadonlyArray<new (...args: never[]) => Error>,
    ) =>
      effect.pipe(
        Effect.catchDefect((defect) =>
          expected.some((type) => defect instanceof type) ? Effect.fail(defect as never) : Effect.die(defect),
        ),
      )

    const start = Effect.fn("LifecycleStore.start")(function* (input: StartInput) {
      const admitted = yield* SessionInput.find(db, input.inputID)
      if (!admitted || admitted.sessionID !== input.sessionID)
        return yield* new InvariantError({
          sessionID: input.sessionID,
          message: `Input ${input.inputID} is not admitted to this Session`,
        })
      if (admitted.promotedSeq !== undefined)
        return yield* new ConflictError({
          sessionID: input.sessionID,
          message: `Input ${input.inputID} was already promoted`,
        })
      const token = crypto.randomUUID()
      const now = yield* DateTime.now
      const payloads = yield* catchCoordinationDefects(
        events.publishBatch({
          aggregateID: input.sessionID,
          events: [
            {
              definition: SessionEvent.Prompted,
              data: {
                sessionID: input.sessionID,
                timestamp: admitted.timeCreated,
                messageID: input.inputID,
                prompt: admitted.prompt,
                synthetic: admitted.synthetic,
                delivery: admitted.delivery,
                intent: admitted.intent,
              },
            },
            { definition: SessionEvent.Turn.Started, data: { sessionID: input.sessionID, timestamp: now, turnID: input.turnID } },
            {
              definition: SessionEvent.ProviderAttempt.Started,
              data: {
                sessionID: input.sessionID,
                timestamp: now,
                attemptID: input.attemptID,
                assistantMessageID: input.assistantMessageID,
                attempt: 1,
              },
            },
          ],
          commit: ({ firstSeq, finalSeq }) =>
            db
              .update(SessionExecutionTable)
              .set({
                generation: sql`${SessionExecutionTable.generation} + 1`,
                lease_token: token,
                process_incarnation: input.processIncarnation,
                state: "active",
                phase: "dispatching",
                turn_id: input.turnID,
                input_id: input.inputID,
                attempt_id: input.attemptID,
                assistant_message_id: input.assistantMessageID,
                started_seq: firstSeq,
                updated_seq: finalSeq,
                time_updated: DateTime.toEpochMillis(now),
              })
              .where(
                and(
                  eq(SessionExecutionTable.session_id, input.sessionID),
                  eq(SessionExecutionTable.state, "idle"),
                  isNull(SessionExecutionTable.lease_token),
                ),
              )
              .returning({ sessionID: SessionExecutionTable.session_id })
              .get()
              .pipe(
                Effect.orDie,
                Effect.flatMap((row) =>
                  row
                    ? Effect.void
                    : Effect.die(
                        new ConflictError({
                          sessionID: input.sessionID,
                          message: "Session execution is not idle; another owner holds it",
                        }),
                      ),
                ),
              ),
        }),
        [ConflictError, InvariantError],
      )
      if (payloads.length !== 3)
        return yield* new InvariantError({
          sessionID: input.sessionID,
          message: `Atomic start committed ${payloads.length} events instead of 3`,
        })
      const snapshot = yield* get(input.sessionID).pipe(
        Effect.catchTag("Session.NotFoundError", () =>
          Effect.die(
            new InvariantError({
              sessionID: input.sessionID,
              message: "Atomic start committed but the execution row is missing",
            }),
          ),
        ),
      )
      return { sessionID: input.sessionID, generation: snapshot.generation, token } satisfies ExecutionLease
    })

    const transition = Effect.fn("LifecycleStore.transition")(function* (input: TransitionInput) {
      const now = yield* DateTime.now
      yield* catchCoordinationDefects(
        events.publishBatch({
          aggregateID: input.lease.sessionID,
          events: input.events,
          commit: ({ finalSeq }) =>
            db
              .update(SessionExecutionTable)
              .set({
                state: input.state,
                phase: input.phase ?? null,
                retry_at: input.retryAt ? DateTime.toEpochMillis(input.retryAt) : null,
                recovery_reason: input.recoveryReason ?? null,
                updated_seq: finalSeq,
                time_updated: DateTime.toEpochMillis(now),
              })
              .where(
                and(
                  eq(SessionExecutionTable.session_id, input.lease.sessionID),
                  eq(SessionExecutionTable.generation, input.lease.generation),
                  eq(SessionExecutionTable.lease_token, input.lease.token),
                  eq(SessionExecutionTable.state, input.expectedState),
                ),
              )
              .returning({ sessionID: SessionExecutionTable.session_id })
              .get()
              .pipe(
                Effect.orDie,
                Effect.flatMap((row) =>
                  row ? Effect.void : Effect.die(stale(input.lease, input.expectedState)),
                ),
              ),
        }),
        [StaleExecutionError],
      )
      return yield* get(input.lease.sessionID).pipe(
        Effect.catchTag("Session.NotFoundError", () =>
          Effect.die(
            new InvariantError({
              sessionID: input.lease.sessionID,
              message: "Transition committed but the execution row is missing",
            }),
          ),
        ),
      )
    })

    const checkpoint = Effect.fn("LifecycleStore.checkpoint")(function* (input: CheckpointInput) {
      const now = yield* DateTime.now
      const payloads = yield* catchCoordinationDefects(
        events.publishBatch({
          aggregateID: input.lease.sessionID,
          events: input.events,
          commit: ({ finalSeq }) =>
            db
              .update(SessionExecutionTable)
              .set({ updated_seq: finalSeq, time_updated: DateTime.toEpochMillis(now) })
              .where(
                and(
                  eq(SessionExecutionTable.session_id, input.lease.sessionID),
                  eq(SessionExecutionTable.generation, input.lease.generation),
                  eq(SessionExecutionTable.lease_token, input.lease.token),
                ),
              )
              .returning({ sessionID: SessionExecutionTable.session_id })
              .get()
              .pipe(
                Effect.orDie,
                Effect.flatMap((row) =>
                  row ? Effect.void : Effect.die(stale(input.lease, "any")),
                ),
              ),
        }),
        [StaleExecutionError],
      )
      return payloads
    })

    const terminalize = Effect.fn("LifecycleStore.terminalize")(function* (input: TerminalInput) {
      const snapshot = yield* get(input.lease.sessionID).pipe(
        Effect.catchTag("Session.NotFoundError", () =>
          Effect.die(
            new InvariantError({
              sessionID: input.lease.sessionID,
              message: "Cannot terminalize a missing execution row",
            }),
          ),
        ),
      )
      // Idempotent: an idle execution was already terminalized (by this lease or
      // a fenced one); returning the snapshot cannot duplicate terminal facts.
      if (snapshot.state === "idle") return snapshot
      // A lease that no longer owns the execution is fenced; its terminal
      // settlement must fail loudly instead of racing the current owner.
      if (snapshot.generation !== input.lease.generation || snapshot.lease?.token !== input.lease.token)
        return yield* Effect.fail(stale(input.lease, snapshot.state))
      if (
        snapshot.state !== "active" ||
        !snapshot.attemptID ||
        !snapshot.turnID ||
        !snapshot.inputID ||
        !snapshot.assistantMessageID
      )
        return yield* Effect.die(
          new InvariantError({
            sessionID: input.lease.sessionID,
            message: `Cannot terminalize execution in state ${snapshot.state} with incomplete identities`,
          }),
        )
      const now = yield* DateTime.now
      const outcome = attemptOutcome(input.outcome)
      yield* catchCoordinationDefects(
        events.publishBatch({
          aggregateID: input.lease.sessionID,
          events: [
            {
              definition: SessionEvent.ProviderAttempt.Ended,
              data: {
                sessionID: input.lease.sessionID,
                timestamp: now,
                attemptID: snapshot.attemptID,
                assistantMessageID: snapshot.assistantMessageID,
                outcome,
                continuation: false,
                error: input.error,
              },
            },
            {
              definition: SessionEvent.Turn.Ended,
              data: {
                sessionID: input.lease.sessionID,
                timestamp: now,
                turnID: snapshot.turnID,
                outcome,
              },
            },
            {
              definition: SessionEvent.Input.Terminalized,
              data: {
                sessionID: input.lease.sessionID,
                timestamp: now,
                inputID: snapshot.inputID,
                outcome: input.outcome,
                resultMessageID: input.resultMessageID,
                error: input.error,
              },
            },
          ],
          commit: ({ finalSeq }) =>
            Effect.gen(function* () {
              const updated = yield* db
                .update(SessionExecutionTable)
                .set({
                  state: "idle",
                  phase: null,
                  lease_token: null,
                  turn_id: null,
                  input_id: null,
                  attempt_id: null,
                  assistant_message_id: null,
                  retry_at: null,
                  recovery_reason: null,
                  updated_seq: finalSeq,
                  time_updated: DateTime.toEpochMillis(now),
                })
                .where(
                  and(
                    eq(SessionExecutionTable.session_id, input.lease.sessionID),
                    eq(SessionExecutionTable.generation, input.lease.generation),
                    eq(SessionExecutionTable.lease_token, input.lease.token),
                  ),
                )
                .returning({ sessionID: SessionExecutionTable.session_id })
                .get()
                .pipe(Effect.orDie)
              if (!updated) return yield* Effect.die(stale(input.lease, "active"))
              if (input.task) {
                yield* db
                  .update(TaskSubmissionTable)
                  .set({
                    status: taskStatus(input.outcome),
                    outcome: input.outcome,
                    result_message_id: input.task.resultMessageID ?? null,
                    error: input.error ?? null,
                    time_completed: DateTime.toEpochMillis(now),
                  })
                  .where(eq(TaskSubmissionTable.id, input.task.submissionID))
                  .run()
                  .pipe(Effect.orDie)
              }
              if (input.outbox) {
                yield* db
                  .insert(TaskNotificationOutboxTable)
                  .values({
                    id: input.outbox.id,
                    submission_id: input.outbox.submissionID,
                    parent_session_id: input.outbox.parentSessionID,
                    message_id: input.outbox.messageID,
                    payload: { outcome: input.outcome, messageID: input.outbox.messageID },
                    status: "pending",
                    attempts: 0,
                    time_created: DateTime.toEpochMillis(now),
                  })
                  .onConflictDoNothing()
                  .run()
                  .pipe(Effect.orDie)
              }
            }),
        }),
        [StaleExecutionError],
      )
      return yield* get(input.lease.sessionID).pipe(
        Effect.catchTag("Session.NotFoundError", () =>
          Effect.die(
            new InvariantError({
              sessionID: input.lease.sessionID,
              message: "Terminalization committed but the execution row is missing",
            }),
          ),
        ),
      )
    })

    const acceptInterrupt = Effect.fn("LifecycleStore.acceptInterrupt")(function* (input: InterruptInput) {
      const now = yield* DateTime.now
      const updated = yield* db
        .update(SessionExecutionTable)
        .set({
          generation: sql`${SessionExecutionTable.generation} + 1`,
          lease_token: null,
          state: "cancelling",
          time_updated: DateTime.toEpochMillis(now),
        })
        .where(
          and(
            eq(SessionExecutionTable.session_id, input.sessionID),
            input.expectedGeneration === undefined
              ? undefined
              : eq(SessionExecutionTable.generation, input.expectedGeneration),
            ne(SessionExecutionTable.state, "idle"),
            ne(SessionExecutionTable.state, "cancelling"),
          ),
        )
        .returning()
        .get()
        .pipe(
          Effect.orDie,
          Effect.catchDefect((defect) =>
            Effect.die(new PersistenceError({ sessionID: input.sessionID, message: String(defect) })),
          ),
        )
      if (updated) return fromRow(updated)
      // Idempotent: the fence is already in place (idle, cancelling, or a newer
      // generation won the race); return the current snapshot unchanged.
      return yield* get(input.sessionID).pipe(
        Effect.catchTag(
          "Session.NotFoundError",
          () => new PersistenceError({ sessionID: input.sessionID, message: "Session execution row not found" }),
        ),
      )
    })

    const reconcile = Effect.fn("LifecycleStore.reconcile")(function* (input: ReconcileInput) {
      const now = yield* DateTime.now
      yield* catchCoordinationDefects(
        events.publishBatch({
          aggregateID: input.sessionID,
          expectedSeq: input.expectedSeq,
          events: input.events,
          commit: ({ finalSeq }) =>
            Effect.gen(function* () {
              const updated = yield* db
                .update(SessionExecutionTable)
                .set({
                  state: input.state,
                  phase: null,
                  lease_token: null,
                  retry_at: null,
                  recovery_reason: input.recoveryReason ?? null,
                  ...(input.state === "idle"
                    ? {
                        turn_id: null,
                        input_id: null,
                        attempt_id: null,
                        assistant_message_id: null,
                        started_seq: null,
                      }
                    : {}),
                  updated_seq: finalSeq,
                  time_updated: DateTime.toEpochMillis(now),
                })
                .where(
                  and(
                    eq(SessionExecutionTable.session_id, input.sessionID),
                    eq(SessionExecutionTable.generation, input.expectedGeneration),
                  ),
                )
                .returning({ sessionID: SessionExecutionTable.session_id })
                .get()
                .pipe(Effect.orDie)
              if (!updated)
                return yield* Effect.die(
                  new StaleExecutionError({
                    sessionID: input.sessionID,
                    generation: input.expectedGeneration,
                    expectedState: input.state,
                  }),
                )
            }),
        }),
        [StaleExecutionError],
      )
      return yield* get(input.sessionID).pipe(
        Effect.catchTag("Session.NotFoundError", () =>
          Effect.die(
            new InvariantError({
              sessionID: input.sessionID,
              message: "Reconciliation committed but the execution row is missing",
            }),
          ),
        ),
      )
    })

    return Service.of({ get, start, transition, checkpoint, terminalize, acceptInterrupt, reconcile })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node],
})
