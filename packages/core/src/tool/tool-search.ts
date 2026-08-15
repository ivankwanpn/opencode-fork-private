export * as ToolSearch from "./tool-search"

import { type JsonSchema, Effect, Schema } from "effect"
import { ToolCatalog } from "./catalog"
import { Tool } from "./tool"

export const name = "tool_search"
export const DEFAULT_LIMIT = 8
export const MAX_LIMIT = 20

export const Input = Schema.Struct({
  query: Schema.String,
  limit: Schema.optional(Schema.Number).annotate({
    description: `Maximum number of matching tools to return (default: ${DEFAULT_LIMIT}, maximum: ${MAX_LIMIT})`,
  }),
})

const Source = Schema.Struct({
  type: Schema.Literals(["builtin", "plugin", "mcp", "app"]),
  id: Schema.String,
  displayName: Schema.optional(Schema.String),
})

const SourceStatus = Schema.Struct({
  source: Source,
  state: Schema.Literals(["pending", "ready", "degraded", "failed", "disabled"]),
  message: Schema.optional(Schema.String),
})

const Match = Schema.Struct({
  key: Schema.String,
  definitionHash: Schema.String,
  callableName: Schema.String,
  namespace: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.String,
  inputSchema: Schema.Unknown,
  source: Source,
  deferLoading: Schema.Literal(true),
})

export const Output = Schema.Struct({
  query: Schema.String,
  catalogRevision: Schema.String,
  matches: Schema.Array(Match),
  pendingSources: Schema.Array(SourceStatus),
})

export type Selection = {
  readonly key: ToolCatalog.Key
  readonly definitionHash: string
  readonly callableName: string
}

export type Match = Selection & {
  readonly namespace?: string
  readonly displayName?: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly source: ToolCatalog.SourceRef
  readonly deferLoading: true
}

export type Result = {
  readonly query: string
  readonly catalogRevision: string
  readonly matches: ReadonlyArray<Match>
  readonly pendingSources: ReadonlyArray<ToolCatalog.SourceStatus>
}

export class SearchError extends Schema.TaggedErrorClass<SearchError>()("ToolSearch.SearchError", {
  message: Schema.String,
}) {}

type Document = {
  readonly tool: ToolCatalog.SearchableTool
  readonly frequency: ReadonlyMap<string, number>
  readonly length: number
}

type Built = {
  readonly revision: string
  readonly documents: ReadonlyArray<Document>
  readonly documentFrequency: ReadonlyMap<string, number>
  readonly averageLength: number
}

export interface Index {
  readonly search: (
    snapshot: ToolCatalog.Snapshot,
    input: { readonly query: string; readonly limit?: number },
  ) => Effect.Effect<Result, SearchError>
  readonly builds: () => number
}

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "and", "or", "for", "in", "on", "with", "is", "are"])

export function makeIndex(): Index {
  let cached: Built | undefined
  let count = 0

  const build = (snapshot: ToolCatalog.Snapshot) => {
    if (cached?.revision === snapshot.revision) return cached
    const documents = snapshot.tools
      .filter((tool) => tool.exposure === "deferred")
      .map((tool) => {
        const terms = tokenize(searchText(tool))
        const frequency = new Map<string, number>()
        for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1)
        return { tool, frequency, length: terms.length }
      })
    const documentFrequency = new Map<string, number>()
    for (const document of documents) {
      for (const term of document.frequency.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
    cached = {
      revision: snapshot.revision,
      documents,
      documentFrequency,
      averageLength:
        documents.length === 0
          ? 0
          : documents.reduce((total, document) => total + document.length, 0) / documents.length,
    }
    count++
    return cached
  }

  const search: Index["search"] = Effect.fn("ToolSearch.search")(function* (snapshot, input) {
    const query = input.query.trim()
    if (!query) return yield* new SearchError({ message: "query must not be empty" })
    const limit = input.limit ?? DEFAULT_LIMIT
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT)
      return yield* new SearchError({ message: `limit must be an integer between 1 and ${MAX_LIMIT}` })

    const index = build(snapshot)
    const deferred = index.documents.map((document) => document.tool)
    const matches = query.toLowerCase().startsWith("select:")
      ? yield* select(query.slice(query.indexOf(":") + 1), deferred, limit)
      : (exact(query, deferred) ?? rank(query, index, limit))
    return {
      query,
      catalogRevision: snapshot.revision,
      matches: matches.map(toMatch),
      pendingSources: matches.length > 0 ? [] : snapshot.sources.filter((status) => status.state === "pending"),
    }
  })

  return { search, builds: () => count }
}

