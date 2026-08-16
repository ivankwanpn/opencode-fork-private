export * as ToolCatalog from "./catalog"

import type { ToolDefinition } from "@opencode-ai/llm"
import { type JsonSchema, Schema } from "effect"
import { Hash } from "../util/hash"

export const Key = Schema.String.pipe(Schema.brand("ToolCatalog.Key"))
export type Key = typeof Key.Type

export type SourceRef = {
  readonly type: "builtin" | "plugin" | "mcp" | "app"
  readonly id: string
  readonly displayName?: string
}

export type SourceState = "pending" | "ready" | "degraded" | "failed" | "disabled"

export type SourceStatus = {
  readonly source: SourceRef
  readonly state: SourceState
  readonly message?: string
}

export type Metadata = {
  readonly source: SourceRef
  readonly sourceLocalID: string
  readonly namespace?: string
  readonly displayName?: string
  readonly searchHint?: string
}

export type Exposure = "direct" | "deferred" | "hidden"

export type SearchableTool = Metadata & {
  readonly key: Key
  readonly callableName: string
  readonly description: string
  readonly inputSchema: JsonSchema.JsonSchema
  readonly outputSchema?: JsonSchema.JsonSchema
  readonly exposure: Exposure
  readonly definitionHash: string
}

export type Snapshot = {
  readonly revision: string
  readonly tools: ReadonlyArray<SearchableTool>
  readonly sources: ReadonlyArray<SourceStatus>
}

export function sourceKey(source: SourceRef) {
  return canonical([source.type, source.id])
}

export function key(source: SourceRef, sourceLocalID: string) {
  return Key.make(`tool_${hash(["tool", source.type, source.id, sourceLocalID])}`)
}

export function definitionHash(input: {
  readonly definition: ToolDefinition
  readonly exposure: Exposure
  readonly metadata: Metadata
}) {
  return hash({
    callableName: input.definition.name,
    description: input.definition.description ?? "",
    inputSchema: input.definition.inputSchema,
    outputSchema: input.definition.outputSchema,
    exposure: input.exposure,
    source: {
      type: input.metadata.source.type,
      id: input.metadata.source.id,
    },
    sourceLocalID: input.metadata.sourceLocalID,
  })
}

export function snapshot(input: {
  readonly tools: ReadonlyArray<SearchableTool>
  readonly sources: ReadonlyArray<SourceStatus>
}): Snapshot {
  const tools = input.tools
    .map((tool) =>
      Object.freeze({
        ...tool,
        source: Object.freeze({ ...tool.source }),
      }),
    )
    .toSorted((left, right) => compare(left.key, right.key))
  const sources = input.sources
    .map((status) =>
      Object.freeze({
        ...status,
        source: Object.freeze({ ...status.source }),
      }),
    )
    .toSorted((left, right) => compare(sourceKey(left.source), sourceKey(right.source)))
  return Object.freeze({
    revision: hash({ tools, sources }),
    tools: Object.freeze(tools),
    sources: Object.freeze(sources),
  })
}

function hash(value: unknown) {
  return Hash.sha256(canonical(value))
}

function canonical(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item === undefined ? null : item)).join(",")}]`
  if (typeof value !== "object") throw new TypeError(`Canonical JSON does not support ${typeof value}`)
  return `{${Object.entries(value)
    .filter((entry) => entry[1] !== undefined)
    .toSorted(([left], [right]) => compare(left, right))
    .map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`)
    .join(",")}}`
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
