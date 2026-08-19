import { describe, expect, test } from "bun:test"
import { SessionV1 } from "../src/v1/session"

describe("legacy event schema compatibility", () => {
  test("Core retains NamedError constructor identity", () => {
    const error = new SessionV1.APIError({ message: "failed", isRetryable: false })
    expect(error).toBeInstanceOf(SessionV1.APIError)
    expect(error.toObject()).toEqual({ name: "APIError", data: { message: "failed", isRetryable: false } })
  })
})
