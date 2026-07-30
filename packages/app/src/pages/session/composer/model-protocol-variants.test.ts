import { describe, expect, test } from "bun:test"
import { modelVariantsForProtocol } from "./model-protocol-variants"

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
