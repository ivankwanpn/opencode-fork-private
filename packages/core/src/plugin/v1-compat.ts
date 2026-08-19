export * as PluginV1Compat from "./v1-compat"

import { define, type MutableValue, type PluginContext, type ProviderContext } from "@opencode-ai/plugin/v2/effect"
import type { Auth, Model, ModelV2Info, Provider } from "@opencode-ai/sdk/v2/types"
import { Effect, Stream } from "effect"
import { Credential } from "../credential"
import { Integration } from "../integration"
import { ModelV2 } from "../model"
import { PluginHost } from "./host"
import { PluginRuntime } from "./runtime"
import { PluginV1Projection } from "./v1-projection"
import { ProviderV2 } from "../provider"

type RuntimeHook = (input: any, output: any) => Promise<void>

type LegacyAuthPrompt =
  | {
      readonly type: "text"
      readonly key: string
      readonly message: string
      readonly placeholder?: string
      readonly validate?: (value: string) => string | undefined
      readonly condition?: (inputs: Record<string, string>) => boolean
      readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
    }
  | {
      readonly type: "select"
      readonly key: string
      readonly message: string
      readonly options: readonly { readonly label: string; readonly value: string; readonly hint?: string }[]
      readonly condition?: (inputs: Record<string, string>) => boolean
      readonly when?: { readonly key: string; readonly op: "eq" | "neq"; readonly value: string }
    }

type LegacyAuthHook = {
  readonly provider: string
  readonly loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  readonly methods?: readonly (
    | {
        readonly type: "oauth"
        readonly label: string
        readonly prompts?: readonly LegacyAuthPrompt[]
        readonly authorize: (inputs?: Record<string, string>) => Promise<LegacyOAuthAuthorization>
      }
    | {
      readonly type: "api"
      readonly label: string
      readonly prompts?: readonly LegacyAuthPrompt[]
      readonly authorize?: (inputs?: Record<string, string>) => Promise<LegacyAPIResult>
      }
  )[]
}

export interface Hooks {
  readonly dispose?: () => Promise<void>
  readonly event?: (input: { event: any }) => Promise<void>
  readonly auth?: LegacyAuthHook
  readonly provider?: {
    readonly id: string
    readonly models?: (provider: Provider, context: { auth?: Auth }) => Promise<Record<string, Model>>
  }
  readonly "chat.message"?: RuntimeHook
  readonly "chat.params"?: RuntimeHook
  readonly "chat.headers"?: RuntimeHook
  readonly "permission.ask"?: RuntimeHook
  readonly "command.execute.before"?: RuntimeHook
  readonly "tool.execute.before"?: RuntimeHook
  readonly "shell.env"?: RuntimeHook
  readonly "tool.execute.after"?: RuntimeHook
  readonly "experimental.chat.messages.transform"?: RuntimeHook
  readonly "experimental.chat.system.transform"?: RuntimeHook
  readonly "experimental.session.compacting"?: RuntimeHook
  readonly "experimental.compaction.autocontinue"?: RuntimeHook
  readonly "experimental.text.complete"?: RuntimeHook
  readonly "tool.definition"?: RuntimeHook
  readonly "experimental.provider.small_model"?: (
    input: { provider: Provider },
    output: { model?: Model },
  ) => Promise<void>
}

type SmallModelHook = NonNullable<Hooks["experimental.provider.small_model"]>

export interface ProviderSmallModelEvent {
  readonly provider: Parameters<SmallModelHook>[0]["provider"]
  readonly model: MutableValue<Parameters<SmallModelHook>[1]["model"]>
}

const invoke = (run: () => Promise<void>, sync: () => void = () => {}) =>
  Effect.promise(run).pipe(Effect.ensuring(Effect.sync(sync)))

const legacyChat = (model: ModelV2Info, provider: ProviderContext) => ({
  model: PluginV1Projection.model(model),
  provider: {
    source: provider.source,
    info: PluginV1Projection.provider(provider.info, [model], {
      source: provider.source,
      request: provider.options,
    }),
    options: provider.options,
  },
})

