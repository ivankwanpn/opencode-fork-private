import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Question } from "../src/question"
import { SessionID } from "../src/session-id"
import { EventManifest } from "../src/event-manifest"

describe("Question V2 events", () => {
  test("owns the V2 question event vocabulary", () => {
    expect(Question.Event.Asked.type).toBe("question.v2.asked")
    expect(Question.Event.Replied.type).toBe("question.v2.replied")
    expect(Question.Event.Rejected.type).toBe("question.v2.rejected")
    expect(EventManifest.Latest.get("question.v2.asked")).toBe(Question.Event.Asked)
  })

  test("encodes an asked request", () => {
    const encode = Schema.encodeSync(Question.Event.Asked.data)
    const encoded = encode({
      id: Question.ID.make("que_test"),
      sessionID: SessionID.make("ses_test"),
      questions: [{ question: "Continue?", header: "Continue", options: [{ label: "Yes", description: "Continue" }] }],
    })
    expect(encoded).toMatchObject({ sessionID: "ses_test" })
  })

  test("encodes a replied payload", () => {
    const encode = Schema.encodeSync(Question.Event.Replied.data)
    const encoded = encode({
      sessionID: SessionID.make("ses_test"),
      requestID: Question.ID.make("que_test"),
      answers: [["Yes"]],
    })
    expect(encoded).toMatchObject({ requestID: "que_test", answers: [["Yes"]] })
  })

  test("encodes a rejected payload", () => {
    const encode = Schema.encodeSync(Question.Event.Rejected.data)
    const encoded = encode({
      sessionID: SessionID.make("ses_test"),
      requestID: Question.ID.make("que_test"),
    })
    expect(encoded).toMatchObject({ requestID: "que_test" })
  })
})
