import { describe, expect, test } from "bun:test"
import { modelVariantsForProtocol, resolveModelProtocol } from "./model-protocol-variants"

const legacyVariants = ["none", "low", "medium", "high"]

describe("modelVariantsForProtocol", () => {
  test("upgrades legacy reasoning variants to the selected protocol", () => {
    expect(modelVariantsForProtocol(legacyVariants, "openai-responses")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ])
    expect(modelVariantsForProtocol(legacyVariants, "openai-compatible")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ])
    expect(modelVariantsForProtocol(legacyVariants, "anthropic-messages")).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "max",
    ])
  })

  test("keeps non-reasoning custom models without variants", () => {
    expect(modelVariantsForProtocol([], "openai-responses")).toEqual([])
  })

  test("does not filter models without a selectable protocol", () => {
    expect(modelVariantsForProtocol(["custom"], undefined)).toEqual(["custom"])
  })
})

describe("resolveModelProtocol", () => {
  test("preserves explicit protocol state when the model has no selectable protocols", () => {
    expect(resolveModelProtocol([], "anthropic-messages", "openai-compatible")).toBe("anthropic-messages")
    expect(resolveModelProtocol([], undefined, "anthropic-messages")).toBe("anthropic-messages")
  })

  test("falls back to a supported protocol when the stored protocol is stale", () => {
    expect(resolveModelProtocol(["openai-responses", "openai-compatible"], "anthropic-messages", undefined)).toBe(
      "openai-compatible",
    )
  })
})
