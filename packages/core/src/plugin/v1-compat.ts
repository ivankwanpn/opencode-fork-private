export * as PluginV1Compat from "./v1-compat"

import { define, type MutableValue, type ProviderContext } from "@opencode-ai/plugin/v2/effect"
import type { Model, ModelV2Info, Provider } from "@opencode-ai/sdk/v2/types"
import { Effect, Stream } from "effect"
import { PluginHost } from "./host"
import { PluginRuntime } from "./runtime"
import { PluginV1Projection } from "./v1-projection"

type RuntimeHook = (input: any, output: any) => Promise<void>

export interface Hooks {
  readonly dispose?: () => Promise<void>
  readonly event?: (input: { event: any }) => Promise<void>
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
