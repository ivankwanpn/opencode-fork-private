import { describe, expect } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { PluginV1Compat, type Hooks } from "@opencode-ai/core/plugin/v1-compat"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Deferred, Effect, Exit } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const providerID = ProviderV2.ID.make("test")
const modelID = ModelV2.ID.make("model")
const modernModel = ModelV2.Info.empty(providerID, modelID)
const providerContext = {
  source: "api" as const,
  info: ProviderV2.Info.empty(providerID),
  options: {},
}

function mutable<Value>(initial: Value) {
  let current = initial
  return {
    value: {
      get: () => current,
      set: (value: Value) => {
        current = value
      },
      update: (transform: (value: Value) => Value) => {
        current = transform(current)
      },
    },
    get: () => current,
  }
}

const add = (plugins: PluginV2.Interface, id: string, hooks: Hooks) => {
  const plugin = PluginV1Compat.fromHooks(id, hooks)
  return plugins.add(PluginV2.ID.make(id), plugin.effect)
}

describe("PluginV1Compat", () => {
  it.effect("runs V1 hooks sequentially, shares mutations, and stops after failure", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const runtime = yield* PluginRuntime.Service
      const calls: string[] = []

      yield* add(plugins, "v1-first", {
        "tool.execute.before": async (_input, output) => {
          calls.push("first")
          output.args = { ...output.args, first: true }
        },
      })
      yield* add(plugins, "v1-failing", {
        "tool.execute.before": async (_input, output) => {
          calls.push(output.args.first ? "second:saw-first" : "second:missed-first")
          output.args = { ...output.args, second: true }
          throw new Error("stop")
        },
      })
      yield* add(plugins, "v1-last", {
        "tool.execute.before": async () => {
          calls.push("last")
        },
      })

      const args = mutable<unknown>({ initial: true })
      const exit = yield* runtime
        .run(PluginRuntime.HookName.toolExecuteBefore, {
          tool: "test",
          sessionID: "ses_test",
          callID: "call_test",
          args: args.value,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(calls).toEqual(["first", "second:saw-first"])
      expect(args.get()).toEqual({ initial: true, first: true, second: true })
    }),
  )

  it.effect("registers every V1 runtime hook on its canonical name", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const runtime = yield* PluginRuntime.Service
      const calls: string[] = []
      const called = (name: string) => async () => {
        calls.push(name)
      }

      yield* add(plugins, "v1-all-hooks", {
        "chat.message": called("chat.message"),
        "chat.params": called("chat.params"),
        "chat.headers": called("chat.headers"),
        "permission.ask": called("permission.ask"),
        "command.execute.before": called("command.execute.before"),
        "tool.execute.before": called("tool.execute.before"),
        "shell.env": called("shell.env"),
        "tool.execute.after": called("tool.execute.after"),
        "experimental.chat.messages.transform": called("experimental.chat.messages.transform"),
        "experimental.chat.system.transform": called("experimental.chat.system.transform"),
        "experimental.session.compacting": called("experimental.session.compacting"),
        "experimental.compaction.autocontinue": called("experimental.compaction.autocontinue"),
        "experimental.text.complete": called("experimental.text.complete"),
        "tool.definition": called("tool.definition"),
        "experimental.provider.small_model": async (_input, output) => {
          calls.push("experimental.provider.small_model")
          output.model = { id: "small-model" } as never
        },
      })

      const message = mutable<any>({ id: "msg" })
      const parts = mutable<readonly any[]>([])
      yield* runtime.run(PluginRuntime.HookName.sessionMessageBefore, {
        sessionID: "ses_test",
        message: message.value,
        parts: parts.value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionChatParams, {
        sessionID: "ses_test",
        agent: "build",
        model: modernModel,
        provider: providerContext,
        message: {} as never,
        params: mutable<any>({ options: {} }).value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionChatHeaders, {
        sessionID: "ses_test",
        agent: "build",
        model: modernModel,
        provider: providerContext,
        message: {} as never,
        headers: mutable<Record<string, string>>({}).value,
      })
      yield* runtime.run(PluginRuntime.HookName.permissionAsk, {
        request: {} as never,
        status: mutable<"ask" | "deny" | "allow">("ask").value,
      })
      yield* runtime.run(PluginRuntime.HookName.commandExecuteBefore, {
        command: "test",
        sessionID: "ses_test",
        arguments: "",
        parts: mutable<readonly any[]>([]).value,
      })
      yield* runtime.run(PluginRuntime.HookName.toolExecuteBefore, {
        tool: "test",
        sessionID: "ses_test",
        callID: "call_test",
        args: mutable<unknown>({}).value,
      })
      yield* runtime.run(PluginRuntime.HookName.shellEnv, {
        cwd: "/repo",
        env: mutable<Record<string, string>>({}).value,
      })
      yield* runtime.run(PluginRuntime.HookName.toolExecuteAfter, {
        tool: "test",
        sessionID: "ses_test",
        callID: "call_test",
        args: {},
        result: mutable<any>({ title: "", output: "", metadata: {} }).value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionMessagesTransform, {
        messages: mutable<readonly any[]>([]).value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionSystemTransform, {
        model: modernModel,
        system: mutable<readonly string[]>([]).value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionCompacting, {
        sessionID: "ses_test",
        options: mutable<{ readonly context: readonly string[]; readonly prompt?: string }>({ context: [] }).value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionCompactionAutocontinue, {
        sessionID: "ses_test",
        agent: "build",
        model: modernModel,
        provider: providerContext,
        message: {} as never,
        overflow: false,
        enabled: mutable(true).value,
      })
      yield* runtime.run(PluginRuntime.HookName.sessionTextComplete, {
        sessionID: "ses_test",
        messageID: "msg_test",
        partID: "part_test",
        text: mutable("").value,
      })
      yield* runtime.run(PluginRuntime.HookName.toolDefinition, {
        toolID: "test",
        definition: mutable({ description: "test", parameters: {} }).value,
      })
      const selected = mutable<any>(undefined)
      yield* runtime.run(PluginRuntime.HookName.providerSmallModel, {
        provider: {} as never,
        model: selected.value,
      })

      expect(calls).toEqual([
        "chat.message",
        "chat.params",
        "chat.headers",
        "permission.ask",
        "command.execute.before",
        "tool.execute.before",
        "shell.env",
        "tool.execute.after",
        "experimental.chat.messages.transform",
        "experimental.chat.system.transform",
        "experimental.session.compacting",
        "experimental.compaction.autocontinue",
        "experimental.text.complete",
        "tool.definition",
        "experimental.provider.small_model",
      ])
      expect(selected.get()).toEqual({ id: "small-model" })
    }),
  )

  it.effect("projects canonical model and provider context for V1 chat hooks", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const runtime = yield* PluginRuntime.Service
      const providerID = ProviderV2.ID.make("cloudflare-ai-gateway")
      const modelID = ModelV2.ID.make("reasoning")
      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(providerID, modelID),
        api: {
          id: ModelV2.ID.make("openai/gpt-5.4"),
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://gateway.example.com",
        },
        capabilities: {
          tools: true,
          input: ["text", "image"],
          output: ["text"],
          temperature: false,
          reasoning: true,
          attachment: true,
          interleaved: { field: "reasoning_details" },
        },
        request: {
          headers: { "x-model": "reasoning" },
          body: { gateway: "primary" },
        },
        time: { released: Date.parse("2026-07-01") },
        cost: [{ input: 2, output: 8, cache: { read: 1, write: 0 } }],
        limit: { context: 200_000, output: 64_000 },
      })
      const provider = ProviderV2.Info.make({
        ...ProviderV2.Info.empty(providerID),
        name: "Cloudflare AI Gateway",
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://gateway.example.com",
        },
        request: {
          headers: {},
          body: { accountId: "account" },
        },
      })
      let input: Parameters<NonNullable<Hooks["chat.params"]>>[0] | undefined

      yield* add(plugins, "v1-chat-projection", {
        "chat.params": async (incoming, output) => {
          input = incoming
          if (
            incoming.model.api.id.toLowerCase().startsWith("openai/") &&
            incoming.model.capabilities.reasoning
          ) {
            output.maxOutputTokens = undefined
          }
        },
      })

      const params = mutable({
        temperature: undefined,
        topP: undefined,
        topK: undefined,
        maxOutputTokens: 4096 as number | undefined,
        options: {},
      })
      yield* runtime.run(PluginRuntime.HookName.sessionChatParams, {
        sessionID: "ses_test",
        agent: "build",
        model,
        provider: {
          source: "config" as const,
          info: provider,
          options: provider.request.body,
        },
        message: {} as never,
        params: params.value,
      })

      expect(params.get().maxOutputTokens).toBeUndefined()
      expect(input).toMatchObject({
        model: {
          id: modelID,
          providerID,
          api: {
            id: "openai/gpt-5.4",
            url: "https://gateway.example.com",
            npm: "@ai-sdk/openai-compatible",
          },
          capabilities: {
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: { text: true, image: true },
            interleaved: { field: "reasoning_details" },
          },
          options: { gateway: "primary" },
          headers: { "x-model": "reasoning" },
          release_date: "2026-07-01",
        },
        provider: {
          source: "config",
          options: { accountId: "account" },
          info: {
            id: providerID,
            source: "config",
            options: { accountId: "account" },
            models: { [modelID]: { id: modelID } },
          },
        },
      })
    }),
  )

  it.effect("projects all events to the V1 event hook", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const events = yield* EventV2.Service
      const received = yield* Deferred.make<any>()

      yield* add(plugins, "v1-event", {
        event: async ({ event }) => {
          Deferred.doneUnsafe(received, Effect.succeed(event))
        },
      })

      yield* Effect.yieldNow
      yield* events.publish(Catalog.Event.Updated, {})

      expect(yield* Deferred.await(received)).toMatchObject({
        type: "catalog.updated",
        properties: {},
      })
    }),
  )

  it.effect("runs V1 dispose once when the plugin scope closes", () =>
    Effect.gen(function* () {
      const plugins = yield* PluginV2.Service
      const id = PluginV2.ID.make("v1-dispose")
      let disposed = 0

      yield* add(plugins, id, {
        dispose: async () => {
          disposed++
        },
      })
      yield* plugins.remove(id)
      yield* plugins.remove(id)

      expect(disposed).toBe(1)
    }),
  )
})
