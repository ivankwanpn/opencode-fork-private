import { afterEach, describe, expect, test } from "bun:test"
import { resolveChannel } from "./utils"

const originalChannel = process.env.OPENCODE_CHANNEL

afterEach(() => {
  if (originalChannel === undefined) {
    delete process.env.OPENCODE_CHANNEL
    return
  }
  process.env.OPENCODE_CHANNEL = originalChannel
})

describe("resolveChannel", () => {
  test("defaults to dev when no channel is configured", () => {
    delete process.env.OPENCODE_CHANNEL
    expect(resolveChannel()).toBe("dev")
  })

  test("accepts each supported channel", () => {
    for (const channel of ["dev", "beta", "prod"] as const) {
      process.env.OPENCODE_CHANNEL = channel
      expect(resolveChannel()).toBe(channel)
    }
  })

  test("falls back to dev for an unknown channel", () => {
    process.env.OPENCODE_CHANNEL = "staging"
    expect(resolveChannel()).toBe("dev")
  })
})
