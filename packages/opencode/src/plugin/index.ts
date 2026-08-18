import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginV1Compat } from "@opencode-ai/core/plugin/v1-compat"
import { AbsolutePath } from "@opencode-ai/core/schema"
import type {
  Hooks,
  PluginInput,
  Plugin as PluginInstance,
  PluginModule,
  WorkspaceAdapter as PluginWorkspaceAdapter,
} from "@opencode-ai/plugin"
import { Config } from "@/config/config"
import { ConfigPlugin } from "@/config/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ServerAuth } from "@/server/auth"
import { CodexAuthPlugin } from "./openai/codex"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { NamedError } from "@opencode-ai/core/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { AzureAuthPlugin } from "./azure"
import { DigitalOceanAuthPlugin } from "./digitalocean"
import { XaiAuthPlugin } from "./xai"
import { ModalPlugin } from "./modal/modal"
import { SnowflakeCortexAuthPlugin } from "./snowflake-cortex"
import { DateTime, Effect, Layer, Context } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import { parsePluginSpecifier, readPluginId, readV1Plugin, resolvePluginId } from "./shared"
import { registerAdapter } from "@/control-plane/adapters"
import type { WorkspaceAdapter } from "@/control-plane/types"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstallationChannel } from "@opencode-ai/core/installation/version"
import { MarketplacePluginRuntime } from "./marketplace-runtime"

export type Entry = {
  readonly id: string
  readonly hooks: Hooks
}

type LoadedEntry = Entry & {
  readonly runtimeID?: string
}

type State = {
  readonly entries: ReadonlyArray<Entry>
}

