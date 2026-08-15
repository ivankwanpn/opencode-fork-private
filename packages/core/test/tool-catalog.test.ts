import { describe, expect, test } from "bun:test"
import { ToolDefinition } from "@opencode-ai/llm"
import { ToolCatalog } from "@opencode-ai/core/tool/catalog"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect, Schema } from "effect"

const plugin = { type: "plugin" as const, id: "calendar@market", displayName: "Calendar" }
const mcp = { type: "mcp" as const, id: "calendar", displayName: "Calendar MCP" }

const definition = (description: string, inputSchema: Record<string, unknown> = {}) =>
  new ToolDefinition({
    kind: "function",
    name: "calendar_create",
    description,
    inputSchema,
    outputSchema: { type: "object", properties: { eventID: { type: "string" } } },
  })

const searchable = (
  source: ToolCatalog.SourceRef,
  sourceLocalID: string,
  current = definition("Create a calendar event", {
    type: "object",
    properties: { title: { type: "string" }, date: { type: "string" } },
    required: ["title", "date"],
  }),
  exposure: ToolCatalog.Exposure = "deferred",
): ToolCatalog.SearchableTool => ({
  key: ToolCatalog.key(source, sourceLocalID),
  source,
  sourceLocalID,
  callableName: current.name,
  namespace: "calendar",
  displayName: "Create event",
  description: current.description ?? "",
  searchHint: "schedule a meeting",
  inputSchema: current.inputSchema,
  ...(current.outputSchema === undefined ? {} : { outputSchema: current.outputSchema }),
  exposure,
  definitionHash: ToolCatalog.definitionHash({
    definition: current,
    exposure,
    metadata: { source, sourceLocalID, namespace: "calendar", displayName: "Create event", searchHint: "schedule a meeting" },
  }),
})

describe("ToolCatalog", () => {
  test("keys use source ownership and source-local identity rather than callable display data", () => {
    const first = ToolCatalog.key(plugin, "create_event")
    expect(first).toBe(ToolCatalog.key(plugin, "create_event"))
    expect(new Set([
      first,
      ToolCatalog.key(mcp, "create_event"),
      ToolCatalog.key(plugin, "delete_event"),
    ])).toHaveLength(3)
    expect(first).toMatch(/^tool_[0-9a-f]{64}$/)
  })

  test("definition hashes canonicalize JSON object order and cover every execution-relevant definition field", () => {
    const left = definition("Create a calendar event", {
      type: "object",
      properties: { title: { type: "string" }, date: { type: "string" } },
      required: ["title", "date"],
    })
    const right = definition("Create a calendar event", {
      required: ["title", "date"],
      properties: { date: { type: "string" }, title: { type: "string" } },
      type: "object",
    })
    const metadata = { source: plugin, sourceLocalID: "create_event" }
    const hash = ToolCatalog.definitionHash({ definition: left, exposure: "deferred", metadata })

    expect(ToolCatalog.definitionHash({ definition: right, exposure: "deferred", metadata })).toBe(hash)
    expect(
      ToolCatalog.definitionHash({
        definition: definition("Create and invite attendees", left.inputSchema as Record<string, unknown>),
        exposure: "deferred",
        metadata,
      }),
    ).not.toBe(hash)
    expect(ToolCatalog.definitionHash({ definition: left, exposure: "direct", metadata })).not.toBe(hash)
    expect(
      ToolCatalog.definitionHash({ definition: left, exposure: "deferred", metadata: { ...metadata, source: mcp } }),
    ).not.toBe(hash)
    expect(
      ToolCatalog.definitionHash({
        definition: new ToolDefinition({ ...left, name: "calendar_update" }),
        exposure: "deferred",
        metadata,
      }),
    ).not.toBe(hash)
  })

  test("snapshot revision is deterministic and changes with definitions or source state", () => {
    const create = searchable(plugin, "create_event")
    const remove = searchable(
      plugin,
      "remove_event",
      new ToolDefinition({
        kind: "function",
        name: "calendar_remove",
        description: "Remove a calendar event",
        inputSchema: { type: "object", properties: { eventID: { type: "string" } } },
      }),
    )
    const ready = { source: plugin, state: "ready" as const }
    const first = ToolCatalog.snapshot({ tools: [create, remove], sources: [ready] })
    const reordered = ToolCatalog.snapshot({ tools: [remove, create], sources: [ready] })

    expect(first).toEqual(reordered)
    expect(first.tools.map((tool) => tool.key)).toEqual([...first.tools.map((tool) => tool.key)].toSorted())
    expect(first.revision).toMatch(/^[0-9a-f]{64}$/)
    expect(ToolCatalog.snapshot({ tools: [create, remove], sources: [{ source: plugin, state: "failed" }] }).revision)
      .not.toBe(first.revision)
    expect(
      ToolCatalog.snapshot({
        tools: [{ ...create, definitionHash: "changed" }, remove],
        sources: [ready],
      }).revision,
    ).not.toBe(first.revision)
  })

  test("catalog metadata decoration is immutable and isolated from the original Tool", () => {
    const original = Tool.make({
      description: "Create a calendar event",
      input: Schema.Struct({ title: Schema.String }),
      output: Schema.Struct({ eventID: Schema.String }),
      execute: ({ title }) => Effect.succeed({ eventID: title }),
    })
    const metadata = {
      source: plugin,
      sourceLocalID: "create_event",
      namespace: "calendar",
      displayName: "Create event",
      searchHint: "schedule a meeting",
    }
    const decorated = Tool.withCatalog(original, metadata)

    expect(Tool.catalog(decorated)).toEqual(metadata)
    expect(Tool.catalog(original)).toBeUndefined()
    expect(Object.isFrozen(Tool.catalog(decorated))).toBe(true)
    expect(Object.isFrozen(Tool.catalog(decorated)?.source)).toBe(true)
  })
})
