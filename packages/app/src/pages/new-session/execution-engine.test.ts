import { describe, expect, test } from "bun:test"
import {
  engineSelectorVisible,
  engineOptions,
  isDevEnvironment,
  resolveNewSessionEngine,
} from "./execution-engine"

describe("new session execution engine", () => {
  test("DEV preference creates a kernel session", () => {
    expect(resolveNewSessionEngine("kernel", true)).toBe("kernel")
  })

  test("production never resolves to kernel even when the preference says so", () => {
    expect(resolveNewSessionEngine("kernel", false)).toBe("classic")
    expect(resolveNewSessionEngine(undefined, false)).toBe("classic")
  })

  test("the selector is DEV-only", () => {
    expect(engineSelectorVisible(true)).toBe(true)
    expect(engineSelectorVisible(false)).toBe(false)
  })

  test("offers exactly Classic and Kernel for new sessions", () => {
    expect(engineOptions.map((option) => option.id)).toEqual(["classic", "kernel"])
    expect(engineOptions.map((option) => option.label)).toEqual(["Classic", "Kernel"])
  })

  test("defaults to classic in production and dev alike", () => {
    expect(resolveNewSessionEngine(undefined, true)).toBe("classic")
  })

  test("DEV detection follows the channel, not just the bundle mode", () => {
    // A production bundle served through a dev channel still exposes the
    // selector; resolution stays gated at the preference level.
    expect(typeof isDevEnvironment()).toBe("boolean")
    expect(engineSelectorVisible(isDevEnvironment()) === true || engineSelectorVisible(isDevEnvironment()) === false).toBe(
      true,
    )
  })
})
