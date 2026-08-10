export * as VariantPlugin from "./variant"

import type { ModelV2Info } from "@opencode-ai/sdk/v2/types"
import { Effect } from "effect"
import type { ModelsDev } from "../models-dev"
import { define } from "./internal"

const OUTPUT_TOKEN_MAX = 32_000
const INCLUDE_ENCRYPTED_REASONING = ["reasoning.encrypted_content"]

export const Plugin = define({
  id: "variant",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          catalog.model.update(model.providerID, model.id, (draft) => {
            const generated = generate(draft)
            if (generated.length === 0) return

            const explicit = new Map(draft.variants.map((variant) => [variant.id, variant]))
            const generatedIDs = new Set(generated.map((variant) => variant.id))
            draft.variants = [
              ...generated.map((variant) => explicit.get(variant.id) ?? variant),
              ...draft.variants.filter((variant) => !generatedIDs.has(variant.id)),
            ]
          })
        }
      }
    })
  }),
})

export function generate(
  model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">,
  reasoningOptions?: ModelsDev.Model["reasoning_options"],
): ModelV2Info["variants"] {
  if (reasoningOptions !== undefined) {
    if (reasoningOptions.length === 0) return []

    const effort = reasoningOptions.find((option) => option.type === "effort")
    if (effort) return effortVariants(model, effort.values)

    const toggle = reasoningOptions.some((option) => option.type === "toggle")
    const budget = reasoningOptions.find((option) => option.type === "budget_tokens")
    if (!budget) return toggle ? reasoningToggle(model) : []

    return [
      ...new Map(
        [...(toggle ? reasoningToggle(model) : []), ...budgetVariants(model, budget.min, budget.max)].map((variant) => [
          variant.id,
          variant,
        ]),
      ).values(),
    ]
  }

  if (model.api.type !== "aisdk" || model.api.package !== "@ai-sdk/openai-compatible") return []
  const ids = `${model.id} ${model.api.id}`.toLowerCase()
  if (!["glm-5.2", "glm-5-2", "glm-5p2"].some((name) => ids.includes(name))) return []
  return ["high", "max"].map((id) => ({
    id,
    headers: {},
    body: { reasoning_effort: id },
  }))
}

function effortVariants(
  model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">,
  values: readonly (string | null)[],
): ModelV2Info["variants"] {
  return values.flatMap((value) => {
    const id = value ?? "none"
    const body = reasoningEffort(model, id)
    return body ? [{ id, headers: {}, body }] : []
  })
}

function budgetVariants(
  model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">,
  min?: number,
  max?: number,
): ModelV2Info["variants"] {
  const maximum = Math.min(max ?? OUTPUT_TOKEN_MAX - 1, model.limit.output - 1, OUTPUT_TOKEN_MAX - 1)
  if (maximum <= 0) return []
  const high = Math.min(Math.max(min ?? 0, Math.floor((maximum + 1) / 2)), maximum)
  return [
    { id: "high", budget: high },
    { id: "max", budget: maximum },
  ].flatMap((item) => {
    const body = reasoningBudget(model, item.budget)
    return body ? [{ id: item.id, headers: {}, body }] : []
  })
}

function reasoningToggle(
  model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">,
): ModelV2Info["variants"] {
  if (model.api.type !== "aisdk") return []
  if (model.api.package === "@ai-sdk/alibaba")
    return [
      { id: "none", headers: {}, body: { enableThinking: false } },
      { id: "high", headers: {}, body: { enableThinking: true } },
    ]
  if (model.api.package === "@ai-sdk/cohere")
    return [
      { id: "none", headers: {}, body: { thinking: { type: "disabled" } } },
      { id: "high", headers: {}, body: { thinking: { type: "enabled" } } },
    ]
  return []
}

function reasoningEffort(
  model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">,
  effort: string,
): Record<string, unknown> | undefined {
  if (model.api.type !== "aisdk") return
  switch (model.api.package) {
    case "@openrouter/ai-sdk-provider":
      return { reasoning: { effort } }
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return anthropicEffort(model, effort) ?? { effort }
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
    case "@ai-sdk/amazon-bedrock":
      if (anthropicAdaptiveEfforts(model.api.id))
        return {
          reasoningConfig: {
            type: "adaptive",
            maxReasoningEffort: effort,
            ...(anthropicOmitsThinking(model.api.id) ? { display: "summarized" } : {}),
          },
        }
      if (anthropicOpus45(model.api.id))
        return {
          reasoningConfig: {
            type: "enabled",
            budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
            maxReasoningEffort: effort,
          },
        }
      if (model.api.id.includes("anthropic")) return
      return { reasoningConfig: { type: "enabled", maxReasoningEffort: effort } }
    case "@ai-sdk/gateway":
      if (model.id.includes("anthropic")) return { thinking: { type: "adaptive", display: "summarized" }, effort }
      if (model.id.includes("google")) return { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } }
      return { reasoningEffort: effort }
    case "@ai-sdk/github-copilot":
      if (model.id.includes("gemini")) return
      if (model.id.includes("claude")) return { reasoningEffort: effort }
      return { reasoningEffort: effort, reasoningSummary: "auto", include: INCLUDE_ENCRYPTED_REASONING }
    case "@ai-sdk/openai":
    case "@ai-sdk/amazon-bedrock/mantle":
    case "@ai-sdk/azure":
      return { reasoningEffort: effort, reasoningSummary: "auto", include: INCLUDE_ENCRYPTED_REASONING }
    case "@jerome-benoit/sap-ai-provider-v2":
      if (model.id.includes("anthropic"))
        return { modelParams: { thinking: { type: "adaptive", display: "summarized" }, output_config: { effort } } }
      return { modelParams: { reasoning_effort: effort } }
    case "@ai-sdk/openai-compatible":
    case "@ai-sdk/xai":
    case "@ai-sdk/mistral":
    case "@ai-sdk/groq":
    case "@ai-sdk/cerebras":
    case "@ai-sdk/deepinfra":
    case "@ai-sdk/togetherai":
    case "venice-ai-sdk-provider":
    case "ai-gateway-provider":
      return { reasoningEffort: effort }
    case "@ai-sdk/cohere":
    case "@ai-sdk/perplexity":
    case "@ai-sdk/vercel":
    case "@ai-sdk/alibaba":
    case "gitlab-ai-provider":
      return
  }
}

