export * as SessionLifecycle from "./lifecycle"

import { DateTime, Effect } from "effect"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionAttempt } from "./attempt"
import { AssistantErrorCodec } from "./assistant-error-codec"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import type { SessionStore } from "./store"
import { SessionTurn } from "./turn"

type DB = Database.Interface["db"]

export const settleAssistant = Effect.fn("SessionLifecycle.settleAssistant")(function* (
  store: SessionStore.Interface,
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly message: string
  },
) {
  const stored = yield* store.message(input.assistantMessageID)
  if (stored?.sessionID !== input.sessionID || stored.message.type !== "assistant") return
  const assistant = stored.message
  for (const tool of assistant.content) {
    if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
    yield* events.publish(SessionEvent.Tool.Failed, {
      sessionID: input.sessionID,
      timestamp: yield* DateTime.now,
      assistantMessageID: input.assistantMessageID,
      callID: tool.id,
      error: { type: "unknown", message: "Tool execution interrupted" },
      provider: {
        executed: tool.provider?.executed === true,
        ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
      },
    })
  }
  if (assistant.time.completed !== undefined) return
  yield* events.publish(SessionEvent.Step.Failed, {
    sessionID: input.sessionID,
    timestamp: yield* DateTime.now,
    assistantMessageID: input.assistantMessageID,
    error: { type: "unknown", message: AssistantErrorCodec.encode(input.message) },
  })
})

export const settleCompletedAttempt = Effect.fn("SessionLifecycle.settleCompletedAttempt")(function* (
  db: DB,
  store: SessionStore.Interface,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const attempt = yield* SessionAttempt.get(db, sessionID)
  if (!attempt || (attempt.status !== "started" && attempt.status !== "responding")) return true
  const stored = yield* store.message(attempt.assistant_message_id)
  const assistant = stored?.sessionID === sessionID && stored.message.type === "assistant" ? stored.message : undefined
  const unsettled = assistant?.content.some(
    (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
  )
  if (assistant?.time.completed === undefined || unsettled !== false) return false
  const interrupted = assistant.error?.message === "Provider turn interrupted"
  const failed = assistant.finish === "error"
  const continuation =
    !failed && assistant.content.some((part) => part.type === "tool" && part.provider?.executed !== true)
  yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
    sessionID,
    attemptID: attempt.attempt_id,
    assistantMessageID: attempt.assistant_message_id,
    timestamp: yield* DateTime.now,
    outcome: interrupted ? "interrupted" : failed ? "failed" : "completed",
    continuation,
    error: assistant.error ? { type: "unknown", message: assistant.error.message } : undefined,
  })
  if (!continuation) yield* endOpenTurn(db, events, sessionID, interrupted ? "interrupted" : failed ? "failed" : "completed")
  return true
})

export const terminateAttempt = Effect.fn("SessionLifecycle.terminateAttempt")(function* (
  db: DB,
  store: SessionStore.Interface,
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly outcome: "failed" | "interrupted" | "abandoned"
    readonly message: string
  },
) {
  const attempt = yield* SessionAttempt.get(db, input.sessionID)
  if (
    !attempt ||
    (attempt.status !== "started" &&
      attempt.status !== "responding" &&
      attempt.status !== "retrying" &&
      attempt.status !== "continuation")
  )
    return false
  yield* settleAssistant(store, events, {
    sessionID: input.sessionID,
    assistantMessageID: attempt.assistant_message_id,
    message: input.message,
  })
  yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
    sessionID: input.sessionID,
    attemptID: attempt.attempt_id,
    assistantMessageID: attempt.assistant_message_id,
    timestamp: yield* DateTime.now,
    outcome: input.outcome,
    continuation: false,
    error: { type: "unknown", message: input.message },
  })
  return true
})

export const abandonOrphan = Effect.fn("SessionLifecycle.abandonOrphan")(function* (
  db: DB,
  store: SessionStore.Interface,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const abandoned = yield* terminateAttempt(db, store, events, {
    sessionID,
    outcome: "abandoned",
    message: "Provider turn ownership was lost; the attempt was abandoned without retrying it",
  })
  if (!abandoned) return false
  yield* endOpenTurn(db, events, sessionID, "abandoned")
  return true
})

export const reconcileForStart = Effect.fn("SessionLifecycle.reconcileForStart")(function* (
  db: DB,
  store: SessionStore.Interface,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  if (!(yield* settleCompletedAttempt(db, store, events, sessionID))) {
    yield* abandonOrphan(db, store, events, sessionID)
    return
  }
  const attempt = yield* SessionAttempt.get(db, sessionID)
  if (!attempt || (attempt.status !== "ended" && attempt.status !== "interrupted" && attempt.status !== "abandoned"))
    return
  const ended = yield* SessionAttempt.latestEnded(db, sessionID)
  if (!ended || ended.attemptID !== attempt.attempt_id || ended.continuation) return
  const outcome =
    ended.outcome === "interrupted"
      ? "interrupted"
      : ended.outcome === "failed"
        ? "failed"
        : ended.outcome === "abandoned"
          ? "abandoned"
          : "completed"
  yield* endOpenTurn(db, events, sessionID, outcome)
})

export const endOpenTurn = Effect.fn("SessionLifecycle.endOpenTurn")(function* (
  db: DB,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  outcome: "completed" | "failed" | "interrupted" | "abandoned",
) {
  const turn = yield* SessionTurn.get(db, sessionID)
  if (!turn || turn.status === "ended") return false
  return yield* SessionTurn.end(events, { sessionID, turnID: turn.turn_id, outcome })
})
