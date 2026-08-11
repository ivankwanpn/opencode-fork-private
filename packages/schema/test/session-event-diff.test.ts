import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionEvent } from "../src/session-event"
import { EventManifest } from "../src/event-manifest"
import { SessionID } from "../src/session-id"

describe("SessionEvent V2 diff", () => {
  test("is a durable public event on the session aggregate", () => {
    expect(SessionEvent.Diff.type).toBe("session.next.diff")
    expect(SessionEvent.Diff.durable).toEqual({ aggregate: "sessionID", version: 1 })
    expect(EventManifest.Latest.get("session.next.diff")).toBe(SessionEvent.Diff)
  })

  test("encodes a diff payload", () => {
    const encode = Schema.encodeSync(SessionEvent.Diff.data)
    const encoded = encode({
      timestamp: DateTime.makeUnsafe(1),
      sessionID: SessionID.make("ses_test"),
      diff: [
        {
          file: "file.txt",
          additions: 3,
          deletions: 0,
          status: "modified",
        },
      ],
    })
    expect(encoded.diff).toMatchObject([{ file: "file.txt" }])
  })
})
