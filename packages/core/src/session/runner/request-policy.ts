export * as SessionRunnerRequestPolicy from "./request-policy"

import type { Model } from "@opencode-ai/llm"

const providerOptionOnlyKeys = {
  openai: ["promptCacheKey", "reasoningEffort", "reasoningSummary", "serviceTier", "textVerbosity"],
  anthropic: ["thinking"],
  gemini: ["thinkingConfig"],
} as const

export const optionKey = (model: Pick<Model, "route">) => {
  if (model.route.id === "anthropic-messages") return "anthropic"
  if (model.route.id === "gemini") return "gemini"
  return "openai"
}

export const apply = (
  body: Readonly<Record<string, unknown>>,
  provider?: "openai" | "anthropic" | "gemini",
) => {
  const options = { ...body }
  const number = (...keys: string[]) => {
    for (const key of keys) {
      const value = options[key]
      if (typeof value === "number") return value
    }
  }
  const generation = {
    temperature: number("temperature"),
    topP: number("topP", "top_p"),
    topK: number("topK", "top_k"),
    maxTokens: number("maxOutputTokens", "max_output_tokens", "maxTokens", "max_tokens"),
  }
  for (const key of [
    "temperature",
    "topP",
    "top_p",
    "topK",
    "top_k",
    "maxOutputTokens",
    "max_output_tokens",
    "maxTokens",
    "max_tokens",
  ])
    delete options[key]
  const requestBody = { ...options }
  if (provider) providerOptionOnlyKeys[provider].forEach((key) => delete requestBody[key])
  return { generation, options, body: requestBody }
}
