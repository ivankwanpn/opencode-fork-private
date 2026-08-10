import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"

const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => Effect.succeed({ output: input.output, outputPaths: [] }),
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node]), [
  [ToolOutputStore.node, outputStore],
])
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

describe("P5 tool_search dynamic loading", () => {
  it.effect("materialize injects searched deferred tools into definitions", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        tool_a: defTool("tool_a", "Alpha tool for calendar events"),
        tool_b: defTool("tool_b", "Beta tool for chat history"),
      })

      const materialized = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected: new Set(["tool_a"]),
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

  test("tool_search returns structured loadable specs with defer_loading", () => {
    // tool_search is built per-materialization from the deferred list; exercise
    // the formatting function directly for the structural contract.
    const { toModelText } = require("@opencode-ai/core/tool/tool-search") as typeof import("@opencode-ai/core/tool/tool-search")
    const def = {
      name: "tool_a",
      description: "Alpha tool",
      inputSchema: { type: "object", properties: {} },
    }
    const text = toModelText([def as never])
    expect(text).toContain("tool_a")
    expect(text).toContain("Alpha tool")
  })
})

describe("P5 searched-tool flow", () => {
  it.effect("tool_search selection carries into the next materialization", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      yield* registry.register({
        calendar: defTool("calendar", "Create calendar events"),
        chat: defTool("chat", "Chat history search"),
      })

      let selected = new Set<string>()
      const materialized = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        onSelect: (names) => {
          selected = new Set(names)
        },
      })

      // model searches "calendar" → onSelect records the hit
      const search = yield* materialized.settle({
        sessionID: "ses_t" as never,
        agent: "build" as never,
        assistantMessageID: "msg_t" as never,
        call: { type: "tool-call", id: "c1", name: "tool_search", input: { query: "calendar events" } },
      })
      expect(search.result.type).toBe("text")
      expect(selected.has("calendar")).toBe(true)
      expect(selected.has("chat")).toBe(false)

      // next materialization injects the searched tool into definitions
      const next = yield* registry.materialize(undefined, undefined, {
        model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
        selected,
        onSelect: (names) => {
          selected = new Set(names)
        },
      })
      const names = (definitions: ReadonlyArray<{ name: string }>) => definitions.map((d) => d.name)
      expect(names(next.definitions)).toContain("calendar")
      expect(names(next.definitions)).not.toContain("chat")
      expect(names(next.deferred)).toContain("chat")
    }),
  )
})
