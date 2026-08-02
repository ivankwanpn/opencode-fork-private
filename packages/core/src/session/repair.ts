export * as SessionRepair from "./repair"

import { Effect } from "effect"
import { EventV2 } from "../event"
import { SessionAttempt } from "./attempt"
import { SessionInput } from "./input"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import type { Database } from "../database/database"

/**
 * Replays the session's durable event log and rebuilds missing/divergent
 * projection rows (session_attempt, session_input).
 *
 * The brief's minimal scope only replayed `ProviderAttempt.Started` and
 * `PromptAdmitted`. Replaying only Started would restore an ended attempt as
 * "started", so this repair also replays the remaining attempt transitions
 * (ResponseStarted, Ended, Recovery.Decided, Retried) in log order, letting
 * the existing projectors settle the rebuilt row into its terminal status.
 * Input rows are rebuilt from `PromptAdmitted`; a missing `promoted_seq` is a
 * known limitation (promotion state is left to the live runner).
 */
export const repairSession = Effect.fn("SessionRepair.repairSession")(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const history = yield* EventV2.readAggregate(db, {
    aggregateID: sessionID,
    limit: 10_000,
    manifest: SessionDurable,
  })
  const repairAttempt = yield* needsAttemptRepair(db, sessionID, history.events)
  const repairInput = yield* needsInputRepair(db, history.events)
  if (!repairAttempt && !repairInput) return { repaired: false }
  for (const event of history.events) {
    if (event.durable === undefined) continue
    if (repairAttempt) {
      yield* replayAttempt(db, event)
    }
    if (repairInput && event.type === SessionEvent.PromptAdmitted.type) {
      yield* SessionInput.projectAdmitted(db, {
        admittedSeq: event.durable.seq,
        id: event.data.messageID,
        sessionID: event.data.sessionID,
        prompt: event.data.prompt,
        synthetic: event.data.synthetic,
        delivery: event.data.delivery,
        timeCreated: event.data.timestamp,
      })
    }
  }
  return { repaired: true }
})

const needsAttemptRepair = Effect.fn("SessionRepair.needsAttemptRepair")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  events: readonly SessionEvent.DurableEvent[],
) {
  const currentAttemptID = events.findLast(
    (event) => event.type === SessionEvent.ProviderAttempt.Started.type,
  )?.data.attemptID
  if (currentAttemptID === undefined) return false
  const existing = yield* SessionAttempt.get(db, sessionID)
  return existing === undefined || existing.attempt_id !== currentAttemptID
})

const needsInputRepair = Effect.fn("SessionRepair.needsInputRepair")(function* (
  db: Database.Interface["db"],
  events: readonly SessionEvent.DurableEvent[],
) {
  for (const event of events) {
    if (event.type === SessionEvent.PromptAdmitted.type && event.durable) {
      const existing = yield* SessionInput.find(db, event.data.messageID)
      if (existing === undefined) return true
    }
  }
  return false
})

const replayAttempt = Effect.fn("SessionRepair.replayAttempt")(function* (
  db: Database.Interface["db"],
  event: SessionEvent.DurableEvent,
) {
  if (event.type === SessionEvent.ProviderAttempt.Started.type) {
    yield* SessionAttempt.projectStarted(db, event)
  }
  if (event.type === SessionEvent.ProviderAttempt.ResponseStarted.type) {
    yield* SessionAttempt.projectResponseStarted(db, event)
  }
  if (event.type === SessionEvent.ProviderAttempt.Ended.type) {
    yield* SessionAttempt.projectEnded(db, event)
  }
  if (event.type === SessionEvent.ProviderAttempt.Recovery.Decided.type) {
    yield* SessionAttempt.projectRecoveryDecided(db, event)
  }
  if (event.type === SessionEvent.Retried.type) {
    yield* SessionAttempt.projectRetried(db, event)
  }
})