export function fromHooks(id: string, hooks: Hooks) {
  return define({
    id,
    effect: (host) =>
      Effect.gen(function* () {
        const dispose = hooks.dispose
        if (dispose) yield* Effect.addFinalizer(() => Effect.promise(dispose))

        const eventHook = hooks.event
        if (eventHook) {
          yield* host.event.all().pipe(
            Stream.runForEach((event) => Effect.promise(() => eventHook({ event: event as never }))),
            Effect.forkScoped,
          )
        }

        const auth = hooks.auth
        if (auth) {
          yield* host.integration.transform((integrations) => {
            integrations.update(auth.provider, (integration) => {
              if (integration.name === auth.provider) integration.name = auth.provider
            })
            for (const [index, method] of (auth.methods ?? []).entries()) {
              const prompts = method.prompts?.map((prompt) => {
                if (prompt.type === "select") {
                  return {
                    type: "select" as const,
                    key: prompt.key,
                    message: prompt.message,
                    options: prompt.options.map((option) => ({ ...option })),
                    ...(prompt.when ? { when: prompt.when } : {}),
                  }
                }
                return {
                  type: "text" as const,
                  key: prompt.key,
                  message: prompt.message,
                  ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
                  ...(prompt.when ? { when: prompt.when } : {}),
                }
              })
              if (method.type === "api") {
                integrations.method.update({
                  integrationID: auth.provider,
                  method: { type: "key", label: method.label, prompts },
                  authorize: (input: { readonly key: string; readonly inputs: Record<string, string> }) =>
                    Effect.gen(function* () {
                      yield* validateLegacyPrompts(method.prompts, input.inputs)
                      if (!method.authorize) {
                        return Credential.Key.make({
                          type: "key",
                          key: input.key,
                          metadata: input.inputs,
                        })
                      }
                      const result = yield* Effect.tryPromise({
                        try: () => method.authorize!(input.inputs),
                        catch: (cause) => cause,
                      })
                      if (result.type === "failed") {
                        return yield* Effect.fail(new Error(`Authorization failed: ${auth.provider}`))
                      }
                      const metadata = { ...input.inputs, ...(result.metadata ?? {}) }
                      return {
                        integrationID: Integration.ID.make(result.provider ?? auth.provider),
                        value: Credential.Key.make({
                          type: "key",
                          key: result.key ?? input.key,
                          ...(Object.keys(metadata).length ? { metadata } : {}),
                        }),
                      }
                    }),
                })
                continue
              }
              if (
                integrations.method
                  .list(auth.provider)
                  .some((candidate) => candidate.type === "oauth" && candidate.label === method.label)
              ) {
                continue
              }
              const methodID = `legacy:${id}:${index}`
              integrations.method.update({
                integrationID: auth.provider,
                method: { id: methodID, type: "oauth", label: method.label, prompts },
                authorize: (inputs: Record<string, string>) =>
                  Effect.gen(function* () {
                    yield* validateLegacyPrompts(method.prompts, inputs)
                    const authorization = yield* Effect.tryPromise({
                      try: () => method.authorize(inputs),
                      catch: (cause) => cause,
                    })
                    const complete = (result: LegacyOAuthResult) =>
                      legacyOAuthCredential(auth.provider, Integration.MethodID.make(methodID), result)
                    if (authorization.method === "auto") {
                      return {
                        mode: "auto" as const,
                        url: authorization.url,
                        instructions: authorization.instructions,
                        callback: Effect.tryPromise({
                          try: () => authorization.callback(),
                          catch: (cause) => cause,
                        }).pipe(Effect.flatMap(complete)),
                      }
                    }
                    return {
                      mode: "code" as const,
                      url: authorization.url,
                      instructions: authorization.instructions,
                      callback: (code: string) =>
                        Effect.tryPromise({
                          try: () => authorization.callback(code),
                          catch: (cause) => cause,
                        }).pipe(Effect.flatMap(complete)),
                    }
                  }),
              })
            }
          })
        }
        if (auth?.loader) {
          const loaded = new Map<Auth["type"], Promise<Record<string, any>>>()
          yield* host.aisdk.options((event) => {
            if (event.model.providerID !== auth.provider) return
            return Effect.gen(function* () {
              const current = yield* resolveAuth(host, auth.provider)
              if (!current) return
              const provider = clone(
                PluginV1Projection.provider(providerFromModel(event.model), [event.model], {
                  source: "api",
                  auth: current.type === "oauth" ? "oauth" : "key",
                }),
              )
              const options =
                loaded.get(current.type) ??
                auth.loader!(async () => {
                  const latest = await Effect.runPromise(resolveAuth(host, auth.provider))
                  if (!latest) throw new Error(`Provider credential disconnected: ${auth.provider}`)
                  return latest
                }, provider)
              loaded.set(current.type, options)
              Object.assign(event.options, yield* Effect.promise(() => options))
            })
          })
        }

        const provider = hooks.provider
        if (provider?.models) {
          yield* host.catalog.transform((catalog) => {
            const record = catalog.provider.get(provider.id)
            if (!record) return
            return Effect.gen(function* () {
              const resolved = yield* resolveCredential(host, provider.id)
              const legacy = clone(
                PluginV1Projection.provider(record.provider, record.models.values(), {
                  source: resolved.connection?.type === "env" ? "env" : resolved.credential ? "api" : undefined,
                  auth:
                    resolved.connection?.type === "env"
                      ? "env"
                      : resolved.credential?.type === "oauth"
                        ? "oauth"
                        : resolved.credential
                          ? "key"
                          : undefined,
                }),
              )
              const previous = new Map(record.models)
              const models = yield* Effect.promise(() =>
                provider.models!(legacy, { auth: PluginV1Projection.auth(resolved.credential) }),
              )
              for (const id of previous.keys()) catalog.model.remove(provider.id, id)
              for (const [id, model] of Object.entries(models)) {
                const modelID = ModelV2.ID.make(id)
                const projected = PluginV1Projection.fromModel(
                  ProviderV2.ID.make(provider.id),
                  modelID,
                  model,
                  previous.get(id),
                )
                catalog.model.update(provider.id, id, (draft) => Object.assign(draft, projected))
              }
            })
          })
        }

        const message = hooks["chat.message"]
        if (message) {
          yield* host.session.hook("message.before", (event) => {
            const output = {
              message: event.message.get(),
              parts: event.parts.get(),
            }
            return invoke(
              () =>
                message(
                  {
                    sessionID: event.sessionID,
                    agent: event.agent,
                    model: event.model && {
                      providerID: event.model.providerID,
                      modelID: event.model.modelID,
                    },
                    messageID: event.messageID,
                    variant: event.model?.variant,
                  },
                  output as never,
                ),
              () => {
                event.message.set(output.message)
                event.parts.set(output.parts)
              },
            )
          })
        }

        const params = hooks["chat.params"]
        if (params) {
          yield* host.session.hook("chat.params", (event) => {
            const output = event.params.get()
            const legacy = legacyChat(event.model, event.provider)
            return invoke(
              () =>
                params(
                  {
                    sessionID: event.sessionID,
                    agent: event.agent,
                    model: legacy.model,
                    provider: legacy.provider,
                    message: event.message,
                  } as never,
                  output as never,
                ),
              () => event.params.set(output),
            )
          })
        }

        const headers = hooks["chat.headers"]
        if (headers) {
          yield* host.session.hook("chat.headers", (event) => {
            const output = { headers: event.headers.get() }
            const legacy = legacyChat(event.model, event.provider)
            return invoke(
              () =>
                headers(
                  {
                    sessionID: event.sessionID,
                    agent: event.agent,
                    model: legacy.model,
                    provider: legacy.provider,
                    message: event.message,
                  } as never,
                  output,
                ),
              () => event.headers.set(output.headers),
            )
          })
        }

        const permission = hooks["permission.ask"]
        if (permission) {
          yield* host.permission.hook("ask", (event) => {
            const output = { status: event.status.get() }
            return invoke(
              () => permission(event.request as never, output),
              () => event.status.set(output.status),
            )
          })
        }

        const command = hooks["command.execute.before"]
        if (command) {
          yield* host.command.hook("execute.before", (event) => {
            const output = { parts: event.parts.get() }
            return invoke(
              () =>
                command(
                  {
                    command: event.command,
                    sessionID: event.sessionID,
                    arguments: event.arguments,
                  },
                  output as never,
                ),
              () => event.parts.set(output.parts),
            )
          })
        }

        const toolBefore = hooks["tool.execute.before"]
        if (toolBefore) {
          yield* host.tool.hook("execute.before", (event) => {
            const output = { args: event.args.get() }
            return invoke(
              () =>
                toolBefore(
                  {
                    tool: event.tool,
                    sessionID: event.sessionID,
                    callID: event.callID,
                  },
                  output,
                ),
              () => event.args.set(output.args),
            )
          })
        }

        const shell = hooks["shell.env"]
        if (shell) {
          yield* host.shell.hook("env", (event) => {
            const output = { env: event.env.get() }
            return invoke(
              () =>
                shell(
                  {
                    cwd: event.cwd,
                    sessionID: event.sessionID,
                    callID: event.callID,
                  },
                  output,
                ),
              () => event.env.set(output.env),
            )
          })
        }

        const toolAfter = hooks["tool.execute.after"]
        if (toolAfter) {
          yield* host.tool.hook("execute.after", (event) => {
            const output = event.result.get()
            return invoke(
              () =>
                toolAfter(
                  {
                    tool: event.tool,
                    sessionID: event.sessionID,
                    callID: event.callID,
                    args: event.args,
                  },
                  output as never,
                ),
              () => event.result.set(output),
            )
          })
        }

        const messages = hooks["experimental.chat.messages.transform"]
        if (messages) {
          yield* host.session.hook("chat.messages.transform", (event) => {
            const output = { messages: event.messages.get() }
            return invoke(
              () => messages({}, output as never),
              () => event.messages.set(output.messages),
            )
          })
        }

        const system = hooks["experimental.chat.system.transform"]
        if (system) {
          yield* host.session.hook("chat.system.transform", (event) => {
            const output = { system: event.system.get() }
            return invoke(
              () =>
                system(
                  {
                    sessionID: event.sessionID,
                    model: PluginV1Projection.model(event.model),
                  } as never,
                  output as never,
                ),
              () => event.system.set(output.system),
            )
          })
        }

        const compacting = hooks["experimental.session.compacting"]
        if (compacting) {
          yield* host.session.hook("compacting", (event) => {
            const output = event.options.get()
            return invoke(
              () => compacting({ sessionID: event.sessionID }, output as never),
              () => event.options.set(output),
            )
          })
        }

        const autocontinue = hooks["experimental.compaction.autocontinue"]
        if (autocontinue) {
          yield* host.session.hook("compaction.autocontinue", (event) => {
            const output = { enabled: event.enabled.get() }
            const legacy = legacyChat(event.model, event.provider)
            return invoke(
              () =>
                autocontinue(
                  {
                    sessionID: event.sessionID,
                    agent: event.agent,
                    model: legacy.model,
                    provider: legacy.provider,
                    message: event.message,
                    overflow: event.overflow,
                  } as never,
                  output,
                ),
              () => event.enabled.set(output.enabled),
            )
          })
        }

        const text = hooks["experimental.text.complete"]
        if (text) {
          yield* host.session.hook("text.complete", (event) => {
            const output = { text: event.text.get() }
            return invoke(
              () =>
                text(
                  {
                    sessionID: event.sessionID,
                    messageID: event.messageID,
                    partID: event.partID,
                  },
                  output,
                ),
              () => event.text.set(output.text),
            )
          })
        }

        const definition = hooks["tool.definition"]
        if (definition) {
          yield* host.tool.hook("definition", (event) => {
            const output = event.definition.get()
            return invoke(
              () => definition({ toolID: event.toolID }, output),
              () => event.definition.set(output),
            )
          })
        }

        const smallModel = hooks["experimental.provider.small_model"]
        if (smallModel) {
          const runtime = PluginHost.runtimeOf(host)
          yield* runtime.hook<ProviderSmallModelEvent>(PluginRuntime.HookName.providerSmallModel, (event) => {
            const output: Parameters<SmallModelHook>[1] = { model: event.model.get() }
            return invoke(
              () => smallModel({ provider: event.provider }, output),
              () => event.model.set(output.model),
            )
          })
        }
      }),
  })
}

