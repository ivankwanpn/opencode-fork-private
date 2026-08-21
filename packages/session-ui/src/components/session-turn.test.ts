import { describe, expect, test } from "bun:test"
import { shouldShowThinking } from "./session-turn-state"

describe("shouldShowThinking", () => {
  test("hides the placeholder after visible output starts even when reasoning summaries are disabled", () => {
    expect(shouldShowThinking({ working: true, error: false, retry: false, visible: 1 })).toBe(false)
  })

  test("keeps the placeholder only while an active turn has no visible output", () => {
    expect(shouldShowThinking({ working: true, error: false, retry: false, visible: 0 })).toBe(true)
    expect(shouldShowThinking({ working: false, error: false, retry: false, visible: 0 })).toBe(false)
    expect(shouldShowThinking({ working: true, error: true, retry: false, visible: 0 })).toBe(false)
    expect(shouldShowThinking({ working: true, error: false, retry: true, visible: 0 })).toBe(false)
  })
})
