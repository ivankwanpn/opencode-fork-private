import { describe, expect, test } from "bun:test"
import { createSessionEngineInput } from "../../src/util/execution-engine"

describe("TUI session execution engine", () => {
  test("requests Kernel only when explicitly opted in", () => {
    expect(createSessionEngineInput({ OPENCODE_SESSION_ENGINE: "kernel" })).toEqual({ engine: "kernel" })
  })

  test("leaves Session creation engine-agnostic by default", () => {
    expect(createSessionEngineInput({})).toEqual({})
    expect(createSessionEngineInput({ OPENCODE_SESSION_ENGINE: "classic" })).toEqual({})
    expect(createSessionEngineInput({ OPENCODE_SESSION_ENGINE: "unexpected" })).toEqual({})
  })
})
