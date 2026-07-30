export * as SessionCompaction from "./compaction"

import { LLM, LLMClient, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@opencode-ai/llm"
import type { UserMessage } from "@opencode-ai/sdk/v2/types"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { AgentV2 } from "../agent"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { EventV2 } from "../event"
import { ModelV2 } from "../model"
import { MessageDecodeError } from "./error"
import { PluginRuntime } from "../plugin/runtime"
import { ProviderV2 } from "../provider"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { SessionStore } from "./store"
import { Token } from "../util/token"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
  readonly plugins: PluginRuntime.Interface
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
}

type AutocontinueInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: string
  readonly model: ModelV2.Info
  readonly provider: {
    readonly source: "env" | "config" | "custom" | "api"
    readonly info: ProviderV2.Info
    readonly options: Readonly<Record<string, unknown>>
  }
  readonly message: UserMessage
  readonly overflow: boolean
}

export type Result = {
  readonly compacted: boolean
  readonly shouldContinue: boolean
}

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    const context = message.context?.map((item) => `[User context]: ${item.text}`) ?? []
    return [...context, `[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS },
  )
}

const select = (
  entries: readonly Entry[],
  tokens: number,
): { readonly head: string; readonly recent: string } | undefined => {
  const conversation = entries
    .filter((entry) => entry.message.type !== "compaction")
    .map((entry) => serialize(entry.message))
    .filter(Boolean)
  if (conversation.length === 0) return
  let total = 0
  let split = conversation.length
  let splitPrefix = ""
  let splitSuffix = ""
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index])
    if (next > tokens) {
      const remaining = Math.max(0, tokens - total) * 4
      if (remaining > 0) {
        splitPrefix = conversation[index].slice(0, -remaining)
        splitSuffix = conversation[index].slice(-remaining)
        split = index + 1
      }
      break
    }
    total = next
    split = index
  }
  return {
    head: [...conversation.slice(0, split), splitPrefix].filter(Boolean).join("\n\n"),
    recent: [splitSuffix, ...conversation.slice(split)].filter(Boolean).join("\n\n"),
  }
}

export const buildPrompt = (input: {
  readonly previousSummary?: string
  readonly context: readonly string[]
  readonly instructions?: string
}) =>
  [
    input.instructions?.trim() ? `Additional compaction instructions:\n${input.instructions.trim()}` : undefined,
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n")

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const autocontinue = Effect.fn("SessionCompaction.autocontinue")(function* (input: AutocontinueInput) {
    const enabled = PluginRuntime.mutable(true)
    yield* dependencies.plugins.run(PluginRuntime.HookName.sessionCompactionAutocontinue, {
      ...input,
      enabled: enabled.value,
    })
    return enabled.get()
  })
  const compact = Effect.fn("SessionCompaction.compact")(function* (
    input: Input & {
      readonly reason: "auto" | "manual"
      readonly instructions?: string
      readonly force?: boolean
    },
  ) {
    const context = input.model.route.defaults.limits?.context
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const selected = select(input.entries, config.tokens)
    if (!selected) return false
    const previousSummary = input.entries.findLast((entry) => entry.message.type === "compaction")?.message
    const target =
      input.reason === "manual" || (input.force === true && selected.head.length === 0)
        ? {
            head: [selected.head, selected.recent].filter(Boolean).join("\n\n"),
            recent: "",
          }
        : selected
    if (target.head.length === 0 && previousSummary?.type !== "compaction") return false
    const options = PluginRuntime.mutable<{
      readonly context: readonly string[]
      readonly prompt?: string
    }>({ context: [] })
    yield* dependencies.plugins.run(PluginRuntime.HookName.sessionCompacting, {
      sessionID: input.sessionID,
      options: options.value,
    })
    const customized = options.get()
    const summaryPrompt =
      customized.prompt ??
      buildPrompt({
        previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
        context: [
          previousSummary?.type === "compaction" ? previousSummary.recent : "",
          target.head,
          ...customized.context,
        ].filter(Boolean),
        instructions: input.instructions,
      })
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    if (context !== undefined && context > 0 && Token.estimate(summaryPrompt) > context - summaryOutput) return false
    const messageID = SessionMessage.ID.create()
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: input.reason,
    })

    const chunks: string[] = []
    let failed = false
    const summarized = yield* dependencies.llm
      .stream(
        LLM.request({
          model: input.model,
          messages: [Message.user(summaryPrompt)],
          tools: [],
          generation: { maxTokens: summaryOutput },
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) {
            failed = true
            return Effect.void
          }
          if (!LLMEvent.is.textDelta(event)) return Effect.void
          chunks.push(event.text)
          return dependencies.events
            .publish(SessionEvent.Compaction.Delta, {
              sessionID: input.sessionID,
              messageID,
              timestamp: DateTime.makeUnsafe(Date.now()),
              text: event.text,
            })
            .pipe(Effect.asVoid)
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const summary = chunks.join("")
    if (!summarized || failed || !summary.trim()) return false
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: input.reason,
      text: summary,
      recent: target.recent,
    })
    return true
  })

  const compactAfterOverflow = Effect.fn("SessionCompaction.compactAfterOverflow")((input: Input) =>
    compact({ ...input, reason: "auto" }),
  )
  const compactAutomatic = Effect.fn("SessionCompaction.compactAutomatic")((input: Input) =>
    compact({ ...input, reason: "auto", force: true }),
  )
  const compactManual = Effect.fn("SessionCompaction.compactManual")(
    (input: Input & { readonly instructions?: string }) => compact({ ...input, reason: "manual" }),
  )
  const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (input: Input) {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    if (
      estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) <=
      context - Math.max(output, config.buffer)
    )
      return false
    return yield* compactAfterOverflow(input)
  })
  return {
    autocontinue,
    compactIfNeeded,
    compactAfterOverflow,
    compactAutomatic,
    compactManual,
  }
}

export interface Interface {
  readonly compact: (input: {
    readonly session: SessionSchema.Info
    readonly prompt?: Prompt
    readonly reason: "auto" | "manual"
  }) => Effect.Effect<Result, SessionRunnerModel.Error | MessageDecodeError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionCompaction") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const config = yield* Config.Service
    const models = yield* SessionRunnerModel.Service
    const plugins = yield* PluginRuntime.Service
    const store = yield* SessionStore.Service
    const compaction = make({ events, llm, plugins, config: yield* config.entries() })

    return Service.of({
      compact: Effect.fn("SessionCompaction.compact")(function* (input) {
        const resolved = models.resolveWithInfo ? yield* models.resolveWithInfo(input.session) : undefined
        const model = resolved?.llm ?? (yield* models.resolve(input.session))
        const messages = yield* store.context(input.session.id)
        const compactInput = {
          sessionID: input.session.id,
          entries: messages.map((message, seq) => ({ seq, message })),
          model,
          request: LLM.request({ model, messages: [], tools: [] }),
        }
        const compacted = yield* input.reason === "auto"
          ? compaction.compactAutomatic(compactInput)
          : compaction.compactManual({
              ...compactInput,
              instructions: input.prompt?.text,
            })
        if (!compacted || input.reason !== "auto") return { compacted, shouldContinue: false }
        if (!resolved) return { compacted, shouldContinue: true }
        const user = messages.findLast((message) => message.type === "user")
        if (!user) return { compacted, shouldContinue: true }
        const agent = yield* agents.select(input.session.agent)
        const message: UserMessage = {
          id: user.id,
          sessionID: input.session.id,
          role: "user",
          time: { created: DateTime.toEpochMillis(user.time.created) },
          agent: agent.id,
          model: {
            providerID: resolved.model.providerID,
            modelID: resolved.model.id,
            ...(input.session.model?.variant === undefined ? {} : { variant: input.session.model.variant }),
          },
        }
        const shouldContinue = yield* compaction.autocontinue({
          sessionID: input.session.id,
          agent: agent.id,
          model: resolved.model,
          provider: {
            source: resolved.source,
            info: resolved.provider,
            options: resolved.provider.request.body,
          },
          message,
          overflow: false,
        })
        return { compacted, shouldContinue }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    Config.node,
    PluginRuntime.node,
    SessionRunnerModel.node,
    SessionStore.node,
  ],
})
