import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
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

const hello = () =>
  Tool.withExposure(
    Tool.make({
      description: "Says hello",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.Struct({ greeting: Schema.String }),
      execute: ({ name }) => Effect.succeed({ greeting: `hello ${name}` }),
      toModelOutput: ({ output }) => [{ type: "text" as const, text: output.greeting }],
    }),
    "deferred",
  )
const bye = () =>
  Tool.make({
    description: "Says bye",
    input: Schema.Struct({}),
    output: Schema.Struct({ text: Schema.String }),
    execute: () => Effect.succeed({ text: "bye" }),
    toModelOutput: ({ output }) => [{ type: "text" as const, text: output.text }],
  })

describe("ToolExposure", () => {
  it.effect("deferred tools land in deferred, not definitions; direct tools stay in definitions", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ hello: hello(), bye: bye() })
      const m = yield* service.materialize()
      expect(m.definitions.some((d) => d.name === "hello")).toBe(false)
      expect(m.deferred.some((d) => d.name === "hello")).toBe(true)
      expect(m.definitions.some((d) => d.name === "bye")).toBe(true)
      expect(m.deferred.some((d) => d.name === "bye")).toBe(false)
    }))
})
