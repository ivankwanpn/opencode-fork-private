import { expect, test } from "bun:test"
import { pluginRuntimeNeedsRefresh } from "./plugin-runtime-poll"

test("polls only while the runtime reports active initialization", () => {
  expect(pluginRuntimeNeedsRefresh({ data: { plugins: [{ state: "initializing", capabilities: [] }] } })).toBe(true)
  expect(
    pluginRuntimeNeedsRefresh({
      data: { plugins: [{ state: "degraded", capabilities: [{ name: "tools", state: "pending" }] }] },
    }),
  ).toBe(true)
  expect(
    pluginRuntimeNeedsRefresh({
      data: { plugins: [{ state: "failed", capabilities: [{ name: "plugin", state: "failed" }] }] },
    }),
  ).toBe(false)
})