type LegacyOAuthResult =
  | {
      readonly type: "failed"
    }
  | {
      readonly type: "success"
      readonly provider?: string
      readonly refresh: string
      readonly access: string
      readonly expires: number
      readonly accountId?: string
      readonly enterpriseUrl?: string
    }
  | {
      readonly type: "success"
      readonly provider?: string
      readonly key: string
      readonly metadata?: Record<string, string>
    }

type LegacyAPIResult =
  | { readonly type: "failed" }
  | {
      readonly type: "success"
      readonly provider?: string
      readonly key?: string
      readonly metadata?: Record<string, string>
    }

type LegacyOAuthAuthorization = {
  readonly url: string
  readonly instructions: string
} & (
  | {
      readonly method: "auto"
      readonly callback: () => Promise<LegacyOAuthResult>
    }
  | {
      readonly method: "code"
      readonly callback: (code: string) => Promise<LegacyOAuthResult>
    }
)

function legacyOAuthCredential(
  providerID: string,
  methodID: Integration.MethodID,
  result: LegacyOAuthResult,
): Effect.Effect<Integration.AuthorizedCredential, Error> {
  if (result.type === "failed") return Effect.fail(new Error(`Authorization failed: ${providerID}`))
  const integrationID = Integration.ID.make(result.provider ?? providerID)
  if ("key" in result) {
    return Effect.succeed({
      integrationID,
      value: Credential.Key.make({ type: "key", key: result.key, metadata: result.metadata }),
    })
  }
  const metadata = {
    ...(result.accountId ? { accountId: result.accountId } : {}),
    ...(result.enterpriseUrl ? { enterpriseUrl: result.enterpriseUrl } : {}),
  }
  return Effect.succeed({
    integrationID,
    value: Credential.OAuth.make({
      type: "oauth",
      methodID,
      refresh: result.refresh,
      access: result.access,
      expires: result.expires,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    }),
  })
}

