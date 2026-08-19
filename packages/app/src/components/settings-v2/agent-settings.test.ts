import { describe, expect, test } from "bun:test"
import {
  agentRoleMetadata,
  agentModelProtocols,
  agentReasoningOptions,
  configurableAgentIDs,
  formatAgentModel,
  parseAgentModel,
  resolveAgentProtocol,
  subagentAgentIDs,
} from "./agent-settings"

describe("agent settings", () => {
  test("only exposes task subagents in Settings", () => {
    expect(subagentAgentIDs).toEqual(["general", "explore", "research", "worker"])
    expect(configurableAgentIDs).toEqual(subagentAgentIDs)
    expect(configurableAgentIDs).not.toContain("build")
    expect(configurableAgentIDs).not.toContain("plan")
    expect(new Set(configurableAgentIDs).size).toBe(configurableAgentIDs.length)
  })

  test("describes research and worker roles independently", () => {
    expect(agentRoleMetadata.research.descriptionKey).toBe("settings.agents.role.research")
    expect(agentRoleMetadata.worker.descriptionKey).toBe("settings.agents.role.worker")
  })

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

  test("infers native protocols when the model catalog omits protocol metadata", () => {
    const openai = { api: { npm: "@ai-sdk/openai" } } as const
    const compatible = { api: { npm: "@ai-sdk/openai-compatible" } } as const
    const anthropic = { api: { npm: "@ai-sdk/anthropic" } } as const

    expect(agentModelProtocols(openai)).toEqual(["openai-responses"])
    expect(agentModelProtocols(compatible)).toEqual(["openai-compatible"])
    expect(agentModelProtocols(anthropic)).toEqual(["anthropic-messages"])
    expect(resolveAgentProtocol(openai, undefined)).toBe("openai-responses")
    expect(resolveAgentProtocol(openai, "openai-responses")).toBe("openai-responses")
  })

  test("returns protocol-specific reasoning effort options", () => {
    expect(agentReasoningOptions({ variants: { low: {}, high: {} } }, "openai-compatible")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ])
    expect(agentReasoningOptions({ variants: {} }, "openai-responses")).toEqual([])
  })
})
