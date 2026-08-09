import { describe, expect, test } from "bun:test"
import { canEditConnectedProvider, providerEditTarget } from "./provider-edit"

describe("canEditConnectedProvider", () => {
  test("allows OAuth edit and selects the OAuth dialog", () => {
    const item = { id: "openai", auth: "oauth", source: "api" }
    expect(canEditConnectedProvider(item)).toBe(true)
    expect(providerEditTarget(item, false)).toBe("oauth")
  })

  test("keeps custom and API-key routes unchanged", () => {
    expect(providerEditTarget({ auth: "key", source: "api" }, true)).toBe("custom")
    expect(providerEditTarget({ auth: "key", source: "api" }, false)).toBe("connect")
  })

  test("allows key, environment, config, custom, and legacy connections to be edited", () => {
    expect(canEditConnectedProvider({ auth: "key", source: "api" })).toBe(true)
    expect(canEditConnectedProvider({ auth: "env", source: "env" })).toBe(true)
    expect(canEditConnectedProvider({ source: "config" })).toBe(true)
    expect(canEditConnectedProvider({ source: "custom" })).toBe(true)
    expect(canEditConnectedProvider({})).toBe(true)
  })
})