function validateLegacyPrompts(prompts: readonly LegacyAuthPrompt[] | undefined, inputs: Record<string, string>) {
  return Effect.gen(function* () {
    for (const prompt of prompts ?? []) {
      if (prompt.type !== "text" || !prompt.validate || inputs[prompt.key] === undefined) continue
      const error = prompt.validate(inputs[prompt.key])
      if (error) return yield* new Integration.InputValidationError({ field: prompt.key, message: error })
    }
  })
}

function resolveCredential(host: PluginContext, providerID: string) {
  return Effect.gen(function* () {
    const connection = yield* host.integration.connection.active(providerID)
    const credential = connection
      ? yield* host.integration.connection.resolve(connection).pipe(Effect.orDie)
      : undefined
    return { connection, credential }
  })
}

function resolveAuth(host: PluginContext, providerID: string) {
  return Effect.map(resolveCredential(host, providerID), (resolved) => PluginV1Projection.auth(resolved.credential))
}

function providerFromModel(model: ModelV2Info) {
  const providerID = ProviderV2.ID.make(model.providerID)
  return ProviderV2.Info.make({
    ...ProviderV2.Info.empty(providerID),
    api:
      model.api.type === "aisdk"
        ? {
            type: "aisdk",
            package: model.api.package,
            url: model.api.url,
            settings: { ...model.api.settings },
          }
        : {
            type: "native",
            url: model.api.url,
            settings: { ...model.api.settings },
          },
  })
}

function clone<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(clone) as Value
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as Value
}
