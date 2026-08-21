export * as RecoveryPlanner from "./recovery-planner"

import { Context, Effect, Layer } from "effect"
import { and, asc, eq, gte } from "drizzle-orm"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { EventTable } from "../../event/sql"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionCommand } from "../command"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import { LifecycleStore } from "./lifecycle-store"
import type { ExecutionSnapshot, RecoveryReason } from "./types"
import { processIncarnation } from "./incarnation"

export type RecoveryClassification =
  | "no-action"
  | "settle-from-durable-output"
  | "safe-to-resume"
  | "needs-user-decision"
  | "abandon"

export type RecoveryAction =
  | { readonly type: "terminalize-from-output"; readonly messageID: SessionMessage.ID }
  | { readonly type: "mark-recovery-required"; readonly reason: RecoveryReason }
  | { readonly type: "abandon"; readonly reason: RecoveryReason }
  | { readonly type: "repair-task"; readonly submissionID: string }
  | { readonly type: "repair-outbox"; readonly outboxID: string }

export interface RecoveryEvidence {
  readonly execution: ExecutionSnapshot
  readonly latestSeq: number
  readonly durableTypes: readonly string[]
  readonly ownerPresent: boolean
  readonly projectedOutputComplete: boolean
  readonly uncertainMutation: boolean
}

export interface RecoveryPlan {
  readonly sessionID: SessionSchema.ID
  readonly generation: number
  readonly latestSeq: number
  readonly classification: RecoveryClassification
  readonly evidence: RecoveryEvidence
  readonly actions: readonly RecoveryAction[]
}

export interface Interface {
  /** Read-only classification; never runs provider, tool, shell, or compaction work. */
  readonly plan: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<RecoveryPlan, SessionCommand.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/RecoveryPlanner") {}

const terminalTypes = [
  EventV2.versionedType(SessionEvent.ProviderAttempt.Ended.type, 1),
  EventV2.versionedType(SessionEvent.Turn.Ended.type, 1),
  EventV2.versionedType(SessionEvent.Input.Terminalized.type, 1),
]

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const lifecycle = yield* LifecycleStore.Service

    const plan = Effect.fn("RecoveryPlanner.plan")(function* (sessionID: SessionSchema.ID) {
      const snapshot = yield* lifecycle.get(sessionID)
      const latestSeq = yield* EventV2.latestSequence(db, sessionID)
      const rows = yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, sessionID), gte(EventTable.seq, snapshot.startedSeq ?? 0)))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      const durableTypes = rows.map((row) => row.type)
      const turnEndedOutcomes = rows
        .filter((row) => row.type === EventV2.versionedType(SessionEvent.Turn.Ended.type, 1))
        .map((row) => (row.data as { outcome?: string }).outcome)
      const ownerPresent = snapshot.processIncarnation === processIncarnation
      const terminalComplete = terminalTypes.every((type) => durableTypes.includes(type))
      const responseStarted = durableTypes.includes(
        EventV2.versionedType(SessionEvent.ProviderAttempt.ResponseStarted.type, 1),
      )
      const toolCalled = durableTypes.includes(EventV2.versionedType(SessionEvent.Tool.Called.type, 1))
      const toolTerminal =
        durableTypes.includes(EventV2.versionedType(SessionEvent.Tool.Success.type, 1)) ||
        durableTypes.includes(EventV2.versionedType(SessionEvent.Tool.Failed.type, 1))
      const evidence: RecoveryEvidence = {
        execution: snapshot,
        latestSeq,
        durableTypes,
        ownerPresent,
        projectedOutputComplete: terminalComplete,
        uncertainMutation: toolCalled && !toolTerminal,
      }
      const base = { sessionID, generation: snapshot.generation, latestSeq, evidence }

      if (snapshot.state === "idle")
        return { ...base, classification: "no-action" as const, actions: [] }

      // Durable output already proves the turn reached its terminal facts; only
      // the coordination row and read models are stale. The executor clears the
      // row without re-publishing anything.
      if (terminalComplete && turnEndedOutcomes.includes("abandoned"))
        return {
          ...base,
          classification: "abandon" as const,
          actions: [{ type: "abandon" as const, reason: "sequence-inconsistent" as const }],
        }
      if (terminalComplete)
        return { ...base, classification: "settle-from-durable-output" as const, actions: [] }

      // A provider request proven not dispatched (no ResponseStarted) by an
      // absent owner is eligible to resume; nothing was sent to the provider.
      if (snapshot.phase === "dispatching" && !responseStarted && !ownerPresent)
        return { ...base, classification: "safe-to-resume" as const, actions: [] }

      // Everything else with an absent owner is ambiguous dispatched work.
      if (!ownerPresent) {
        const reason: RecoveryReason = evidence.uncertainMutation
          ? "mutation-outcome-unknown"
          : snapshot.phase === "responding" || snapshot.phase === "dispatching" || snapshot.phase === "admitting"
            ? "provider-dispatch-ambiguous"
            : snapshot.phase === "compacting"
              ? "compaction-partial"
              : "sequence-inconsistent"
        return {
          ...base,
          classification: "needs-user-decision" as const,
          actions: [{ type: "mark-recovery-required" as const, reason }],
        }
      }

      // A live owner holds the execution; the coordinator owns it.
      return { ...base, classification: "no-action" as const, actions: [] }
    })

    return Service.of({ plan })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, LifecycleStore.node],
})
