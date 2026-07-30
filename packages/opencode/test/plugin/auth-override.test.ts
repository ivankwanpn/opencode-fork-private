import { describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { ProviderAuth } from "@/provider/auth"

import { RuntimeFlags } from "@/effect/runtime-flags"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Config } from "@/config/config"

const it = testEffect(LayerNode.compile(LayerNode.group([CrossSpawnSpawner.node, FSUtil.node])))

function providerAuthLayer(directory: string, plugins: string[]) {
  return AppNodeBuilder.build(ProviderAuth.node, [
    [
      Config.node,
      TestConfig.layer({
        get: () =>
          Effect.succeed({
            plugin: plugins,
            plugin_origins: plugins.map((plugin) => ({
              spec: plugin,
              source: path.join(directory, "opencode.json"),
              scope: "local" as const,
            })),
          }),
        directories: () => Effect.succeed([directory]),
      }),
    ],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
}

describe("plugin.auth-override", () => {
  it.instance(
    "user plugin overrides built-in github-copilot auth",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const pluginDir = path.join(tmp.directory, ".opencode", "plugin")

        yield* fs.writeWithDirs(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default {",
            '  id: "demo.custom-copilot-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "github-copilot",',
            "      methods: [",
            '        { type: "api", label: "Test Override Auth" },',
            "      ],",
            "      loader: async () => ({ access: 'test-token' }),",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )

        const plain = yield* tmpdirScoped({ git: true })
        const plugin = pathToFileURL(path.join(pluginDir, "custom-copilot-auth.ts")).href
        const methods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(tmp.directory, [plugin])))
        const plainMethods = yield* ProviderAuth.use
          .methods()
          .pipe(Effect.provide(providerAuthLayer(plain, [])), provideInstance(plain))

        const copilot = methods[ProviderV2.ID.make("github-copilot")]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
        expect(plainMethods[ProviderV2.ID.make("github-copilot")][0].label).not.toBe("Test Override Auth")
      }),
    { git: true },
    30000,
  )
})

describe("plugin.config-hook-error-isolation", () => {
  it.instance(
    "continues running config hooks after an earlier hook fails",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const fs = yield* FSUtil.Service
        const pluginDir = path.join(tmp.directory, ".opencode", "plugin")
        const marker = path.join(tmp.directory, "config-hook-fired")
        const failing = path.join(pluginDir, "failing-config.ts")
        const succeeding = path.join(pluginDir, "succeeding-config.ts")

        yield* fs.writeWithDirs(
          failing,
          [
            "export default async () => ({",
            "  config: async () => {",
            '    throw new Error("config exploded")',
            "  },",
            "})",
            "",
          ].join("\n"),
        )
        yield* fs.writeWithDirs(
          succeeding,
          [
            `const MARKER = ${JSON.stringify(marker)}`,
            "export default async () => ({",
            "  config: async () => {",
            '    await Bun.write(MARKER, "ran")',
            "  },",
            "})",
            "",
          ].join("\n"),
        )

        yield* ProviderAuth.use
          .methods()
          .pipe(
            Effect.provide(
              providerAuthLayer(tmp.directory, [pathToFileURL(failing).href, pathToFileURL(succeeding).href]),
            ),
          )

        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
      }),
    { git: true },
    30000,
  )
})