// Hook names that follow the (input, output) => Promise<void> trigger pattern
type TriggerName = {
  [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
}[keyof Hooks]

export interface Interface {
  readonly trigger: <
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(
    name: Name,
    input: Input,
    output: Output,
  ) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly entries: () => Effect.Effect<ReadonlyArray<Entry>>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

export function experimentalWebSocketsEnabled(input: { enabled: boolean; channel?: string }) {
  return input.enabled || ["local", "dev", "beta"].includes(input.channel ?? InstallationChannel)
}

// Built-in plugins that are directly imported (not installed from npm)
function internalPlugins(flags: RuntimeFlags.Info): Array<{ id: string; plugin: PluginInstance }> {
  return [
    {
      id: "opencode/openai-codex-auth",
      plugin: (input) =>
        CodexAuthPlugin(input, {
          experimentalWebSockets: experimentalWebSocketsEnabled({ enabled: flags.experimentalWebSockets }),
        }),
    },
    { id: "opencode/github-copilot-auth", plugin: CopilotAuthPlugin },
    { id: "opencode/gitlab-auth", plugin: GitlabAuthPlugin },
    { id: "opencode/poe-auth", plugin: PoeAuthPlugin },
    { id: "opencode/cloudflare-workers-auth", plugin: CloudflareWorkersAuthPlugin },
    { id: "opencode/cloudflare-ai-gateway-auth", plugin: CloudflareAIGatewayAuthPlugin },
    { id: "opencode/azure-auth", plugin: AzureAuthPlugin },
    { id: "opencode/digitalocean-auth", plugin: DigitalOceanAuthPlugin },
    { id: "opencode/snowflake-cortex-auth", plugin: SnowflakeCortexAuthPlugin },
    { id: "opencode/xai-auth", plugin: XaiAuthPlugin },
    { id: "opencode/modal", plugin: ModalPlugin },
  ]
}

function isServerPlugin(value: unknown): value is PluginInstance {
  return typeof value === "function"
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value
  if (!value || typeof value !== "object" || !("server" in value)) return
  if (!isServerPlugin(value.server)) return
  return value.server
}

function getLegacyPlugins(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const result: PluginInstance[] = []

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    const plugin = getServerPlugin(entry)
    if (!plugin) throw new TypeError("Plugin export is not a function")
    result.push(plugin)
  }

  return result
}

async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput, runtimeID?: string): Promise<LoadedEntry[]> {
  const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
  if (plugin) {
    const id =
      runtimeID ??
      (await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg))
    return [
      {
        id,
        hooks: await (plugin as PluginModule).server(input, load.options),
        ...(runtimeID ? { runtimeID } : {}),
      },
    ]
  }

  const baseID =
    runtimeID ??
    (load.source === "file"
      ? `legacy:${load.spec}`
      : await resolvePluginId(load.source, load.spec, load.target, undefined, load.pkg))
  const result: LoadedEntry[] = []
  const legacy = getLegacyPlugins(load.mod)
  for (let index = 0; index < legacy.length; index++) {
    result.push({
      id: runtimeID && legacy.length === 1 ? runtimeID : `${baseID}#${index}`,
      hooks: await legacy[index]!(input, load.options),
      ...(runtimeID ? { runtimeID } : {}),
    })
  }
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const locations = yield* LocationServiceMap.Service
    const marketplace = yield* MarketplacePluginRuntime.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const loadedHooks: LoadedEntry[] = []
        const failures = new Map<string, string>()
        const bridge = yield* EffectBridge.make()
        const workspaceID = yield* InstanceState.workspaceID
        const location = locations
          .get(
            Location.Ref.make({
              directory: AbsolutePath.make(ctx.directory),
              workspaceID,
            }),
          )
          .pipe(Layer.orDie)

        function publishPluginError(message: string) {
          bridge.fork(
            DateTime.now.pipe(
              Effect.flatMap((timestamp) =>
                events.publish(SessionEvent.Error, {
                  timestamp,
                  error: new NamedError.Unknown({ message }).toObject(),
                }),
              ),
            ),
          )
        }

        function recordRuntimeFailure(runtimeID: string | undefined, message: string) {
          if (runtimeID) failures.set(runtimeID, message)
        }

        const { Server } = yield* Effect.promise(() => import("../server/server"))

        const serverUrl = Server.url
        const client = createOpencodeClient({
          baseUrl: serverUrl?.toString() ?? "http://localhost:4096",
          directory: ctx.directory,
          headers: ServerAuth.headers(),
          ...(serverUrl ? {} : { fetch: async (...args) => Server.Default().app.fetch(...args) }),
        })
        const cfg = yield* config.get()
        const input: PluginInput = {
          client,
          project: ctx.project,
          worktree: ctx.worktree,
          directory: ctx.directory,
          experimental_workspace: {
            register(type: string, adapter: PluginWorkspaceAdapter) {
              registerAdapter(ctx.project.id, type, adapter as WorkspaceAdapter)
            },
          },
          get serverUrl(): URL {
            return Server.url ?? new URL("http://localhost:4096")
          },
          // @ts-expect-error
          $: typeof Bun === "undefined" ? undefined : Bun.$,
        }

        for (const internal of flags.disableDefaultPlugins ? [] : internalPlugins(flags)) {
          const init = yield* Effect.tryPromise({
            try: () => internal.plugin(input),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) => Effect.logError("failed to load internal plugin", { name: internal.id, error })),
            Effect.option,
          )
          if (init._tag === "Some") loadedHooks.push({ id: internal.id, hooks: init.value })
        }

        const managed = flags.pure ? [] : yield* marketplace.sources()
        const plugins = flags.pure
          ? []
          : ConfigPlugin.deduplicatePluginOrigins([
              ...(cfg.plugin_origins ?? []),
              ...managed.map((source) => ({
                spec: source.spec,
                source: "claude-marketplace",
                scope: "global" as const,
                runtimeID: source.runtimeID,
              })),
            ])
        if (flags.pure && cfg.plugin_origins?.length) {
        }
        if (plugins.length) yield* config.waitForDependencies()

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            finish: async (load, origin) => {
              if (origin.runtimeID) failures.delete(origin.runtimeID)
              return { load, runtimeID: origin.runtimeID }
            },
            report: {
              start(_candidate) {},
              missing(candidate, _retry, message) {
                recordRuntimeFailure(candidate.origin.runtimeID, message)
              },
              error(candidate, _retry, stage, error, _resolved) {
                const spec = candidate.plan.spec
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)
                recordRuntimeFailure(candidate.origin.runtimeID, message)

                if (stage === "install") {
                  const parsed = parsePluginSpecifier(spec)
                  publishPluginError(`Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                  return
                }

                if (stage === "compatibility") {
                  publishPluginError(`Plugin ${spec} skipped: ${message}`)
                  return
                }

                if (stage === "entry") {
                  publishPluginError(`Failed to load plugin ${spec}: ${message}`)
                  return
                }

                publishPluginError(`Failed to load plugin ${spec}: ${message}`)
              },
            },
          }),
        )
        for (const item of loaded) {
          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          const init = yield* Effect.tryPromise({
            try: () => applyPlugin(item.load, input, item.runtimeID),
            catch: (err) => errorMessage(err),
          }).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => recordRuntimeFailure(item.runtimeID, error)).pipe(
                Effect.andThen(Effect.logError("failed to load plugin", { path: item.load.spec, error })),
              ),
            ),
            Effect.option,
          )
          if (init._tag === "Some") loadedHooks.push(...init.value)
        }

        // Notify plugins of current config before exposing their runtime hooks.
        for (const loaded of loadedHooks) {
          const init = yield* Effect.tryPromise({
            try: () => Promise.resolve((loaded.hooks as any).config?.(cfg)),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => recordRuntimeFailure(loaded.runtimeID, error)).pipe(
                Effect.andThen(Effect.logError("plugin config hook failed", { id: loaded.id, error })),
              ),
            ),
            Effect.option,
          )
          if (init._tag === "None" && loaded.runtimeID && !failures.has(loaded.runtimeID)) {
            recordRuntimeFailure(loaded.runtimeID, `Plugin config hook failed: ${loaded.id}`)
          }
        }

        const readyHooks = loadedHooks.filter((loaded) => !loaded.runtimeID || !failures.has(loaded.runtimeID))

        yield* Effect.gen(function* () {
          const plugins = yield* PluginV2.Service
          for (const [runtimeID, message] of failures) {
            const id = PluginV2.ID.make(runtimeID)
            yield* Effect.exit(plugins.add(id, () => Effect.die(new Error(message))))
            yield* Effect.addFinalizer(() => plugins.remove(id))
          }
          for (const loaded of readyHooks) {
            const id = PluginV2.ID.make(loaded.id)
            const adapted = PluginV1Compat.fromHooks(loaded.id, loaded.hooks)
            yield* plugins.add(id, adapted.effect)
            yield* Effect.addFinalizer(() => plugins.remove(id))
          }
        }).pipe(Effect.provide(location))

        const active: Entry[] = []
        const positions = new Map<string, number>()
        for (const loaded of readyHooks) {
          const index = positions.get(loaded.id)
          if (index === undefined) {
            positions.set(loaded.id, active.length)
            active.push(loaded)
            continue
          }
          active[index] = loaded
        }

        return { entries: active }
      }),
      { group: "plugins" },
    )

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const s = yield* InstanceState.get(state)
      for (const entry of s.entries) {
        const fn = entry.hooks[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const entries = Effect.fn("Plugin.entries")(function* () {
      const s = yield* InstanceState.get(state)
      return s.entries
    })

    const list = Effect.fn("Plugin.list")(function* () {
      return (yield* entries()).map((entry) => entry.hooks)
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ trigger, list, entries, init })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Config.node, RuntimeFlags.node, LocationServiceMap.node, MarketplacePluginRuntime.node],
})

export * as Plugin from "."
