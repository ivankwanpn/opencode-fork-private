import { describe, expect, test } from "bun:test"
import { updateModelContext } from "./model-context"

describe("updateModelContext", () => {
  test("updates only the selected model context limit", () => {
    const config = {
      logLevel: "INFO" as const,
      provider: {
        openai: {
          options: { timeout: 30_000 },
          models: {
            live: { limit: { context: 128_000, output: 16_000 }, name: "Live" },
            other: { limit: { context: 64_000, output: 8_000 } },
          },
        },
        anthropic: {
          models: { sonnet: { limit: { context: 200_000, output: 32_000 } } },
        },
      },
    }

    const next = updateModelContext(config, "openai", "live", 321_000)

    expect(next.provider?.openai?.options).toEqual({ timeout: 30_000 })
    expect(next.provider?.openai?.models?.live?.limit).toEqual({ context: 321_000, output: 16_000 })
    expect(next.provider?.openai?.models?.other).toEqual(config.provider.openai.models.other)
    expect(next.provider?.anthropic).toEqual(config.provider.anthropic)
  })

  test("clears an existing limit override", () => {
    const config = {
      provider: {
        openai: { models: { live: { limit: { context: 321_000, output: 16_000 } } } },
      },
    }

    const next = updateModelContext(config, "openai", "live", undefined)

    expect(next.provider?.openai?.models?.live?.limit).toBeUndefined()
  })
})
