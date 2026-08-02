import { describe, expect, test } from "bun:test"
import { LLM, LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { DateTime, Effect, Layer, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV2 } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"

test("compaction prompt preserves detailed work state and relevant files", () => {
  const prompt = SessionCompaction.buildPrompt({ context: ["conversation history"] })

  expect(prompt).toContain("## Work State\n### Completed")
  expect(prompt).toContain("### Active")
  expect(prompt).toContain("### Blocked")
  expect(prompt).toContain("## Relevant Files")
})

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

const it = testEffect(Layer.empty)
const sessionID = SessionV2.ID.make("ses_manual_compaction_test")
const model = Model.make({
  id: "compact-test",
  provider: "test",
  route: OpenAIChat.route.with({ limits: { context: 20_000, output: 1_000 } }),
})
const user = SessionMessage.User.make({
  id: SessionMessage.ID.create(),
  type: "user",
  text: "Keep this exact compacted detail",
  time: { created: DateTime.makeUnsafe(1) },
})

describe("SessionCompaction manual lifecycle", () => {
  it.effect("compacts short history with custom instructions and live deltas", () =>
    Effect.gen(function* () {
      const published: Array<{ type: string; data: Record<string, unknown> }> = []
      const requests: LLMRequest[] = []
      const events = {
        publish: (definition: { readonly type: string }, data: Record<string, unknown>) =>
          Effect.sync(() => {
            published.push({ type: definition.type, data })
            return { id: EventV2.ID.create(), type: definition.type, data }
          }),
      } as unknown as EventV2.Interface
      const compaction = SessionCompaction.make({
        events,
        config: [],
        plugins: PluginRuntime.make(),
        llm: {
          stream: (request) => {
            requests.push(request)
            return Stream.fromIterable([
              LLMEvent.textDelta({ id: "summary", text: "First summary" }),
              LLMEvent.textDelta({ id: "summary", text: " and second" }),
            ])
          },
        },
      })

      expect(
        yield* compaction.compactManual({
          sessionID,
          entries: [{ seq: 1, message: user }],
          model,
          request: LLM.request({ model, messages: [], tools: [] }),
          instructions: "Preserve exact identifiers",
        }),
      ).toBeTrue()

      expect(requests).toHaveLength(1)
      expect(JSON.stringify(requests[0].messages)).toContain("Keep this exact compacted detail")
      expect(JSON.stringify(requests[0].messages)).toContain("Preserve exact identifiers")
      expect(published.map((event) => event.type)).toEqual([
        SessionEvent.Compaction.Started.type,
        SessionEvent.Compaction.Delta.type,
        SessionEvent.Compaction.Delta.type,
        SessionEvent.Compaction.Ended.type,
      ])
      expect(published[0]?.data).toMatchObject({ reason: "manual" })
      expect(published.at(-1)?.data).toMatchObject({
        messageID: published[0]?.data.messageID,
        reason: "manual",
        text: "First summary and second",
        recent: "",
      })
    }),
  )

  it.effect("allows plugins to disable automatic continuation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = PluginRuntime.make()
        yield* runtime.hook(
          PluginRuntime.HookName.sessionCompactionAutocontinue,
          (event: { readonly enabled: PluginRuntime.Mutable<boolean>["value"] }) => event.enabled.set(false),
        )
        const compaction = SessionCompaction.make({
          events: {} as EventV2.Interface,
          config: [],
          plugins: runtime,
          llm: { stream: () => Stream.empty },
        })

        expect(
          yield* compaction.autocontinue({
            sessionID,
            agent: "build",
            model: {} as never,
            provider: {} as never,
            message: {} as never,
            overflow: false,
          }),
        ).toBeFalse()
      }),
    ),
  )

  it.effect("leaves the active checkpoint unchanged when summarization fails", () =>
    Effect.gen(function* () {
      const published: Array<{ type: string; data: Record<string, unknown> }> = []
      const events = {
        publish: (definition: { readonly type: string }, data: Record<string, unknown>) =>
          Effect.sync(() => {
            published.push({ type: definition.type, data })
            return { id: EventV2.ID.create(), type: definition.type, data }
          }),
      } as unknown as EventV2.Interface
      const compaction = SessionCompaction.make({
        events,
        config: [],
        plugins: PluginRuntime.make(),
        llm: {
          stream: () => Stream.make(LLMEvent.providerError({ message: "summary unavailable" })),
        },
      })

      expect(
        yield* compaction.compactManual({
          sessionID,
          entries: [{ seq: 1, message: user }],
          model,
          request: LLM.request({ model, messages: [], tools: [] }),
        }),
      ).toBeFalse()
      expect(published.map((event) => event.type)).toEqual([
        SessionEvent.Compaction.Started.type,
        SessionEvent.Compaction.Failed.type,
      ])
      expect(published.at(-1)?.data).toMatchObject({
        error: { type: "unknown", message: "summary unavailable" },
      })
    }),
  )
})

