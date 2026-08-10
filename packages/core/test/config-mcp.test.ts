import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { MCP } from "@opencode-ai/core/mcp"

describe("ConfigMCP", () => {
  test("Info accepts blockedTools and directTools", () => {
    const info = ConfigMCP.Info.make({
      blockedTools: ["browser_run_code_unsafe", "foo"],
      directTools: ["playwright_snapshot"],
    })
    expect(info.blockedTools).toEqual(["browser_run_code_unsafe", "foo"])
    expect(info.directTools).toEqual(["playwright_snapshot"])
  })

  test("Info schema round-trips blockedTools and directTools", () => {
    const encoded = Schema.encodeSync(ConfigMCP.Info)(
      ConfigMCP.Info.make({
        blockedTools: ["browser_run_code_unsafe", "foo"],
        directTools: ["playwright_snapshot"],
      }),
    )
    expect(encoded).toEqual({
      blockedTools: ["browser_run_code_unsafe", "foo"],
      directTools: ["playwright_snapshot"],
    })
    const decoded = Schema.decodeUnknownSync(ConfigMCP.Info)({
      blockedTools: ["browser_run_code_unsafe", "foo"],
      directTools: ["playwright_snapshot"],
    })
    expect(decoded.blockedTools).toEqual(["browser_run_code_unsafe", "foo"])
    expect(decoded.directTools).toEqual(["playwright_snapshot"])
  })

  test("DEFAULT_BLOCKED_TOOLS includes browser_run_code_unsafe", () => {
    expect(MCP.DEFAULT_BLOCKED_TOOLS).toContain("browser_run_code_unsafe")
  })
})
