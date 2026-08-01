import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import type { Catalog } from "@opencode-ai/protocol/groups/plugin"
import { PluginCapability } from "@opencode-ai/server/plugin-capability"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { ClaudeMarketplaceManager, type ManagedMcpServer } from "./claude-marketplace"

function unavailable(action: string, error: unknown) {
  return new ServiceUnavailableError({
    message: `${action} failed: ${error instanceof Error ? error.message : String(error)}`,
    service: "plugins",
  })
}

export const layer = Layer.effect(
  PluginCapability.Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const manager = new ClaudeMarketplaceManager()

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
        return catalog
      })

    return PluginCapability.Service.of({
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

export * as NativeClaudeMarketplace from "./native-claude-marketplace"
