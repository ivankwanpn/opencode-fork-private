import { expect, test } from "bun:test"
import { EventManifest } from "../src/event-manifest"
import { SessionEvent } from "../src/session-event"
import { Schema } from "effect"

test("SessionEvent V2 error is a live public event with optional Session identity", () => {
  expect(EventManifest.Latest.get("session.next.error")).toBe(SessionEvent.Error)
  expect(SessionEvent.Error.durable).toBeUndefined()

  const decode = Schema.decodeUnknownSync(SessionEvent.Error.data)
  expect(
    decode({
      timestamp: 1,
      sessionID: "ses_error",
      error: { name: "UnknownError", data: { message: "failed" } },
    }),
  ).toMatchObject({ sessionID: "ses_error", error: { name: "UnknownError", data: { message: "failed" } } })
  expect(
    decode({
      timestamp: 2,
      error: { name: "UnknownError", data: { message: "global failure" } },
    }),
  ).toMatchObject({ error: { name: "UnknownError", data: { message: "global failure" } } })
})
