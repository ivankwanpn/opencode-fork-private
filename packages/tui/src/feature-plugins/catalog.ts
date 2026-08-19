import type { ProviderCatalogInfo } from "@opencode-ai/sdk/v2"

export function hasConnectedProvider(catalog: ProviderCatalogInfo | undefined) {
  if (!catalog) return false
  const connected = new Set(catalog.connected)
  return catalog.providers.some((provider) => {
    if (!connected.has(provider.info.id)) return false
    if (provider.info.id !== "opencode") return true
    return catalog.models.some((model) => {
      if (model.providerID !== provider.info.id || !model.enabled) return false
      const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
      return cost?.input !== 0
    })
  })
}

export function findModel(catalog: ProviderCatalogInfo | undefined, ref: { providerID: string; id: string }) {
  if (!catalog?.connected.includes(ref.providerID)) return
  return catalog.models.find((model) => model.providerID === ref.providerID && model.id === ref.id && model.enabled)
}
