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
import { ownsExecution } from "./incarnation"

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
  readonly plan: (sessionID: SessionSchema.ID) => Effect.Effect<RecoveryPlan, SessionCommand.NotFoundError>
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
      const ownerPresent = ownsExecution(snapshot)
      const turnTerminalComplete = terminalTypes.every((type) => durableTypes.includes(type))
      const compactionStartedType = EventV2.versionedType(SessionEvent.Compaction.Started.type, 1)
      const compactionTerminalTypes = new Set([
        EventV2.versionedType(SessionEvent.Compaction.Ended.type, 1),
        EventV2.versionedType(SessionEvent.Compaction.Failed.type, 1),
      ])
      const compactionMessageIDs = new Set(
        rows.flatMap((row) => {
          if (row.type !== compactionStartedType) return []
          const messageID = (row.data as { readonly messageID?: unknown }).messageID
          return typeof messageID === "string" ? [messageID] : []
        }),
      )
      const compactionComplete = rows.some((row) => {
        if (!compactionTerminalTypes.has(row.type)) return false
        const messageID = (row.data as { readonly messageID?: unknown }).messageID
        return typeof messageID === "string" && compactionMessageIDs.has(messageID)
      })
      const outputComplete = snapshot.phase === "compacting" ? compactionComplete : turnTerminalComplete
      const calledType = EventV2.versionedType(SessionEvent.Tool.Called.type, 1)
      const toolTerminalTypes = new Set([
        EventV2.versionedType(SessionEvent.Tool.Success.type, 1),
        EventV2.versionedType(SessionEvent.Tool.Failed.type, 1),
      ])
      const terminalCallIDs = new Set(
        rows.flatMap((row) => {
          if (!toolTerminalTypes.has(row.type)) return []
          const callID = (row.data as { readonly callID?: unknown }).callID
          return typeof callID === "string" ? [callID] : []
        }),
      )
      const unsettledCalls = rows.flatMap((row) => {
        if (row.type !== calledType) return []
        const data = row.data as { readonly callID?: unknown; readonly tool?: unknown }
        if (typeof data.callID !== "string" || terminalCallIDs.has(data.callID)) return []
        return [{ callID: data.callID, tool: typeof data.tool === "string" ? data.tool : undefined }]
      })
      const pendingQuestion = unsettledCalls.some((call) => call.tool === "question")
      const evidence: RecoveryEvidence = {
        execution: snapshot,
        latestSeq,
        durableTypes,
        ownerPresent,
        projectedOutputComplete: outputComplete,
        uncertainMutation: unsettledCalls.length > 0,
      }
      const base = { sessionID, generation: snapshot.generation, latestSeq, evidence }

      // A recovery decision is a durable user-facing boundary. Startup may
      // inspect the row again, but it must not reinterpret or overwrite the
      // reason until an explicit recovery decision changes the state.
      if (snapshot.state === "needs_recovery") return { ...base, classification: "no-action" as const, actions: [] }
      if (snapshot.state === "idle") return { ...base, classification: "no-action" as const, actions: [] }

      // Durable output already proves the turn reached its terminal facts; only
      // the coordination row and read models are stale. The executor clears the
      // row without re-publishing anything.
      if (outputComplete && turnEndedOutcomes.includes("abandoned"))
        return {
          ...base,
          classification: "abandon" as const,
          actions: [{ type: "abandon" as const, reason: "sequence-inconsistent" as const }],
        }
      if (outputComplete) return { ...base, classification: "settle-from-durable-output" as const, actions: [] }

      // Once dispatch begins, absence of a response is not proof that the
      // request was never sent. An absent owner therefore requires recovery.
      if (!ownerPresent) {
        const reason: RecoveryReason = pendingQuestion
          ? "question-disconnected"
          : evidence.uncertainMutation
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
