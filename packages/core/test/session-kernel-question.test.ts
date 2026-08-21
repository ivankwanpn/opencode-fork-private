import { describe, expect, test } from "bun:test"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionSchema } from "@opencode-ai/core/session/schema"

describe("Kernel question binding", () => {
  // Generation binding: Request.generation records the executing generation
  // and reply rejects fenced generations with StaleQuestion. The full
  // location-suite scenarios for the binding land with Task 14.
  test("Request carries an optional generation field", () => {
    const sessionID = SessionSchema.ID.make("ses_binding")
    const request = QuestionV2.Request.make({
      id: QuestionV2.ID.make("que_binding"),
      sessionID,
      questions: [],
      generation: 3,
    })
    expect(request.generation).toBe(3)
    const unbound = QuestionV2.Request.make({ id: QuestionV2.ID.make("que_binding"), sessionID, questions: [] })
    expect(unbound.generation).toBeUndefined()
  })

  test("StaleQuestion is a typed error carrying the expected generation", () => {
    const error = QuestionV2.StaleQuestionError.make({ requestID: QuestionV2.ID.make("que_binding"), expectedGeneration: 3 })
    expect(error._tag).toBe("QuestionV2.StaleQuestion")
    expect(error.expectedGeneration).toBe(3)
  })
})
