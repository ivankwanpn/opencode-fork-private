import { describe, expect, test } from "bun:test"
import {
  beginPluginLoad,
  pluginLoadContextCurrent,
  rejectPluginLoad,
  resolvePluginLoad,
  type PluginLoadState,
} from "./plugin-load-state"

type Catalog = {
  readonly plugins: readonly string[]
}

const empty: Catalog = { plugins: [] }
const loaded: Catalog = { plugins: ["superpowers"] }

describe("plugin loading state", () => {
  test("distinguishes first loading from a successful empty result", () => {
    const loading = beginPluginLoad<Catalog>({ state: "idle" }, 1)

    expect(loading).toEqual({ state: "loading", request: 1 })
    expect(resolvePluginLoad(loading, 1, empty)).toEqual({ state: "ready", request: 1, value: empty })
  })

  test("retains the last successful snapshot while refreshing and after refresh failure", () => {
    const ready: PluginLoadState<Catalog> = { state: "ready", request: 1, value: loaded }
    const refreshing = beginPluginLoad(ready, 2)

    expect(refreshing).toEqual({ state: "refreshing", request: 2, value: loaded })
    expect(rejectPluginLoad(refreshing, 2, "offline")).toEqual({
      state: "stale",
      request: 2,
      value: loaded,
      error: "offline",
    })
  })

  test("reports a first-load failure without manufacturing an empty value", () => {
    const loading = beginPluginLoad<Catalog>({ state: "idle" }, 1)

    expect(rejectPluginLoad(loading, 1, "offline")).toEqual({
      state: "failed",
      request: 1,
      error: "offline",
    })
  })

  test("ignores success and failure from an older request", () => {
    const current: PluginLoadState<Catalog> = { state: "loading", request: 2 }

    expect(resolvePluginLoad(current, 1, loaded)).toBe(current)
    expect(rejectPluginLoad(current, 1, "old failure")).toBe(current)
  })

  test("refreshing a stale snapshot keeps its last successful value", () => {
    const stale: PluginLoadState<Catalog> = {
      state: "stale",
      request: 2,
      value: loaded,
      error: "offline",
    }

    expect(beginPluginLoad(stale, 3)).toEqual({ state: "refreshing", request: 3, value: loaded })
  })

  test("rejects request context from an older request, server, protocol generation, or directory", () => {
    const server = {}
    const expected = { request: 2, server, generation: 4, directory: "/workspace" }

    expect(pluginLoadContextCurrent(expected, { ...expected })).toBe(true)
    expect(pluginLoadContextCurrent(expected, { ...expected, request: 3 })).toBe(false)
    expect(pluginLoadContextCurrent(expected, { ...expected, server: {} })).toBe(false)
    expect(pluginLoadContextCurrent(expected, { ...expected, generation: 5 })).toBe(false)
    expect(pluginLoadContextCurrent(expected, { ...expected, directory: "/other" })).toBe(false)
  })
})
