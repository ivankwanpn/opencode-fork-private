export * as ToolSearch from "./tool-search"

import type { ToolDefinition } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"

export const name = "tool_search"
export const DEFAULT_LIMIT = 5

export const Input = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum number of matching tools to return (default: ${DEFAULT_LIMIT})`,
  }),
})

export const Output = Schema.String

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "and", "or", "for", "in", "on", "with", "is", "are"])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

function score(queryTokens: string[], doc: string): number {
  const terms = tokenize(doc)
  if (terms.length === 0) return 0
  let score = 0
  for (const qt of queryTokens) {
    const count = terms.filter((t) => t === qt).length
    if (count > 0) score += (1 + Math.log(count)) / Math.log(1 + terms.length)
  }
  return score
}

export const searchDeferred = (
  query: string,
  deferred: ReadonlyArray<ToolDefinition>,
  limit: number,
): ToolDefinition[] => {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return deferred.slice(0, limit)
  return [...deferred]
    .map((tool) => ({ tool, score: score(qTokens, `${tool.name} ${tool.description ?? ""}`) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.tool)
}

/** Format matched tool specifications (name + description + inputSchema JSON) into model-facing text. */
export const toModelText = (matches: ReadonlyArray<ToolDefinition>) =>
  matches.length === 0
    ? "No matching tools found."
    : matches.map((tool) => `${tool.name}\n${tool.description ?? ""}\n${JSON.stringify(tool.inputSchema)}`).join("\n\n")

export const makeToolSearchTool = (deferred: ReadonlyArray<ToolDefinition>) =>
  Tool.make({
    description:
      "Search for tools that are not in your current tool list. Use this when you need a tool you don't see, such as MCP or plugin tools. Describe what you want to do; matching tool names, descriptions, and input schemas are returned, and the matched tools can then be called by their exact names.",
    input: Input,
    output: Output,
    execute: (input) =>
      Effect.sync(() => toModelText(searchDeferred(input.query, deferred, input.limit ?? DEFAULT_LIMIT))),
  })

export const ToolSearchTool = makeToolSearchTool([])
