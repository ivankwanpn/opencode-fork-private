import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import { pathToFileURL } from "url"
import { Account } from "../../src/account/account"
import { Credential } from "@opencode-ai/core/credential"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin/index"

import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { locationServiceMapReplacement } from "../lib/location-service-map"
import { AccountTest } from "../fake/account"
import { CredentialTest } from "../fake/credential"
import { NpmTest } from "../fake/npm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, CrossSpawnSpawner.node]), [
    [Credential.node, CredentialTest.empty],
    [Account.node, AccountTest.empty],
    [Npm.node, NpmTest.noop],
    [RuntimeFlags.node, RuntimeFlags.layer({ disableDefaultPlugins: true })],
    locationServiceMapReplacement,
  ]),
)
const systemHook = "experimental.chat.system.transform"

function withProjects<A, E, R>(sources: readonly string[], self: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const test = yield* TestInstance
    const files = sources.map((_, index) => path.join(test.directory, `plugin-${index}.ts`))
    yield* Effect.all(
      [
        ...sources.map((source, index) => Effect.promise(() => Bun.write(files[index]!, source))),
        Effect.promise(() =>
          Bun.write(
            path.join(test.directory, "opencode.json"),
            JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                plugin: files.map((file) => pathToFileURL(file).href),
              },
              null,
              2,
            ),
          ),
        ),
      ],
      { discard: true, concurrency: "unbounded" },
    )
    return yield* self
  })
}

function withProject<A, E, R>(source: string, self: Effect.Effect<A, E, R>) {
  return withProjects([source], self)
}

const triggerSystemTransform = Effect.fn("PluginTriggerTest.triggerSystemTransform")(function* () {
  const plugin = yield* Plugin.Service
  const out = { system: [] as string[] }
  yield* plugin.trigger(
    systemHook,
    {
      model: {
        providerID: ProviderV2.ID.anthropic,
        modelID: ModelV2.ID.make("claude-sonnet-4-6"),
      },
    },
    out,
  )
  return out.system
})

describe("plugin.trigger", () => {
  it.instance("runs synchronous hooks without crashing", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
        '    output.system.unshift("sync")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["sync"])
      }),
    ),
  )

  it.instance("awaits asynchronous hooks", () =>
    withProject(
      [
        "export default async () => ({",
        `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
        "    await Bun.sleep(1)",
        '    output.system.unshift("async")',
        "  },",
        "})",
        "",
      ].join("\n"),
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["async"])
      }),
    ),
  )

  it.instance("runs hooks sequentially in plugin order with shared output mutations", () =>
    withProjects(
      [
        [
          "export default async () => ({",
          `  ${JSON.stringify(systemHook)}: async (_input, output) => {`,
          "    await Bun.sleep(1)",
          '    output.system.push("first")',
          "  },",
          "})",
          "",
        ].join("\n"),
        [
          "export default async () => ({",
          `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
          '    output.system.push("second:" + output.system.join(","))',
          "  },",
          "})",
          "",
        ].join("\n"),
      ],
      Effect.gen(function* () {
        expect(yield* triggerSystemTransform()).toEqual(["first", "second:first"])
      }),
    ),
  )

  it.instance("stops before later hooks when a hook fails", () =>
    withProjects(
      [
        [
          "export default async () => ({",
          `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
          '    output.system.push("first")',
          '    throw new Error("hook failed")',
          "  },",
          "})",
          "",
        ].join("\n"),
        [
          "export default async () => ({",
          `  ${JSON.stringify(systemHook)}: (_input, output) => {`,
          '    output.system.push("second")',
          "  },",
          "})",
          "",
        ].join("\n"),
      ],
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const output = { system: [] as string[] }
        const exit = yield* plugin
          .trigger(
            systemHook,
            {
              model: {
                providerID: ProviderV2.ID.anthropic,
                modelID: ModelV2.ID.make("claude-sonnet-4-6"),
              },
            },
            output,
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(output.system).toEqual(["first"])
      }),
    ),
  )
})
