import { describe, expect, test } from "bun:test"
import { createSessionContextFormatter } from "./session-context-format"

describe("createSessionContextFormatter", () => {
  test("formats token counts compactly for an English locale", () => {
    const formatter = createSessionContextFormatter("en-US")

    expect(formatter.compact(31_597)).toBe("31.6K")
    expect(formatter.compact(1_000_000)).toBe("1M")
  })

  test("uses the existing missing-value marker", () => {
    const formatter = createSessionContextFormatter("en-US")

    expect(formatter.compact(undefined)).toBe("—")
    expect(formatter.compact(null)).toBe("—")
  })

  test("formats an unavailable context limit without inventing a value", () => {
    const formatter = createSessionContextFormatter("en-US")

    expect(formatter.compact(40)).toBe("40")
    expect(formatter.compact(undefined)).toBe("—")
  })
})
