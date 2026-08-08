import { describe, expect, test } from "bun:test"
import { pluginMcpRuntimeStatus } from "./plugin-runtime-status"

describe("pluginMcpRuntimeStatus", () => {
  test("omits runtime health when a plugin does not manage MCP servers", () => {
    expect(pluginMcpRuntimeStatus([], {})).toBeUndefined()
  })

  test("reports connected only when every managed MCP server is connected", () => {
    expect(
      pluginMcpRuntimeStatus(["first", "second"], {
        first: { status: "connected" },
        second: { status: "connected" },
      }),
    ).toBe("connected")
    expect(
      pluginMcpRuntimeStatus(["first", "second"], {
        first: { status: "connected" },
        second: { status: "failed" },
      }),
    ).toBe("disconnected")
    expect(pluginMcpRuntimeStatus(["missing"], {})).toBe("disconnected")
  })
})
