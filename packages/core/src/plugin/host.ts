export * as PluginHost from "./host"

import type {
  CommandRuntimeHookSpec,
  PermissionHookSpec,
  PluginContext as Interface,
  SessionHookSpec,
  ShellHookSpec,
  ToolHookSpec,
} from "@opencode-ai/plugin/v2/effect"
import { EventManifest } from "@opencode-ai/schema/event-manifest"
import { Effect, Schema, Stream } from "effect"
import { AgentV2 } from "../agent"
import { AISDK } from "../aisdk"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Credential } from "../credential"
import { EventV2 } from "../event"
import { Integration } from "../integration"
import { ModelV2 } from "../model"
import { PluginV2 } from "../plugin"
import { PluginRuntime } from "./runtime"
import { ProviderV2 } from "../provider"
import { Reference } from "../reference"
import type { DeepMutable } from "../schema"
import { SkillV2 } from "../skill"

const mutable = <T>(value: T) => value as DeepMutable<T>
const runtimes = new WeakMap<object, PluginRuntime.Interface>()

export function runtimeOf(host: Interface) {
  const runtime = runtimes.get(host)
  if (!runtime) throw new TypeError("Invalid PluginHost")
  return runtime
}

const sessionHookNames = {
  "message.before": PluginRuntime.HookName.sessionMessageBefore,
  "chat.params": PluginRuntime.HookName.sessionChatParams,
  "chat.headers": PluginRuntime.HookName.sessionChatHeaders,
  "chat.messages.transform": PluginRuntime.HookName.sessionMessagesTransform,
  "chat.system.transform": PluginRuntime.HookName.sessionSystemTransform,
  compacting: PluginRuntime.HookName.sessionCompacting,
  "compaction.autocontinue": PluginRuntime.HookName.sessionCompactionAutocontinue,
  "text.complete": PluginRuntime.HookName.sessionTextComplete,
  "session.stop": PluginRuntime.HookName.sessionStop,
  "session.subagent.stop": PluginRuntime.HookName.sessionSubagentStop,
} satisfies { readonly [Name in keyof SessionHookSpec]: PluginRuntime.HookName }

const permissionHookNames = {
  ask: PluginRuntime.HookName.permissionAsk,
} satisfies { readonly [Name in keyof PermissionHookSpec]: PluginRuntime.HookName }

const shellHookNames = {
  env: PluginRuntime.HookName.shellEnv,
} satisfies { readonly [Name in keyof ShellHookSpec]: PluginRuntime.HookName }

const toolHookNames = {
  "execute.before": PluginRuntime.HookName.toolExecuteBefore,
  "execute.after": PluginRuntime.HookName.toolExecuteAfter,
  definition: PluginRuntime.HookName.toolDefinition,
} satisfies { readonly [Name in keyof ToolHookSpec]: PluginRuntime.HookName }

const commandHookNames = {
  "execute.before": PluginRuntime.HookName.commandExecuteBefore,
} satisfies { readonly [Name in keyof CommandRuntimeHookSpec]: PluginRuntime.HookName }

const hookDomain = <Spec>(
  runtime: PluginRuntime.Interface,
  names: { readonly [Name in keyof Spec]: PluginRuntime.HookName },
) => ({
  hook: <Name extends keyof Spec & string>(
    name: Name,
    callback: (event: Spec[Name]) => Effect.Effect<void> | void,
  ) => runtime.hook(names[name], callback),
})

