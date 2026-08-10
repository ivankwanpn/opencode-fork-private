import type { ModelV2Info } from "@opencode-ai/sdk/v2"

export function parse(value: string) {
  const [providerID, ...modelID] = value.split("/")
  return { providerID, modelID: modelID.join("/") }
}

export function get(list: readonly ModelV2Info[] | undefined, providerID: string, modelID: string) {
  return list?.find((model) => model.providerID === providerID && model.id === modelID)
}

export function name(list: readonly ModelV2Info[] | undefined, providerID: string, modelID: string) {
  return get(list, providerID, modelID)?.name ?? modelID
}
