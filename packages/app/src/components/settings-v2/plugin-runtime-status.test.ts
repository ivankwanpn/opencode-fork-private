import { describe, expect, test } from "bun:test"
import { Plugin } from "@opencode-ai/schema/plugin"
import type { PluginLoadState } from "./plugin-load-state"
import { pluginRuntimePresentation } from "./plugin-runtime-status"

type RuntimeValue = {
  readonly data: Plugin.RuntimeSnapshot
}

function ready(value: Plugin.RuntimeSnapshot): PluginLoadState<RuntimeValue> {
  return { state: "ready", request: 1, value: { data: value } }
}

describe("pluginRuntimePresentation", () => {
  test("reports initializing until the first runtime snapshot resolves", () => {
    expect(pluginRuntimePresentation("demo@marketplace", { state: "loading", request: 1 })).toEqual({
      state: "initializing",
      capabilities: [],
      stale: false,
    })
  })

  test("returns the matching server runtime state and capabilities", () => {
    expect(
      pluginRuntimePresentation(
        "demo@marketplace",
        ready({
          plugins: [
            {
              id: Plugin.ID.make("demo@marketplace"),
              state: "degraded",
              capabilities: [
                { name: "skills", state: "ready" },
                { name: "mcp", state: "failed", message: "authentication required" },
              ],
            },
          ],
        }),
      ),
    ).toEqual({
      state: "degraded",
      capabilities: [
        { name: "skills", state: "ready" },
        { name: "mcp", state: "failed", message: "authentication required" },
      ],
      stale: false,
    })
  })

  test("reports failed when a completed snapshot omits an installed plugin", () => {
    expect(pluginRuntimePresentation("missing@marketplace", ready({ plugins: [] }))).toEqual({
      state: "failed",
      capabilities: [],
      stale: false,
      message: "Plugin runtime status is unavailable",
    })
  })

  test("preserves the last runtime value and marks it stale after refresh failure", () => {
    const value: RuntimeValue = {
      data: {
        plugins: [
          {
            id: Plugin.ID.make("demo@marketplace"),
            state: "ready",
            capabilities: [{ name: "skills", state: "ready" }],
          },
        ],
      },
    }

    expect(
      pluginRuntimePresentation("demo@marketplace", {
        state: "stale",
        request: 2,
        value,
        error: "offline",
      }),
    ).toEqual({
      state: "ready",
      capabilities: [{ name: "skills", state: "ready" }],
      stale: true,
      message: "offline",
    })
  })

  test("surfaces a first-load runtime failure without a fabricated snapshot", () => {
    expect(
      pluginRuntimePresentation("demo@marketplace", { state: "failed", request: 1, error: "server unavailable" }),
    ).toEqual({
      state: "failed",
      capabilities: [],
      stale: false,
      message: "server unavailable",
    })
  })
})
