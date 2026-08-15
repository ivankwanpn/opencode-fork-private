import { CommandV2 } from "@opencode-ai/core/command"
import { MCP } from "@opencode-ai/core/mcp"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { SkillV2 } from "@opencode-ai/core/skill"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import type { Catalog } from "@opencode-ai/protocol/groups/plugin"
import { Plugin } from "@opencode-ai/schema/plugin"
import { Context, Effect, Layer } from "effect"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"

export interface Interface {
  readonly runtime: () => Effect.Effect<
    Plugin.RuntimeSnapshot,
    ServiceUnavailableError,
    SkillV2.Service | CommandV2.Service | MCP.Service | PluginV2.Service | ToolRegistry.Service
  >
  readonly list: () => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly addMarketplace: (source: string) => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly refreshMarketplace: (name: string) => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly removeMarketplace: (name: string) => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly install: (id: string) => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly uninstall: (id: string) => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly enable: (id: string) => Effect.Effect<Catalog, ServiceUnavailableError>
  readonly disable: (id: string) => Effect.Effect<Catalog, ServiceUnavailableError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/PluginCapability") {}

const unavailable = () =>
  Effect.fail(
    new ServiceUnavailableError({
      message: "Plugin management is unavailable on this host",
      service: "plugins",
    }),
  )

export const layer = Layer.succeed(
  Service,
  Service.of({
    runtime: () => Effect.succeed({ plugins: [] }),
    list: () => Effect.succeed({ marketplaces: [], plugins: [] }),
    addMarketplace: () => unavailable(),
    refreshMarketplace: () => unavailable(),
    removeMarketplace: () => unavailable(),
    install: () => unavailable(),
    uninstall: () => unavailable(),
    enable: () => unavailable(),
    disable: () => unavailable(),
  }),
)

export * as PluginCapability from "./plugin-capability"
