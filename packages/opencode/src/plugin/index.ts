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
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ServerAuth } from "@/server/auth"
import { CodexAuthPlugin } from "./openai/codex"
import { Session } from "@/session/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { AzureAuthPlugin } from "./azure"
import { DigitalOceanAuthPlugin } from "./digitalocean"
import { XaiAuthPlugin } from "./xai"
import { SnowflakeCortexAuthPlugin } from "./snowflake-cortex"
import { Effect, Layer, Context } from "effect"
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

type LoadedHook = {
  id: string
  hooks: Hooks
}

type State = {
  hooks: Hooks[]
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

async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput): Promise<LoadedHook[]> {
  const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
  if (plugin) {
    const id = await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
    return [{ id, hooks: await (plugin as PluginModule).server(input, load.options) }]
  }

  const baseID =
    load.source === "file"
      ? `legacy:${load.spec}`
      : await resolvePluginId(load.source, load.spec, load.target, undefined, load.pkg)
  const result: LoadedHook[] = []
  const legacy = getLegacyPlugins(load.mod)
  for (let index = 0; index < legacy.length; index++) {
    result.push({
      id: `${baseID}#${index}`,
      hooks: await legacy[index]!(input, load.options),
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

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const loadedHooks: LoadedHook[] = []
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
          bridge.fork(events.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
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
            Effect.tapError((error) =>
              Effect.logError("failed to load internal plugin", { name: internal.id, error }),
            ),
            Effect.option,
          )
          if (init._tag === "Some") loadedHooks.push({ id: internal.id, hooks: init.value })
        }

        const plugins = flags.pure ? [] : (cfg.plugin_origins ?? [])
        if (flags.pure && cfg.plugin_origins?.length) {
        }
        if (plugins.length) yield* config.waitForDependencies()

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            report: {
              start(candidate) {},
              missing(candidate, _retry, message) {},
              error(candidate, _retry, stage, error, resolved) {
                const spec = candidate.plan.spec
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)

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
        for (const load of loaded) {
          if (!load) continue

          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          const init = yield* Effect.tryPromise({
            try: () => applyPlugin(load, input),
            catch: (err) => errorMessage(err),
          }).pipe(
            Effect.tapError((error) => Effect.logError("failed to load plugin", { path: load.spec, error })),
            Effect.option,
          )
          if (init._tag === "Some") loadedHooks.push(...init.value)
        }

        // Notify plugins of current config before exposing their runtime hooks.
        for (const loaded of loadedHooks) {
          yield* Effect.tryPromise({
            try: () => Promise.resolve((loaded.hooks as any).config?.(cfg)),
            catch: errorMessage,
          }).pipe(
            Effect.tapError((error) => Effect.logError("plugin config hook failed", { id: loaded.id, error })),
            Effect.ignore,
          )
        }

        yield* Effect.gen(function* () {
          const plugins = yield* PluginV2.Service
          for (const loaded of loadedHooks) {
            const id = PluginV2.ID.make(loaded.id)
            const adapted = PluginV1Compat.fromHooks(loaded.id, loaded.hooks)
            yield* plugins.add(id, adapted.effect)
            yield* Effect.addFinalizer(() => plugins.remove(id))
          }
        }).pipe(Effect.provide(location))

        const active: LoadedHook[] = []
        const positions = new Map<string, number>()
        for (const loaded of loadedHooks) {
          const index = positions.get(loaded.id)
          if (index === undefined) {
            positions.set(loaded.id, active.length)
            active.push(loaded)
            continue
          }
          active[index] = loaded
        }

        return { hooks: active.map((loaded) => loaded.hooks) }
      }),
    )

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const s = yield* InstanceState.get(state)
      for (const hook of s.hooks) {
        const fn = hook[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const list = Effect.fn("Plugin.list")(function* () {
      const s = yield* InstanceState.get(state)
      return s.hooks
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ trigger, list, init })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, Config.node, RuntimeFlags.node, LocationServiceMap.node],
})

export * as Plugin from "."
