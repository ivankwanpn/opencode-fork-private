import { describe, expect, test } from "bun:test"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import type { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

const testAgent = (tools: Record<string, "allow" | "ask" | "deny"> = {}): Agent.Info =>
  ({
    name: "worker",
    mode: "subagent",
    permission: Permission.fromConfig(tools),
    options: {},
  }) satisfies Agent.Info

describe("deriveSubagentSessionPermission grants", () => {
  test("appends a grant as an allow rule after the built-in denies", () => {
    const result = deriveSubagentSessionPermission({
      parentSessionPermission: [],
      subagent: testAgent(),
      grants: [{ tool: "playwright_snapshot" }],
    })
    expect(result).toContainEqual({
      permission: "playwright_snapshot",
      pattern: "*",
      action: "allow",
    })
    // The built-in todowrite/task denies are still present.
    expect(result).toContainEqual({ permission: "todowrite", pattern: "*", action: "deny" })
    expect(result).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
  })

  test("drops a grant whose tool is on the blocklist (double-check)", () => {
    const result = deriveSubagentSessionPermission({
      parentSessionPermission: [],
      subagent: testAgent(),
      grants: [{ tool: "browser_run_code_unsafe" }],
      blocked: new Set(["browser_run_code_unsafe"]),
    })
    expect(result.some((rule) => rule.permission === "browser_run_code_unsafe")).toBe(false)
  })

  test("honours a grant resource pattern", () => {
    const result = deriveSubagentSessionPermission({
      parentSessionPermission: [],
      subagent: testAgent(),
      grants: [{ tool: "read", resource: "/tmp/**" }],
    })
    expect(result).toContainEqual({ permission: "read", pattern: "/tmp/**", action: "allow" })
  })

  test("no grants keeps the existing behaviour unchanged", () => {
    const result = deriveSubagentSessionPermission({
      parentSessionPermission: [],
      subagent: testAgent(),
    })
    expect(result).toContainEqual({ permission: "todowrite", pattern: "*", action: "deny" })
    expect(result).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
    expect(result).toHaveLength(2)
  })
})

describe("deriveSubagentSessionPermission grants precedence", () => {
  test("a grant allow overrides a parent session deny for the same tool", () => {
    const result = deriveSubagentSessionPermission({
      parentSessionPermission: [{ permission: "playwright_snapshot", pattern: "*", action: "deny" }],
      subagent: testAgent(),
      grants: [{ tool: "playwright_snapshot" }],
    })
    expect(result).toContainEqual({ permission: "playwright_snapshot", pattern: "*", action: "allow" })
  })
})
