export * as KernelTypes from "./types"

import { DateTime, Schema } from "effect"
import type { EventV2 } from "../../event"
import type { SessionEvent } from "../event"
import type { SessionMessage } from "../message"
import { SessionSchema } from "../schema"

/** Durable lease acquired by one atomic start; every later commit must carry it. */
export interface ExecutionLease {
  readonly sessionID: SessionSchema.ID
  readonly generation: number
  readonly token: string
}

export type ExecutionState = "idle" | "active" | "retry_wait" | "needs_recovery" | "cancelling"
export type ExecutionPhase = "admitting" | "dispatching" | "responding" | "tools" | "compacting" | "settling"
export type TurnOutcome = "completed" | "error" | "cancelled" | "recovery-required"
export type InterruptReason = "user" | "shutdown" | "tree-cancel" | "recovery"
export type RecoveryReason =
  | "ownership-lost"
  | "provider-dispatch-ambiguous"
  | "mutation-outcome-unknown"
  | "question-disconnected"
  | "compaction-partial"
  | "shell-process-unknown"
  | "sequence-inconsistent"

/** Read-only projection of the durable `session_execution` coordination row. */
export interface ExecutionSnapshot {
  readonly sessionID: SessionSchema.ID
  readonly engine: "kernel"
  readonly generation: number
  readonly lease?: ExecutionLease
  readonly processIncarnation?: string
  readonly state: ExecutionState
  readonly phase?: ExecutionPhase
  readonly turnID?: SessionMessage.ID
  readonly inputID?: SessionMessage.ID
  readonly attemptID?: EventV2.ID
  readonly assistantMessageID?: SessionMessage.ID
  readonly retryAt?: DateTime.Utc
  readonly recoveryReason?: RecoveryReason
  readonly startedSeq?: number
  readonly updatedSeq?: number
  readonly timeUpdated: DateTime.Utc
}

export interface TaskTerminalMutation {
  readonly submissionID: string
  readonly outcome: TurnOutcome
  readonly resultMessageID?: SessionMessage.ID
}

export interface TaskNotificationMutation {
  readonly id: string
  readonly submissionID: string
  readonly parentSessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly wake: boolean
}

export interface StartInput {
  readonly sessionID: SessionSchema.ID
  readonly inputID: SessionMessage.ID
  readonly turnID: SessionMessage.ID
  readonly attemptID: EventV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly processIncarnation: string
}

export interface TransitionInput {
  readonly lease: ExecutionLease
  readonly expectedState: ExecutionState
  readonly state: ExecutionState
  readonly phase?: ExecutionPhase
  readonly retryAt?: DateTime.Utc
  readonly recoveryReason?: RecoveryReason
  readonly events: readonly EventV2.BatchItem[]
}

export interface CheckpointInput {
  readonly lease: ExecutionLease
  readonly events: readonly EventV2.BatchItem[]
}

export interface TerminalInput {
  readonly lease: ExecutionLease
  readonly outcome: TurnOutcome
  readonly resultMessageID?: SessionMessage.ID
  readonly error?: SessionEvent.ErrorInfo
  readonly task?: TaskTerminalMutation
  readonly outbox?: TaskNotificationMutation
}

export interface InterruptInput {
  readonly sessionID: SessionSchema.ID
  readonly expectedGeneration?: number
  readonly reason: InterruptReason
}

/** A commit tried to use a fenced generation/lease or an unexpected state. */
export class StaleExecutionError extends Schema.TaggedErrorClass<StaleExecutionError>()(
  "StaleExecutionError",
  {
    sessionID: SessionSchema.ID,
    generation: Schema.Number,
    expectedState: Schema.String,
  },
) {}

/** The kernel invariant was violated (missing identities, wrong engine, ...). */
export class InvariantError extends Schema.TaggedErrorClass<InvariantError>()("InvariantError", {
  sessionID: SessionSchema.ID,
  message: Schema.String,
}) {}

/** Another execution owns the Session, or the requested transition conflicts. */
export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("ConflictError", {
  sessionID: SessionSchema.ID,
  message: Schema.String,
}) {}

/** The durable coordination state could not be persisted. */
export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()("PersistenceError", {
  sessionID: SessionSchema.ID,
  message: Schema.String,
}) {}
