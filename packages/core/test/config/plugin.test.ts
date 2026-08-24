import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Option, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigExternalPlugin } from "@opencode-ai/core/config/plugin/external"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { Npm } from "@opencode-ai/core/npm"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { KernelPluginHost } from "@opencode-ai/core/session/kernel/plugin-host"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const decode = Schema.decodeUnknownSync(Config.Info)
const kernelInstalls: KernelPluginHost.PluginModule[] = []
const kernelHost = KernelPluginHost.Service.of({
  install: (module) =>
    Effect.sync(() => {
      kernelInstalls.push(module)
      return {
        id: module.manifest.id,
        version: module.manifest.version,
        generation: kernelInstalls.length,
        state: Effect.succeed("ready" as const),
        dispose: Effect.void,
      }
    }),
  disable: () => Effect.void,
  dispose: () => Effect.void,
  has: () => Effect.succeed(false),
  snapshot: () => Effect.succeed([]),
  ownedContributions: () => Effect.succeed([]),
  ui: { list: () => Effect.succeed([]) },
  services: {
    provide: () => Effect.void,
    retract: () => Effect.void,
    has: () => Effect.succeed(false),
    get: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed([]),
  },
  seams: KernelPluginHost.makeSeams(),
})
const it = testEffect(Layer.merge(PluginTestLayer, Layer.succeed(KernelPluginHost.Service, kernelHost)))

describe("ConfigExternalPlugin", () => {
  it.live("resolves and loads a configured Promise plugin with options", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)
      const document = path.join(import.meta.dir, "opencode.json")

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: document,
                  info: decode({
                    plugins: [
                      {
                        package: "../plugin/fixtures/config-promise-plugin.ts",
                        options: { description: "Loaded from config" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* agents.get(AgentV2.ID.make("configured"))).toMatchObject({
        description: "Loaded from config",
        mode: "subagent",
      })
    }),
  )

  it.live("loads a configured Effect plugin with options", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opencode.json"),
                  info: decode({
                    plugins: [
                      {
                        package: "../plugin/fixtures/config-effect-plugin.ts",
                        options: { description: "Effect plugin from config" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* agents.get(AgentV2.ID.make("effect-configured"))).toMatchObject({
        description: "Effect plugin from config",
        mode: "subagent",
      })
    }),
  )

  it.live("routes a configured structured module into KernelPluginHost", () =>
    Effect.gen(function* () {
      kernelInstalls.length = 0
      const plugins = yield* PluginV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(KernelPluginHost.Service, kernelHost),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opencode.json"),
                  info: decode({
                    plugins: ["../plugin/fixtures/config-kernel-plugin.ts"],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(kernelInstalls).toHaveLength(1)
      expect(kernelInstalls[0]?.manifest).toMatchObject({
        id: "configured-kernel",
        version: "1.0.0",
        targets: ["core"],
        capabilities: ["skill"],
      })
    }),
  )

  it.live("ignores invalid plugins and continues loading", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  path: path.join(import.meta.dir, "opencode.json"),
                  info: decode({
                    plugins: [
                      "../plugin/fixtures/missing-plugin.ts",
                      "../plugin/fixtures/invalid-plugin.ts",
                      {
                        package: "../plugin/fixtures/config-promise-plugin.ts",
                        options: { description: "Loaded after invalid plugins" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* agents.get(AgentV2.ID.make("configured"))).toMatchObject({
        description: "Loaded after invalid plugins",
      })
    }),
  )

  it.live("installs and resolves npm plugin packages", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const host = yield* PluginHost.make(plugins)
      let installed: string | undefined
      const npm = Npm.Service.of({
        add: (spec) =>
          Effect.sync(() => {
            installed = spec
            return {
              directory: import.meta.dir,
              entrypoint: path.join(import.meta.dir, "../plugin/fixtures/config-promise-plugin.ts"),
            }
          }),
        install: () => Effect.void,
        which: () => Effect.succeed(undefined),
      })

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Document({
                  type: "document",
                  info: decode({
                    plugins: [
                      {
                        package: "example-plugin@1.0.0",
                        options: { description: "Installed from npm" },
                      },
                    ],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(yield* agents.get(AgentV2.ID.make("configured"))).toMatchObject({
        description: "Installed from npm",
      })
      expect(installed).toBe("example-plugin@1.0.0")
    }),
  )

  it.live("loads plugin files from config directories", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const agents = yield* AgentV2.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const npm = yield* Npm.Service
      const host = yield* PluginHost.make(plugins)

      yield* ConfigExternalPlugin.Plugin.effect(host).pipe(
        Effect.provideService(PluginV2.Service, plugins),
        Effect.provideService(FSUtil.Service, fs),
        Effect.provideService(Location.Service, location),
        Effect.provideService(Npm.Service, npm),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Directory({
                  type: "directory",
                  path: AbsolutePath.make(path.join(import.meta.dir, "fixtures")),
                }),
              ]),
          }),
        ),
      )

      expect(yield* agents.get(AgentV2.ID.make("directory"))).toMatchObject({
        description: "Loaded from plugin directory",
        mode: "subagent",
      })
    }),
  )
})
