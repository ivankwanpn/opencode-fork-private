import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import { OpenRouter } from "../../src/providers"
import {
  AnthropicMessages,
  BedrockConverse,
  Gemini,
  OpenAIChat,
  OpenAICompatibleChat,
  OpenAIResponses,
} from "../../src/protocols"
import { Auth, LLMClient } from "../../src/route"
import { it } from "../lib/effect"

const discovery = {
  kind: "tool-search" as const,
  name: "tool_search",
  description: "Search deferred tools",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
}

const selected = {
  name: "calendar_create",
  description: "Create calendar events",
  inputSchema: { type: "object", properties: { title: { type: "string" } } },
  deferLoading: true as const,
  namespace: "calendar",
}

const input = {
  tools: [discovery, selected],
  toolDiscoveries: [
    {
      assistantMessageID: "assistant-search",
      callID: "search-1",
      query: "calendar",
      limit: 8,
      catalogRevision: "catalog-1",
      tools: [selected],
    },
  ],
  cache: "none" as const,
}

describe("generic Tool Search fallback", () => {
  it.effect("advertises discovery and selected tools through every generic protocol", () =>
    Effect.gen(function* () {
      const openAIChat = yield* LLMClient.prepare<OpenAIChat.OpenAIChatBody>(
        LLM.request({
          model: OpenAIChat.route.model({ id: "chat-model" }),
          ...input,
        }),
      )
      const openAICompatible = yield* LLMClient.prepare<OpenAIChat.OpenAIChatBody>(
        LLM.request({
          model: OpenAICompatibleChat.route
            .with({ provider: "compatible", endpoint: { baseURL: "https://compatible.test/v1" } })
            .model({ id: "compatible-model" }),
          ...input,
        }),
      )
      const openAIResponses = yield* LLMClient.prepare<OpenAIResponses.OpenAIResponsesBody>(
        LLM.request({
          model: OpenAIResponses.route.model({ id: "responses-model" }),
          ...input,
        }),
      )
      const anthropic = yield* LLMClient.prepare<AnthropicMessages.AnthropicMessagesBody>(
        LLM.request({
          model: AnthropicMessages.route.model({ id: "anthropic-model" }),
          ...input,
        }),
      )
      const gemini = yield* LLMClient.prepare<Gemini.GeminiBody>(
        LLM.request({
          model: Gemini.route.model({ id: "gemini-model" }),
          ...input,
        }),
      )
      const bedrock = yield* LLMClient.prepare<BedrockConverse.BedrockConverseBody>(
        LLM.request({
          model: BedrockConverse.route
            .with({ endpoint: { baseURL: "https://bedrock.test" }, auth: Auth.bearer("test") })
            .model({ id: "bedrock-model" }),
          ...input,
        }),
      )
      const openRouter = yield* LLMClient.prepare<OpenRouter.OpenRouterBody>(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test" }).model("openai/gpt-4o-mini"),
          ...input,
        }),
      )

      expect(openAIChat.body.tools?.map((tool) => tool.function.name)).toEqual(["tool_search", "calendar_create"])
      expect(openAICompatible.body.tools?.map((tool) => tool.function.name)).toEqual([
        "tool_search",
        "calendar_create",
      ])
      expect(openAIResponses.body.tools?.map((tool) => ("name" in tool ? tool.name : undefined))).toEqual([
        "tool_search",
        "calendar_create",
      ])
      expect(anthropic.body.tools?.map((tool) => tool.name)).toEqual(["tool_search", "calendar_create"])
      expect(gemini.body.tools?.flatMap((tool) => tool.functionDeclarations?.map((item) => item.name) ?? [])).toEqual([
        "tool_search",
        "calendar_create",
      ])
      expect(
        bedrock.body.toolConfig?.tools.flatMap((tool) => ("toolSpec" in tool ? [tool.toolSpec.name] : [])),
      ).toEqual(["tool_search", "calendar_create"])
      expect(openRouter.body.tools?.map((tool) => tool.function.name)).toEqual(["tool_search", "calendar_create"])
    }),
  )
})
