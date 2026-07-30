import { describe, expect, test } from "bun:test"
import { ModelV2 } from "../../src/model"
import { ProviderV2 } from "../../src/provider"
import { applyLiveModels, resolveLiveSnapshot } from "../../src/plugin/provider/live-models"

describe("live provider model projection", () => {
  test("keeps a snapshot only when the provider source is unchanged", () => {
    const previous = { source: "https://old.example.com/v1", models: [{ id: "old" }] }

    expect(resolveLiveSnapshot({ source: previous.source, previous })).toEqual({
      live: previous.models,
      snapshot: previous,
    })
    expect(resolveLiveSnapshot({ source: "https://new.example.com/v1", previous })).toEqual({
      live: undefined,
      snapshot: undefined,
    })
    expect(resolveLiveSnapshot({ source: previous.source, previous, fetched: [] })).toEqual({
      live: previous.models,
      snapshot: previous,
    })
  })

  test("hides stale models, keeps live models, and adds new IDs", () => {
    const providerID = ProviderV2.ID.make("test")
    const staleID = ModelV2.ID.make("stale")
    const liveID = ModelV2.ID.make("live")
    const models = new Map([
      [
        staleID,
        ModelV2.Info.make({
          ...ModelV2.Info.empty(providerID, staleID),
          api: { id: staleID, type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.example.com/v1" },
          enabled: true,
        }),
      ],
      [
        liveID,
        ModelV2.Info.make({
          ...ModelV2.Info.empty(providerID, liveID),
          api: { id: liveID, type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.example.com/v1" },
          name: "Configured live",
          limit: { context: 123_000, output: 8_000 },
          enabled: true,
        }),
      ],
    ])
    const provider = ProviderV2.Info.make({
      ...ProviderV2.Info.empty(providerID),
      api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: "https://api.example.com/v1" },
    })
    const record = { provider, models }
    const catalog = {
      provider: {
        get: (id: string) => (id === providerID ? record : undefined),
      },
      model: {
        update: (id: string, modelID: string, update: (model: ModelV2.Info) => void) => {
          if (id !== providerID) return
          const model = models.get(ModelV2.ID.make(modelID)) ?? ModelV2.Info.empty(providerID, ModelV2.ID.make(modelID))
          models.set(ModelV2.ID.make(modelID), model)
          update(model)
        },
        remove: (id: string, modelID: string) => {
          if (id === providerID) models.delete(ModelV2.ID.make(modelID))
        },
      },
    }

    const hidden = new Set<string>()
    const added = new Set<string>()
    applyLiveModels(
      catalog as never,
      providerID,
      [
        { id: "live", context: 256_000 },
        { id: "new", name: "New model" },
      ],
      hidden,
      added,
    )

    expect(models.get(staleID)?.enabled).toBe(false)
    expect(models.get(liveID)?.enabled).toBe(true)
    expect(models.get(liveID)?.limit.context).toBe(123_000)
    expect(models.get(ModelV2.ID.make("new"))).toMatchObject({ name: "New model", limit: { context: 0 } })
    expect(hidden).toContain(`${providerID}/${staleID}`)
    expect(added).toContain(`${providerID}/new`)

    applyLiveModels(catalog as never, providerID, undefined, hidden, added)
    expect(models.get(staleID)?.enabled).toBe(true)
    expect(models.get(ModelV2.ID.make("new"))).toBeUndefined()
    expect(added).toHaveLength(0)
    expect(hidden).toHaveLength(0)
  })
})
