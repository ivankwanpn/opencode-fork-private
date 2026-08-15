import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ToolCatalog } from "@opencode-ai/core/tool/catalog"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [[ToolOutputStore.node, outputStore]])
const it = testEffect(registryLayer)

const defTool = (name: string, description: string) =>
  Tool.withExposure(
    Tool.make({
      description,
      input: Schema.Struct({}),
      output: Schema.Struct({ ok: Schema.Boolean }),
      execute: () => Effect.succeed({ ok: true }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: String(output.ok) }],
    }),
    "deferred",
  )

const selectFrom = (materialized: ToolRegistry.Materialization, name: string) => {
  const tool = materialized.catalog.tools.find((tool) => tool.callableName === name)
  if (!tool) throw new Error(`Missing catalog tool: ${name}`)
  return new Map([[tool.key, tool.definitionHash]])
}

describe("P5 tool_search dynamic loading", () => {
  it.effect("materialize injects searched deferred tools into definitions", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        tool_a: defTool("tool_a", "Alpha tool for calendar events"),
        tool_b: defTool("tool_b", "Beta tool for chat history"),
      })

      const initial = yield* registry.materialize()
      const materialized = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected: selectFrom(initial, "tool_a"),
      })
      const names = (definitions: ReadonlyArray<{ name: string }>) => definitions.map((d) => d.name)

      // tool_a was searched → injected into definitions; tool_b stays deferred.
      expect(names(materialized.definitions)).toContain("tool_a")
      expect(names(materialized.deferred)).not.toContain("tool_a")
      expect(names(materialized.definitions)).not.toContain("tool_b")
      expect(names(materialized.deferred)).toContain("tool_b")
    }),
  )

  it.effect("without a selected set, all deferred tools stay deferred", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ tool_a: defTool("tool_a", "Alpha tool") })

      const materialized = yield* registry.materialize()
      const names = (definitions: ReadonlyArray<{ name: string }>) => definitions.map((d) => d.name)
      expect(names(materialized.deferred)).toContain("tool_a")
      expect(names(materialized.definitions)).not.toContain("tool_a")
    }),
  )

  it.effect("tool_search returns structured loadable specs with deferLoading", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ tool_a: defTool("tool_a", "Alpha tool") })
      const materialized = yield* registry.materialize()
      const settlement = yield* materialized.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "search-structured", name: "tool_search", input: { query: "tool_a" } },
      })

      expect(settlement.output?.structured).toMatchObject({
        catalogRevision: materialized.catalog.revision,
        matches: [{ callableName: "tool_a", description: "Alpha tool", deferLoading: true }],
      })
    }),
  )
})

describe("P5 searched-tool flow", () => {
  it.effect("tool_search selections accumulate across materializations", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        calendar: defTool("calendar", "Create calendar events"),
        chat: defTool("chat", "Chat history search"),
      })

      let selected = new Map<ToolCatalog.Key, string>()
      const executeSearch: NonNullable<ToolRegistry.MaterializationContext["executeSearch"]> = (
        _input,
        _context,
        _snapshot,
        search,
      ) =>
        search.pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              const current = new Map(selected)
              for (const match of result.matches) current.set(match.key, match.definitionHash)
              selected = current
            }),
          ),
        )
      const materialized = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        executeSearch,
      })

      // model searches "calendar" → executeSearch records the hit
      const search = yield* materialized.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "c1", name: "tool_search", input: { query: "calendar events" } },
      })
      expect(search.result.type).toBe("text")
      expect([...selected.values()]).toHaveLength(1)

      const next = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        executeSearch,
      })
      yield* next.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "c2", name: "tool_search", input: { query: "chat history" } },
      })

      const final = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
      })
      const names = (definitions: ReadonlyArray<{ name: string }>) => definitions.map((d) => d.name)
      expect(names(final.definitions)).toContain("calendar")
      expect(names(final.definitions)).toContain("chat")
    }),
  )

  it.effect("does not authorize a replacement definition with a stale selection", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ calendar: defTool("calendar", "Original calendar tool") })
      let selected = new Map<ToolCatalog.Key, string>()
      const original = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        executeSearch: (_input, _context, _snapshot, search) =>
          search.pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                selected = new Map(result.matches.map((match) => [match.key, match.definitionHash]))
              }),
            ),
          ),
      })
      yield* original.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "search-original", name: "tool_search", input: { query: "calendar" } },
      })

      yield* registry.register({ calendar: defTool("calendar", "Replacement calendar tool") })
      const replacement = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
      })
      expect(replacement.definitions.map((definition) => definition.name)).not.toContain("calendar")
      expect(
        yield* replacement
          .settle({
            sessionID: "ses_t" as never,
            agent: "build" as never,
            assistantMessageID: "msg_t" as never,
            call: { type: "tool-call", id: "call-replacement", name: "calendar", input: {} },
          })
          .pipe(Effect.map((settlement) => settlement.result)),
      ).toEqual({
        type: "error",
        value: "unsupported call: calendar (search for it with tool_search first)",
      })
    }),
  )
})

describe("P5 settle authorization", () => {
  it.effect("rejects a deferred tool call that was never searched", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ secret: defTool("secret", "Secret tool") })

      const materialized = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected: new Map(),
      })
      const result = yield* materialized.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "c1", name: "secret", input: {} },
      })
      expect(result.result.type).toBe("error")
      expect(result.result.value).toContain("unsupported call: secret")
    }),
  )

  it.effect("runs a deferred tool that was searched in a prior turn", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({ calendar: defTool("calendar", "Calendar events") })

      const initial = yield* registry.materialize()
      const materialized = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected: selectFrom(initial, "calendar"),
      })
      const result = yield* materialized.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "c1", name: "calendar", input: {} },
      })
      expect(result.result.type).toBe("text")
    }),
  )
})