export const make = Effect.fn("PluginHost.make")(function* (plugin: PluginV2.Interface) {
  const agents = yield* AgentV2.Service
  const aisdk = yield* AISDK.Service
  const catalog = yield* Catalog.Service
  const commands = yield* CommandV2.Service
  const events = yield* EventV2.Service
  const integration = yield* Integration.Service
  const runtime = yield* PluginRuntime.Service
  const reference = yield* Reference.Service
  const skill = yield* SkillV2.Service

  const result = {
    options: {},
    agent: {
      reload: agents.reload,
      transform: (callback) =>
        agents.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(AgentV2.ID.make(id))),
            default: (id) => draft.default(id === undefined ? undefined : AgentV2.ID.make(id)),
            update: (id, update) => draft.update(AgentV2.ID.make(id), update),
            remove: (id) => draft.remove(AgentV2.ID.make(id)),
          }),
        ),
    },
    aisdk: {
      options: (callback) =>
        aisdk.hook.options((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void))
        }),
      sdk: (callback) =>
        aisdk.hook.sdk((event) => {
          const output = {
            model: mutable(event.model),
            package: event.package,
            options: event.options,
            sdk: event.sdk,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.sdk = output.sdk))),
          )
        }),
      language: (callback) =>
        aisdk.hook.language((event) => {
          const output = {
            model: mutable(event.model),
            sdk: event.sdk,
            options: event.options,
            language: event.language,
          }
          const result = callback(output)
          return Effect.suspend(() => (Effect.isEffect(result) ? result : Effect.void)).pipe(
            Effect.tap(() => Effect.sync(() => (event.language = output.language))),
          )
        }),
    },
    catalog: {
      reload: catalog.reload,
      transform: (callback) =>
        catalog.transform((draft) =>
          callback({
            provider: {
              list: () => mutable(draft.provider.list()),
              get: (id) => mutable(draft.provider.get(ProviderV2.ID.make(id))),
              update: (id, update) => draft.provider.update(ProviderV2.ID.make(id), update),
              remove: (id) => draft.provider.remove(ProviderV2.ID.make(id)),
            },
            model: {
              get: (providerID, modelID) =>
                mutable(draft.model.get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))),
              update: (providerID, modelID, update) =>
                draft.model.update(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID), update),
              remove: (providerID, modelID) =>
                draft.model.remove(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              default: {
                get: draft.model.default.get,
                set: (providerID, modelID) =>
                  draft.model.default.set(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID)),
              },
            },
          }),
        ),
    },
    command: {
      ...hookDomain<CommandRuntimeHookSpec>(runtime, commandHookNames),
      reload: commands.reload,
      transform: commands.transform,
    },
    event: {
      subscribe: (type) => {
        const definition = EventManifest.Latest.get(type)
        if (!definition) return Stream.die(new TypeError(`Unknown event type: ${type}`))
        return events.subscribe(definition).pipe(
          Stream.map((event) => ({
            id: event.id,
            type: event.type,
            properties: event.data,
          }) as never),
        )
      },
      all: () =>
        events.all().pipe(
          Stream.map((event) => ({
            id: event.id,
            type: event.type,
            properties: event.data,
          }) as never),
        ),
    },
    integration: {
      reload: integration.reload,
      connection: {
        active: (id) => integration.connection.active(Integration.ID.make(id)),
        resolve: (connection) =>
          integration.connection.resolve(
            connection.type === "credential" ? { ...connection, id: Credential.ID.make(connection.id) } : connection,
          ),
      },
      transform: (callback) =>
        integration.transform((draft) =>
          callback({
            list: () => mutable(draft.list()),
            get: (id) => mutable(draft.get(Integration.ID.make(id))),
            update: (id, update) => draft.update(Integration.ID.make(id), update),
            remove: (id) => draft.remove(Integration.ID.make(id)),
            method: {
              list: (id) => mutable(draft.method.list(Integration.ID.make(id))),
              update: (input) => {
                if ("authorize" in input) {
                  const methodID = Integration.MethodID.make(input.method.id)
                  const refresh = input.refresh
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { ...input.method, id: methodID },
                    authorize: (inputs) =>
                      input.authorize(inputs).pipe(
                        Effect.map((authorization) => {
                          if (authorization.mode === "auto") {
                            return {
                              ...authorization,
                              callback: authorization.callback.pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                            }
                          }
                          return {
                            ...authorization,
                            callback: (code: string) =>
                              authorization.callback(code).pipe(
                                Effect.map((credential) =>
                                  Credential.OAuth.make({
                                    ...credential,
                                    methodID: Integration.MethodID.make(credential.methodID),
                                  }),
                                ),
                              ),
                          }
                        }),
                      ),
                    ...(refresh
                      ? {
                          refresh: (value: Credential.OAuth) =>
                            refresh(value).pipe(
                              Effect.map((next) =>
                                Credential.OAuth.make({
                                  ...next,
                                  methodID: Integration.MethodID.make(next.methodID),
                                }),
                              ),
                            ),
                        }
                      : {}),
                    ...(input.label ? { label: input.label } : {}),
                  })
                  return
                }
                if (input.method.type === "env") {
                  draft.method.update({
                    integrationID: Integration.ID.make(input.integrationID),
                    method: { type: "env", names: input.method.names },
                  })
                  return
                }
                draft.method.update({
                  integrationID: Integration.ID.make(input.integrationID),
                  method: { type: "key", label: input.method.label },
                })
              },
              remove: (id, method) =>
                draft.method.remove(Integration.ID.make(id), Schema.decodeUnknownSync(Integration.Method)(method)),
            },
          }),
        ),
    },
    permission: hookDomain<PermissionHookSpec>(runtime, permissionHookNames),
    plugin: {
      add: (input) => plugin.add(PluginV2.ID.make(input.id), input.effect),
      remove: (id) => plugin.remove(PluginV2.ID.make(id)),
    },
    reference: {
      reload: reference.reload,
      transform: (callback) =>
        reference.transform((draft) =>
          callback({
            add: (name, source) => draft.add(name, Schema.decodeUnknownSync(Reference.Source)(source)),
            remove: draft.remove,
            list: draft.list,
          }),
        ),
    },
    session: hookDomain<SessionHookSpec>(runtime, sessionHookNames),
    shell: hookDomain<ShellHookSpec>(runtime, shellHookNames),
    skill: {
      reload: skill.reload,
      transform: (callback) =>
        skill.transform((draft) =>
          callback({
            source: (source) => draft.source(Schema.decodeUnknownSync(SkillV2.Source)(source)),
            list: draft.list,
          }),
        ),
    },
    tool: hookDomain<ToolHookSpec>(runtime, toolHookNames),
  } satisfies Interface
  runtimes.set(result, runtime)
  return result
})
