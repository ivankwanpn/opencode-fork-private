import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionEvent } from "../src/session-event"
import { EventManifest } from "../src/event-manifest"
import { SessionID } from "../src/session-id"

describe("SessionEvent V2 status", () => {
  test("is a durable public event on the session aggregate", () => {
    expect(SessionEvent.Status.type).toBe("session.next.status")
    expect(SessionEvent.Status.durable).toEqual({ aggregate: "sessionID", version: 1 })
    expect(EventManifest.Latest.get("session.next.status")).toBe(SessionEvent.Status)
  })

  test("encodes busy and idle status payloads", () => {
    const encode = Schema.encodeSync(SessionEvent.Status.data)
    const timestamp = DateTime.makeUnsafe(1)
    const sessionID = SessionID.make("ses_test")
    expect(encode({ timestamp, sessionID, status: { type: "busy" } })).toMatchObject({
      status: { type: "busy" },
    })
    expect(encode({ timestamp, sessionID, status: { type: "idle" } })).toMatchObject({
      status: { type: "idle" },
    })
  })

  test("encodes a retry status with an action", () => {
    const encode = Schema.encodeSync(SessionEvent.Status.data)
    const encoded = encode({
      timestamp: DateTime.makeUnsafe(1),
      sessionID: SessionID.make("ses_test"),
      status: {
        type: "retry",
        attempt: 2,
        message: "Rate limited",
        action: {
          reason: "rate_limited",
          provider: "anthropic",
          title: "Retry",
          message: "Wait and retry",
          label: "Retry now",
        },
        next: 3,
      },
    })
    expect(encoded.status).toMatchObject({ type: "retry", attempt: 2, next: 3 })
  })
})