describe("SessionCompaction automatic lifecycle", () => {
  it.effect("leaves short history unchanged", () =>
    Effect.gen(function* () {
      const requests: LLMRequest[] = []
      const compaction = SessionCompaction.make({
        events: {} as EventV2.Interface,
        config: [],
        plugins: PluginRuntime.make(),
        llm: {
          stream: (request) => {
            requests.push(request)
            return Stream.empty
          },
        },
      })

      expect(
        yield* compaction.compactAfterOverflow({
          sessionID,
          entries: [{ seq: 1, message: user }],
          model,
          request: LLM.request({ model, messages: [], tools: [] }),
        }),
      ).toBeFalse()
      expect(requests).toEqual([])
    }),
  )

  it.effect("compacts short history when automatic compaction is explicitly requested", () =>
    Effect.gen(function* () {
      const published: Array<{ type: string; data: Record<string, unknown> }> = []
      const requests: LLMRequest[] = []
      const events = {
        publish: (definition: { readonly type: string }, data: Record<string, unknown>) =>
          Effect.sync(() => {
            published.push({ type: definition.type, data })
            return { id: EventV2.ID.create(), type: definition.type, data }
          }),
      } as unknown as EventV2.Interface
      const compaction = SessionCompaction.make({
        events,
        config: [],
        plugins: PluginRuntime.make(),
        llm: {
          stream: (request) => {
            requests.push(request)
            return Stream.make(LLMEvent.textDelta({ id: "summary", text: "Requested summary" }))
          },
        },
      })

      expect(
        yield* compaction.compactAutomatic({
          sessionID,
          entries: [{ seq: 1, message: user }],
          model,
          request: LLM.request({ model, messages: [], tools: [] }),
        }),
      ).toBeTrue()
      expect(JSON.stringify(requests[0]?.messages)).toContain("Keep this exact compacted detail")
      expect(published.at(-1)?.data).toMatchObject({
        reason: "auto",
        text: "Requested summary",
        recent: "",
      })
    }),
  )

  it.effect("summarizes the head while retaining the recent tail", () =>
    Effect.gen(function* () {
      const published: Array<{ type: string; data: Record<string, unknown> }> = []
      const requests: LLMRequest[] = []
      const events = {
        publish: (definition: { readonly type: string }, data: Record<string, unknown>) =>
          Effect.sync(() => {
            published.push({ type: definition.type, data })
            return { id: EventV2.ID.create(), type: definition.type, data }
          }),
      } as unknown as EventV2.Interface
      const longUser = SessionMessage.User.make({
        ...user,
        id: SessionMessage.ID.create(),
        text: `EARLY:${"x".repeat(40_000)}:LATE`,
      })
      const compaction = SessionCompaction.make({
        events,
        config: [],
        plugins: PluginRuntime.make(),
        llm: {
          stream: (request) => {
            requests.push(request)
            return Stream.make(LLMEvent.textDelta({ id: "summary", text: "Automatic summary" }))
          },
        },
      })

      expect(
        yield* compaction.compactAfterOverflow({
          sessionID,
          entries: [{ seq: 1, message: longUser }],
          model,
          request: LLM.request({ model, messages: [], tools: [] }),
        }),
      ).toBeTrue()

      expect(JSON.stringify(requests[0]?.messages)).toContain("EARLY:")
      expect(published[0]?.data).toMatchObject({ reason: "auto" })
      expect(published.at(-1)?.data).toMatchObject({
        reason: "auto",
        text: "Automatic summary",
      })
      expect(String(published.at(-1)?.data.recent)).toContain(":LATE")
    }),
  )
})
