import { describe, expect } from "bun:test"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { TestInstance } from "../fixture/fixture"

import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Plugin } from "@/plugin"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Plugin.node, LocationServiceMap.node, CrossSpawnSpawner.node, FSUtil.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [LocationServiceMap.node, locationServiceMapLayer],
  ]),
)

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

        const plugins = yield* Plugin.Service
        const locations = yield* LocationServiceMap.Service
        const workspaceID = yield* InstanceState.workspaceID
        yield* plugins.init()
        const integration = yield* Integration.Service.use((service) =>
          service.get(Integration.ID.make("github-copilot")),
        ).pipe(
          Effect.provide(
            locations.get(
              Location.Ref.make({
                directory: AbsolutePath.make(tmp.directory),
                ...(workspaceID === undefined ? {} : { workspaceID }),
              }),
            ),
          ),
        )

        const key = integration?.methods.find((method) => method.type === "key")
        expect(key?.label).toBe("Test Override Auth")
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

        const plugins = yield* Plugin.Service
        yield* plugins.init()

        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(true)
      }),
    { git: true },
    30000,
  )
})
