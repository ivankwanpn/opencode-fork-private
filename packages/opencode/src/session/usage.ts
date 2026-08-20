export * as SessionUsage from "./usage"

import type { Provider } from "@/compat/provider-wire"
import type { ProviderMetadata, Usage } from "@opencode-ai/llm"
import { Decimal } from "decimal.js"

export function calculate(input: { model: Provider.Model; usage: Usage; metadata?: ProviderMetadata }) {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, value)
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)
  const cacheReadInputTokens = safe(input.usage.cacheReadInputTokens ?? 0)
  const cacheWriteInputTokens = safe(
    Number(
      input.usage.cacheWriteInputTokens ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error provider metadata is not structurally typed by the LLM package
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error provider metadata is not structurally typed by the LLM package
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0,
    ),
  )
  const tokens = {
    total: input.usage.totalTokens,
    input: safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens),
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: { write: cacheWriteInputTokens, read: cacheReadInputTokens },
  }
  const costInfo =
    input.model.cost?.tiers
      ?.filter((item) => item.tier.type === "context" && inputTokens > item.tier.size)
      .sort((a, b) => b.tier.size - a.tier.size)[0] ??
    (input.model.cost?.experimentalOver200K && inputTokens > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost)
  const totalNanoAiu = input.metadata?.["copilot"]?.["totalNanoAiu"]
  return {
    cost:
      typeof totalNanoAiu === "number" && Number.isFinite(totalNanoAiu) && totalNanoAiu >= 0
        ? new Decimal(totalNanoAiu).div(100_000_000_000).toNumber()
        : safe(
            new Decimal(0)
              .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
              .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
              .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
              .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
              .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
              .toNumber(),
          ),
    tokens,
  }
}
