import { CustomProvider } from "@opencode-ai/schema/custom-provider"

export function modelVariantsForProtocol(variants: string[], protocol: CustomProvider.Protocol | undefined) {
  if (!protocol) return variants
  if (variants.length === 0) return []
  return [...CustomProvider.reasoningEfforts[protocol]]
}
