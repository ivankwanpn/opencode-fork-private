import { CustomProvider } from "@opencode-ai/schema/custom-provider"

export function resolveModelProtocol(
  protocols: CustomProvider.Protocol[],
  selected: CustomProvider.Protocol | undefined,
  saved: CustomProvider.Protocol | undefined,
) {
  if (protocols.length === 0) return selected ?? saved
  if (selected && protocols.includes(selected)) return selected
  if (saved && protocols.includes(saved)) return saved
  return protocols.includes("openai-compatible") ? "openai-compatible" : protocols[0]
}

export function modelVariantsForProtocol(variants: string[], protocol: CustomProvider.Protocol | undefined) {
  if (!protocol) return variants
  if (variants.length === 0) return []
  return [...CustomProvider.reasoningEfforts[protocol]]
}
