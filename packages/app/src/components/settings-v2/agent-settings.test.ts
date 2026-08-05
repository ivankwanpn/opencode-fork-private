import { describe, expect, test } from "bun:test"
import { agentReasoningOptions, formatAgentModel, parseAgentModel, resolveAgentProtocol } from "./agent-settings"

describe("agent settings", () => {
  test("parses provider/model values without losing model path segments", () => {
    expect(parseAgentModel("openrouter/openai/gpt-5")).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-5",
    })
    expect(formatAgentModel({ providerID: "openrouter", modelID: "openai/gpt-5" })).toBe("openrouter/openai/gpt-5")
    expect(parseAgentModel("gpt-5")).toBeUndefined()
  })

  test("prefers openai-compatible when a model supports multiple protocols", () => {
    expect(resolveAgentProtocol({ protocols: ["openai-responses", "openai-compatible"] }, undefined)).toBe(
      "openai-compatible",
    )
    expect(resolveAgentProtocol({ protocols: ["openai-responses"] }, "openai-compatible")).toBe("openai-responses")
  })

  test("returns protocol-specific reasoning effort options", () => {
    expect(agentReasoningOptions({ variants: { low: {}, high: {} } }, "openai-compatible")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ])
    expect(agentReasoningOptions({ variants: {} }, "openai-responses")).toEqual([])
  })
})
