export * as RecoveryExecutor from "./recovery-executor"

import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { SessionInputTable, TaskSubmissionTable } from "../sql"
import { LifecycleStore } from "./lifecycle-store"
import type { RecoveryPlan, RecoveryAction } from "./recovery-planner"
import type { ExecutionSnapshot } from "./types"
import { ownsExecution } from "./incarnation"

/** The plan's generation/sequence/owner revalidation failed; the plan is stale. */
export class RecoveryPlanStaleError extends Schema.TaggedErrorClass<RecoveryPlanStaleError>()(
  "RecoveryPlanStaleError",
  {
    sessionID: SessionSchema.ID,
    expectedGeneration: Schema.Number,
    expectedSeq: Schema.Number,
  },
) {}

export interface Interface {
  /** Revalidates generation, sequence, and owner absence, then applies the plan. */
  readonly apply: (plan: RecoveryPlan) => Effect.Effect<void, RecoveryPlanStaleError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RecoveryExecutor") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const lifecycle = yield* LifecycleStore.Service

    const apply = Effect.fn("RecoveryExecutor.apply")(function* (plan: RecoveryPlan) {
      const stale = () =>
        new RecoveryPlanStaleError({
          sessionID: plan.sessionID,
          expectedGeneration: plan.generation,
          expectedSeq: plan.latestSeq,
        })
      // A fenced commit mid-apply means the plan went stale between
      // revalidation and application.
      yield* Effect.gen(function* () {
        // Revalidation: the execution must still carry the planned generation
        // and sequence, and a non-idle plan must not race a live owner.
        const snapshot = yield* lifecycle
          .get(plan.sessionID)
          .pipe(
            Effect.catchTag("Session.NotFoundError", () =>
              Effect.die(`Recovery target session vanished: ${plan.sessionID}`),
            ),
          )
        const latestSeq = yield* EventV2.latestSequence(db, plan.sessionID)
        if (
          snapshot.generation !== plan.generation ||
          latestSeq !== plan.latestSeq ||
          (plan.classification !== "no-action" && ownsExecution(snapshot))
        )
          return yield* Effect.fail(stale())
        // Terminal-evidence classifications clear the stale coordination row
        // without re-publishing anything the event log already records.
        if (plan.classification === "settle-from-durable-output" || plan.classification === "abandon") {
          yield* lifecycle.reconcile({
            sessionID: plan.sessionID,
            expectedGeneration: plan.generation,
            expectedSeq: plan.latestSeq,
            events: [],
            state: "idle",
          })
          return
        }
        for (const action of plan.actions) yield* applyAction(action, plan, snapshot)
      }).pipe(Effect.catchTag("StaleExecutionError", () => Effect.fail(stale())))
    })

    const applyAction = Effect.fn("RecoveryExecutor.applyAction")(function* (
      action: RecoveryAction,
      plan: RecoveryPlan,
      snapshot: ExecutionSnapshot,
    ) {
      if (action.type === "mark-recovery-required") {
        yield* lifecycle.reconcile({
          sessionID: plan.sessionID,
          expectedGeneration: plan.generation,
          expectedSeq: plan.latestSeq,
          events: [],
          state: "needs_recovery",
          recoveryReason: action.reason,
        })
        return
      }
      if (action.type === "abandon") {
        yield* lifecycle.reconcile({
          sessionID: plan.sessionID,
          expectedGeneration: plan.generation,
          expectedSeq: plan.latestSeq,
          events: [],
          state: "idle",
        })
        return
      }
      if (action.type === "terminalize-from-output") {
        if (!snapshot.attemptID || !snapshot.turnID || !snapshot.inputID || !snapshot.assistantMessageID)
          return yield* Effect.die(`Cannot terminalize-from-output without complete identities: ${plan.sessionID}`)
        const timestamp = yield* DateTime.now
        yield* lifecycle.reconcile({
          sessionID: plan.sessionID,
          expectedGeneration: plan.generation,
          expectedSeq: plan.latestSeq,
          state: "idle",
          events: [
            {
              definition: SessionEvent.ProviderAttempt.Ended,
              data: {
                sessionID: plan.sessionID,
                timestamp,
                attemptID: snapshot.attemptID,
                assistantMessageID: snapshot.assistantMessageID,
                outcome: "completed",
                continuation: false,
              },
            },
            {
              definition: SessionEvent.Turn.Ended,
              data: {
                sessionID: plan.sessionID,
                timestamp,
                turnID: snapshot.turnID,
                outcome: "completed",
              },
            },
            {
              definition: SessionEvent.Input.Terminalized,
              data: {
                sessionID: plan.sessionID,
                timestamp,
                inputID: snapshot.inputID,
                outcome: "completed",
                resultMessageID: action.messageID,
              },
            },
          ],
        })
        return
      }
      if (action.type === "repair-task") {
        // Idempotent read-model reconciliation: a submission without an outcome
        // whose child input already terminalized inherits that terminal fact.
        const submission = yield* db
          .select({
            childInputID: TaskSubmissionTable.child_input_id,
            outcome: TaskSubmissionTable.outcome,
          })
          .from(TaskSubmissionTable)
          .where(eq(TaskSubmissionTable.id, action.submissionID))
          .get()
          .pipe(Effect.orDie)
        if (submission && submission.outcome === null) {
          const terminal = yield* db
            .select({ outcome: SessionInputTable.terminal_outcome })
            .from(SessionInputTable)
            .where(eq(SessionInputTable.id, submission.childInputID))
            .get()
            .pipe(Effect.orDie)
          if (terminal?.outcome) {
            yield* db
              .update(TaskSubmissionTable)
              .set({
                status: terminal.outcome === "recovery-required" ? "recovery-required" : terminal.outcome,
                outcome: terminal.outcome,
              })
              .where(eq(TaskSubmissionTable.id, action.submissionID))
              .run()
              .pipe(Effect.orDie)
          }
        }
        return
      }
      // repair-outbox: delivery machinery arrives with Task 10/11; the row stays
      // pending so a later wake can still deliver it. This is an idempotent no-op.
    })

    return Service.of({ apply })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, LifecycleStore.node],
})