function reasoningBudget(
  model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">,
  budget: number,
): Record<string, unknown> | undefined {
  if (model.api.type !== "aisdk") return
  switch (model.api.package) {
    case "@openrouter/ai-sdk-provider":
      return { reasoning: { max_tokens: budget } }
    case "@ai-sdk/anthropic":
    case "@ai-sdk/google-vertex/anthropic":
      return { thinking: { type: "enabled", budgetTokens: budget } }
    case "@ai-sdk/google":
    case "@ai-sdk/google-vertex":
      return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
    case "@ai-sdk/amazon-bedrock":
      return { reasoningConfig: { type: "enabled", budgetTokens: budget } }
    case "@ai-sdk/gateway":
      if (model.id.includes("anthropic")) return { thinking: { type: "enabled", budgetTokens: budget } }
      if (model.id.includes("google")) return { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } }
      return
    case "@ai-sdk/cohere":
      return { thinking: { type: "enabled", tokenBudget: budget } }
    case "@ai-sdk/alibaba":
      return { enableThinking: true, thinkingBudget: budget }
    case "@jerome-benoit/sap-ai-provider-v2":
      if (model.id.includes("anthropic"))
        return { modelParams: { thinking: { type: "enabled", budget_tokens: budget } } }
      if (model.id.includes("gemini"))
        return { modelParams: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } } }
      return
    case "@ai-sdk/amazon-bedrock/mantle":
    case "@ai-sdk/azure":
    case "@ai-sdk/cerebras":
    case "@ai-sdk/deepinfra":
    case "@ai-sdk/github-copilot":
    case "@ai-sdk/groq":
    case "@ai-sdk/mistral":
    case "@ai-sdk/openai":
    case "@ai-sdk/openai-compatible":
    case "@ai-sdk/perplexity":
    case "@ai-sdk/togetherai":
    case "@ai-sdk/vercel":
    case "@ai-sdk/xai":
    case "ai-gateway-provider":
    case "gitlab-ai-provider":
    case "venice-ai-sdk-provider":
      return
  }
}

function anthropicEffort(model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">, effort: string) {
  if (anthropicOpus45(model.api.id))
    return {
      thinking: {
        type: "enabled",
        budgetTokens: Math.min(16_000, Math.floor(model.limit.output / 2 - 1)),
      },
      effort,
    }
  if (isKimiFamily(model)) return { thinking: { type: "adaptive", display: "summarized" }, effort }
  if (!anthropicAdaptiveEfforts(model.api.id)) return
  return {
    thinking: {
      type: "adaptive",
      ...(anthropicOmitsThinking(model.api.id) ? { display: "summarized" } : {}),
    },
    effort,
  }
}

function isKimiFamily(model: Pick<ModelV2Info, "id" | "providerID" | "api" | "limit">) {
  if (
    [model.providerID, model.api.id].some((id) => {
      const value = id.toLowerCase()
      return value.includes("kimi") || value.includes("moonshot")
    })
  )
    return true
  const url = model.api.url?.toLowerCase() ?? ""
  return ["api.kimi.com", "api.moonshot.ai", "api.moonshot.cn", "api.moonshotai.cn"].some((host) => url.includes(host))
}

function anthropicUsesModernAdaptiveThinking(apiID: string) {
  if (!apiID.toLowerCase().includes("claude-")) return false
  const version = /claude-(?:[a-z]+-)?(\d+)(?:[.-](\d{1,2}))?(?:[.@-]|$)/i.exec(apiID)
  if (!version) return true
  const major = Number(version[1])
  const minor = Number(version[2] ?? 0)
  return major > 4 || (major === 4 && minor >= 7)
}

function anthropicOpus45(apiID: string) {
  return ["opus-4-5", "opus-4.5"].some((value) => apiID.includes(value))
}

function anthropicAdaptiveEfforts(apiID: string) {
  if (anthropicUsesModernAdaptiveThinking(apiID)) return ["low", "medium", "high", "xhigh", "max"]
  if (
    ["opus-4-6", "opus-4.6", "4-6-opus", "4.6-opus", "sonnet-4-6", "sonnet-4.6", "4-6-sonnet", "4.6-sonnet"].some(
      (value) => apiID.includes(value),
    )
  )
    return ["low", "medium", "high", "max"]
  return null
}

function anthropicOmitsThinking(apiID: string) {
  return anthropicUsesModernAdaptiveThinking(apiID)
}
