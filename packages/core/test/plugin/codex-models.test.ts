import { describe, expect, test } from "bun:test"
import { parseCodexModels } from "../../src/plugin/provider/codex-models"

describe("codex model discovery", () => {
  test("accepts the supported response envelopes and ignores malformed entries", () => {
    expect(
      parseCodexModels({
        data: [
          { id: "gpt-data", contextWindow: 256_000 },
          { slug: "gpt-slug", name: "GPT Slug", context_window: 128_000 },
          { name: "missing id" },
          null,
        ],
      }),
    ).toEqual([
      { id: "gpt-data", context: 256_000 },
      { id: "gpt-slug", name: "GPT Slug", context: 128_000 },
    ])
  })
})
