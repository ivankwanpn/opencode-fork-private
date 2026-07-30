import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { mergeLiveModels, type Info } from "@/provider/provider"

test("V1 provider discovery preserves configured aliases and adds live IDs", () => {
  const providerID = ProviderV2.ID.make("test")
  const provider = {
    id: providerID,
    name: "Test",
    source: "config",
    env: [],
    options: {},
    models: {
      alias: {
        id: ModelV2.ID.make("alias"),
        providerID,
        api: { id: "upstream-live", url: "https://api.example.com/v1", npm: "@ai-sdk/openai-compatible" },
        name: "Configured alias",
        family: "",
        capabilities: {
          temperature: false,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
        limit: { context: 100_000, output: 8_000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
        variants: {},
      },
      stale: {
        id: ModelV2.ID.make("stale"),
        providerID,
        api: { id: "upstream-stale", url: "https://api.example.com/v1", npm: "@ai-sdk/openai-compatible" },
        name: "Stale",
        family: "",
        capabilities: {
          temperature: false,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
        limit: { context: 100_000, output: 8_000 },
        status: "active",
        options: {},
        headers: {},
        release_date: "",
        variants: {},
      },
    },
  } satisfies Info

  const models = mergeLiveModels(provider, [{ id: "upstream-live" }, { id: "new-live", context: 256_000 }])

  expect(Object.keys(models)).toEqual(["alias", "new-live"])
  expect(models.alias.name).toBe("Configured alias")
  expect(models["new-live"]).toMatchObject({ name: "new-live", limit: { context: 256_000 } })
})
