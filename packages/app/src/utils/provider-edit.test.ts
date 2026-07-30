import { describe, expect, test } from "bun:test"
import { canEditConnectedProvider } from "./provider-edit"

describe("canEditConnectedProvider", () => {
  test("keeps OAuth connections disconnect-only", () => {
    expect(canEditConnectedProvider({ auth: "oauth", source: "api" })).toBe(false)
  })

  test("allows key, environment, config, custom, and legacy connections to be edited", () => {
    expect(canEditConnectedProvider({ auth: "key", source: "api" })).toBe(true)
    expect(canEditConnectedProvider({ auth: "env", source: "env" })).toBe(true)
    expect(canEditConnectedProvider({ source: "config" })).toBe(true)
    expect(canEditConnectedProvider({ source: "custom" })).toBe(true)
    expect(canEditConnectedProvider({})).toBe(true)
  })
})
