import { describe, expect, test } from "bun:test"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { Effect } from "effect"
import { buildProviderConfig, normalizeConfigureInput } from "@/provider/custom-provider/domain"

const input = {
  providerID: "deepseek-custom",
  name: "DeepSeek Anthropic",
  baseURL: "https://api.deepseek.com/anthropic",
  apiKey: "{env:DEEPSEEK_API_KEY}",
  headers: [],
  models: [
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      reasoning: true,
      context: 1_000_000,
      output: 384_000,
    },
  ],
}

describe("DeepSeek Anthropic custom provider", () => {
  test("keeps reasoning variants protocol-neutral until model execution", () => {
    const built = buildProviderConfig(input)
    const migrated = ConfigMigrateV1.migrate({ provider: { [input.providerID]: built } })

    expect(migrated.providers?.[input.providerID]?.models?.["deepseek-v4-pro"]?.variants).toEqual([
      { id: "none", body: {} },
      { id: "low", body: {} },
      { id: "medium", body: {} },
      { id: "high", body: {} },
      { id: "xhigh", body: {} },
      { id: "max", body: {} },
    ])
  })

  test("does not apply protocol-specific budget limits during setup", async () => {
    const normalized = await Effect.runPromise(
      normalizeConfigureInput({
        ...input,
        models: [{ ...input.models[0], context: 4, output: 1 }],
      }),
    )
    expect(normalized.models[0]?.output).toBe(1)
  })
})