export const makeToolSearchTool = (
  snapshot: ToolCatalog.Snapshot,
  index: Index,
  onSelect?: (selections: ReadonlyArray<Selection>) => void,
) =>
  Tool.make({
    description:
      "Search deferred tools with exact selection or natural language. Use select:<exact-name> for a known callable name. Matching structured tool definitions become available on the next provider call.",
    input: Input,
    output: Output,
    execute: (input) =>
      index.search(snapshot, input).pipe(
        Effect.tap((result) =>
          Effect.sync(() =>
            onSelect?.(
              result.matches.map((match) => ({
                key: match.key,
                definitionHash: match.definitionHash,
                callableName: match.callableName,
              })),
            ),
          ),
        ),
        Effect.mapError((error) => new Tool.Failure({ message: error.message })),
      ),
    toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output) }],
  })

function select(value: string, tools: ReadonlyArray<ToolCatalog.SearchableTool>, limit: number) {
  const selectors = value.split(",").map((selector) => selector.trim())
  if (selectors.length === 0 || selectors.some((selector) => !selector))
    return Effect.fail(new SearchError({ message: "select requires one or more exact tool names" }))
  const matches: ToolCatalog.SearchableTool[] = []
  const seen = new Set<ToolCatalog.Key>()
  for (const selector of selectors) {
    const match = tools.find((tool) => tool.key === selector || tool.callableName === selector)
    if (!match) return Effect.fail(new SearchError({ message: `unknown exact tool selector: ${selector}` }))
    if (seen.has(match.key)) continue
    seen.add(match.key)
    matches.push(match)
  }
  if (matches.length > limit)
    return Effect.fail(new SearchError({ message: `select returned more than the requested limit: ${limit}` }))
  return Effect.succeed(matches)
}

function exact(query: string, tools: ReadonlyArray<ToolCatalog.SearchableTool>) {
  const match = tools.find((tool) => tool.key === query || tool.callableName === query)
  return match ? [match] : undefined
}

function rank(query: string, index: Built, limit: number) {
  if (index.documents.length === 0 || index.averageLength === 0) return []
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return []
  const count = index.documents.length
  return index.documents
    .map((document) => ({
      tool: document.tool,
      score: terms.reduce((total, term) => {
        const frequency = document.frequency.get(term) ?? 0
        if (frequency === 0) return total
        const documents = index.documentFrequency.get(term) ?? 0
        const inverse = Math.log(1 + (count - documents + 0.5) / (documents + 0.5))
        const denominator = frequency + 1.2 * (1 - 0.75 + (0.75 * document.length) / index.averageLength)
        return total + inverse * ((frequency * (1.2 + 1)) / denominator)
      }, 0),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score || compare(left.tool.key, right.tool.key))
    .slice(0, limit)
    .map((entry) => entry.tool)
}

function toMatch(tool: ToolCatalog.SearchableTool): Match {
  return {
    key: tool.key,
    definitionHash: tool.definitionHash,
    callableName: tool.callableName,
    ...(tool.namespace === undefined ? {} : { namespace: tool.namespace }),
    ...(tool.displayName === undefined ? {} : { displayName: tool.displayName }),
    description: tool.description,
    inputSchema: tool.inputSchema,
    source: tool.source,
    deferLoading: true,
  }
}

function searchText(tool: ToolCatalog.SearchableTool) {
  const parts = [
    tool.callableName,
    splitName(tool.callableName),
    tool.namespace,
    tool.source.displayName,
    tool.source.id,
    tool.displayName,
    tool.description,
    tool.searchHint,
  ].filter((part): part is string => Boolean(part?.trim()))
  schemaText(tool.inputSchema, parts)
  return parts.join(" ")
}

function schemaText(value: unknown, parts: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) schemaText(item, parts)
    return
  }
  if (!record(value)) return
  if (typeof value.title === "string") parts.push(value.title)
  if (typeof value.description === "string") parts.push(value.description)
  if (record(value.properties)) {
    for (const [name, property] of Object.entries(value.properties).toSorted(([left], [right]) =>
      compare(left, right),
    )) {
      parts.push(name, splitName(name))
      schemaText(property, parts)
    }
  }
  if (value.items !== undefined) schemaText(value.items, parts)
  for (const name of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(value[name])) schemaText(value[name], parts)
  if (Array.isArray(value.enum))
    for (const item of value.enum)
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") parts.push(String(item))
}

function tokenize(value: string) {
  return splitName(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0 && !STOPWORDS.has(term))
}

function splitName(value: string) {
  return value
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
