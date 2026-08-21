import { DateTime, Schema } from "effect"
import { test } from "bun:test"
import { SessionEvent } from "@opencode-ai/schema/session-event"

test("exact completed data", () => {
  console.log("exact encoding")
  const data = {
    sessionID: "ses_x",
    timestamp: DateTime.makeUnsafe(0),
    attemptID: "evt_x",
    assistantMessageID: "msg_x",
    outcome: "completed" as const,
    continuation: false,
    error: undefined,
  }
  const encoded = Schema.encodeUnknownSync(SessionEvent.ProviderAttempt.Ended.data)(data)
  console.log("exact ok")
})
test("exact error data", () => {
  console.log("exact-error encoding")
  const data = {
    sessionID: "ses_x",
    timestamp: DateTime.makeUnsafe(0),
    attemptID: "evt_x",
    assistantMessageID: "msg_x",
    outcome: "failed" as const,
    continuation: false,
    error: { type: "unknown" as const, message: "invalid key" },
  }
  const encoded = Schema.encodeUnknownSync(SessionEvent.ProviderAttempt.Ended.data)(data)
  console.log("exact-error ok")
})
