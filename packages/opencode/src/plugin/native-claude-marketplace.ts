import { CommandV2 } from "@opencode-ai/core/command"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { MCP } from "@opencode-ai/core/mcp"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { EventV2 } from "@opencode-ai/core/event"
import { Event } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { SkillV2 } from "@opencode-ai/core/skill"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import type { Catalog } from "@opencode-ai/protocol/groups/plugin"
import { PluginCapability } from "@opencode-ai/server/plugin-capability"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { ClaudeMarketplaceManager, type ManagedMcpServer } from "./claude-marketplace"
import { runtimeSnapshot } from "./runtime-readiness"
import { Plugin } from "."

function unavailable(action: string, error: unknown) {
  return new ServiceUnavailableError({
    message: `${action} failed: ${error instanceof Error ? error.message : String(error)}`,
    service: "plugins",
  })
}

export const layerWith = (manager: ClaudeMarketplaceManager) =>
  Layer.effect(
    PluginCapability.Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const locations = yield* LocationServiceMap.Service
      const events = yield* EventV2.Service
      const legacyPlugins = yield* Plugin.Service

      const run = <A>(action: string, task: () => Promise<A>) =>
        Effect.tryPromise({
          try: task,
          catch: (error) => unavailable(action, error),
        })

      const syncMcp = Effect.fn("ClaudeMarketplace.syncMcp")(function* (
        previousKeys: string[],
        nextServers: Record<string, ManagedMcpServer>,
      ) {
        const current = yield* config.getGlobal()
        const servers = { ...(current.mcp ?? {}) } as Record<string, ManagedMcpServer | { enabled: boolean }>
        for (const key of previousKeys) delete servers[key]
        for (const key of Object.keys(nextServers)) {
          if (key in servers) {
            return yield* new ServiceUnavailableError({
              message: `MCP server key is already configured: ${key}`,
              service: "plugins",
            })
          }
        }
        Object.assign(servers, nextServers)

        const mcp = Object.keys(servers).length ? servers : undefined
        yield* config.updateGlobal({ ...current, mcp })
      })

      const mutate = (action: string, task: () => Promise<Catalog>) =>
        Effect.gen(function* () {
          const previousKeys = yield* run(`${action} state lookup`, () => manager.managedMcpKeys())
          const catalog = yield* run(action, task)
          const nextServers = yield* run(`${action} MCP lookup`, () => manager.enabledMcpServers())
          yield* syncMcp(previousKeys, nextServers)
          yield* Effect.promise(() => InstanceState.invalidateGroup("plugins"))
          if (locations.invalidateAll) yield* locations.invalidateAll()
          yield* events.publish(Event.Updated, {})
          return catalog
        })

      return PluginCapability.Service.of({
        runtime: () =>
          Effect.gen(function* () {
            const skills = yield* SkillV2.Service
            const commands = yield* CommandV2.Service
            const mcp = yield* MCP.Service
            const plugins = yield* PluginV2.Service
            const tools = yield* ToolRegistry.Service
            yield* legacyPlugins.init()
            const descriptors = yield* run("Reading plugin runtime descriptors", () => manager.runtimeDescriptors())
            return runtimeSnapshot(descriptors, {
              skills: yield* skills.list(),
              commands: yield* commands.list(),
              mcp: yield* mcp.status(),
              plugins: yield* plugins.status(),
              toolSources: yield* tools.sources(),
            })
          }),
        list: () => run("Listing plugins", () => manager.list()),
        addMarketplace: (source) => mutate("Adding marketplace", () => manager.addMarketplace(source)),
        refreshMarketplace: (name) => mutate("Refreshing marketplace", () => manager.refreshMarketplace(name)),
        removeMarketplace: (name) => mutate("Removing marketplace", () => manager.removeMarketplace(name)),
        install: (id) => mutate("Installing plugin", () => manager.install(id)),
        uninstall: (id) => mutate("Uninstalling plugin", () => manager.uninstall(id)),
        enable: (id) => mutate("Enabling plugin", () => manager.enable(id)),
        disable: (id) => mutate("Disabling plugin", () => manager.disable(id)),
      })
    }),
  )

export const layer = layerWith(new ClaudeMarketplaceManager())

export * as NativeClaudeMarketplace from "./native-claude-marketplace"
