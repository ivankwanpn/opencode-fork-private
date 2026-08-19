import { describe, expect, test } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { UsageService } from "@/acp/usage"
import { Effect, Layer } from "effect"
import { it } from "../lib/effect"
import type { ACPClient } from "@/acp/client"
import { makeClient } from "./client-fixture"

const assistant = (
  input: Partial<UsageService.AssistantMessage> & Pick<UsageService.AssistantMessage, "cost">,
): UsageService.SessionMessage => ({
  info: {
    role: "assistant",
    providerID: "anthropic",
    modelID: "claude-sonnet",
    tokens: {
      input: 10,
      output: 20,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...input,
  },
})

const user = (): UsageService.SessionMessage => ({
  info: { role: "user" },
})

const assistantWithoutProvider = (): UsageService.SessionMessage => ({
  info: {
    role: "assistant",
    modelID: "claude-sonnet",
    cost: 1,
    tokens: {
      input: 10,
      output: 20,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  },
})

const fakeLayer = (input: {
  readonly messages?: Effect.Effect<readonly UsageService.SessionMessage[], unknown>
  readonly contextLimit?: UsageService.ContextLimitLoaderInterface["get"]
}) =>
  LayerNode.compile(UsageService.node, [
    [
      UsageService.messageLoaderNode,
      Layer.succeed(
        UsageService.MessageLoader,
        UsageService.MessageLoader.of({
          messages: () => input.messages ?? Effect.succeed([]),
        }),
      ),
    ],
    [
      UsageService.contextLimitLoaderNode,
      Layer.succeed(
        UsageService.ContextLimitLoader,
        UsageService.ContextLimitLoader.of({
          get:
            input.contextLimit ??
            ((request) =>
              Effect.succeed(
                request.providerID === ProviderV2.ID.make("anthropic") &&
                  request.modelID === ModelV2.ID.make("claude-sonnet")
                  ? 128_000
                  : undefined,
              )),
        }),
      ),
    ],
  ])

const connection = (updates: SessionNotification[]) => ({
  sessionUpdate(params: SessionNotification) {
    updates.push(params)
    return Promise.resolve()
  },
})

describe("acp usage", () => {
  test("builds ACP Usage from assistant token shape", () => {
    expect(
      UsageService.buildUsage({
        cost: 0.02,
        tokens: {
          input: 100,
          output: 40,
          reasoning: 7,
          cache: { read: 11, write: 13 },
        },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      thoughtTokens: 7,
      cachedReadTokens: 11,
      cachedWriteTokens: 13,
      totalTokens: 171,
    })
  })

  test("omits optional token fields when they are zero", () => {
    expect(
      UsageService.buildUsage({
        cost: 0,
        tokens: {
          input: 3,
          output: 4,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
    ).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    })
  })

  test("finds the latest assistant message", () => {
    expect(
      UsageService.latestAssistantMessage([assistant({ cost: 1, modelID: "older" }), user(), assistant({ cost: 2 })]),
    ).toMatchObject({ cost: 2 })
  })

  test("calculates total session cost from assistant messages", () => {
    expect(UsageService.totalSessionCost([assistant({ cost: 1.25 }), user(), assistant({ cost: 2.5 })])).toBe(3.75)
  })

  test("loads direct facade transcripts", async () => {
    const calls: unknown[] = []
    const transcript = [
      {
        info: {
          id: "msg_assistant",
          sessionID: "ses_1",
          role: "assistant",
          time: { created: 1, completed: 2 },
          parentID: "msg_user",
          providerID: "anthropic",
          modelID: "claude-sonnet",
          mode: "build",
          agent: "build",
          path: { cwd: "/workspace", root: "/workspace" },
          cost: 1,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        parts: [],
      },
    ] satisfies readonly ACPClient.LegacySessionMessage[]
    const client = makeClient({
      session: {
        messages: (input) => {
          calls.push(input)
          return Promise.resolve(transcript)
        },
      },
    })

    const messages = await Effect.runPromise(
      UsageService.messageLoaderFromClient(client).messages({
        sessionID: "ses_1",
        directory: "/workspace",
      }),
    )

    expect(messages).toBe(transcript)
    expect(calls).toEqual([{ sessionID: "ses_1" }])
  })

  it.effect("loads context limits from providers and caches by directory/provider/model", () => {
    const calls: string[] = []
    return Effect.gen(function* () {
      const usage = yield* UsageService.Service
      const first = yield* usage.contextLimit({
        directory: "/workspace",
        providerID: ProviderV2.ID.make("anthropic"),
        modelID: ModelV2.ID.make("claude-sonnet"),
      })
      const second = yield* usage.contextLimit({
        directory: "/workspace",
        providerID: ProviderV2.ID.make("anthropic"),
        modelID: ModelV2.ID.make("claude-sonnet"),
      })

      expect(first).toBe(200_000)
      expect(second).toBe(200_000)
      expect(calls).toEqual(["/workspace"])
    }).pipe(
      Effect.provide(
        fakeLayer({
          contextLimit: (input) =>
            Effect.sync(() => {
              calls.push(input.directory)
              return 200_000
            }),
        }),
      ),
    )
  })

  it.effect("sends ACP usage_update with context size and cumulative assistant cost", () => {
    const updates: SessionNotification[] = []
    return Effect.gen(function* () {
      const usage = yield* UsageService.Service
      yield* usage.sendUpdate({
        connection: connection(updates),
        sessionID: "ses_1",
        directory: "/workspace",
      })

      expect(updates).toEqual([
        {
          sessionId: "ses_1",
          update: {
            sessionUpdate: "usage_update",
            used: 15,
            size: 128_000,
            cost: { amount: 3, currency: "USD" },
          },
        },
      ])
    }).pipe(
      Effect.provide(
        fakeLayer({
          messages: Effect.succeed([
            assistant({ cost: 1 }),
            assistant({
              cost: 2,
              tokens: {
                input: 10,
                output: 20,
                reasoning: 0,
                cache: { read: 5, write: 0 },
              },
            }),
          ]),
        }),
      ),
    )
  })

  it.effect("skips usage update when messages cannot be fetched", () => {
    const updates: SessionNotification[] = []
    return Effect.gen(function* () {
      const usage = yield* UsageService.Service
      yield* usage.sendUpdate({
        connection: connection(updates),
        sessionID: "ses_1",
        directory: "/workspace",
      })

      expect(updates).toEqual([])
    }).pipe(Effect.provide(fakeLayer({ messages: Effect.fail(new Error("boom")) })))
  })

  it.effect("skips usage update when no assistant message exists", () => {
    const updates: SessionNotification[] = []
    return Effect.gen(function* () {
      const usage = yield* UsageService.Service
      yield* usage.sendUpdate({
        connection: connection(updates),
        sessionID: "ses_1",
        directory: "/workspace",
      })

      expect(updates).toEqual([])
    }).pipe(Effect.provide(fakeLayer({ messages: Effect.succeed([user()]) })))
  })

  it.effect("skips usage update when assistant message has no provider or model", () => {
    const updates: SessionNotification[] = []
    return Effect.gen(function* () {
      const usage = yield* UsageService.Service
      yield* usage.sendUpdate({
        connection: connection(updates),
        sessionID: "ses_1",
        directory: "/workspace",
      })

      expect(updates).toEqual([])
    }).pipe(
      Effect.provide(
        fakeLayer({
          messages: Effect.succeed([assistantWithoutProvider()]),
        }),
      ),
    )
  })

  it.effect("skips usage update when context size is unknown", () => {
    const updates: SessionNotification[] = []
    return Effect.gen(function* () {
      const usage = yield* UsageService.Service
      yield* usage.sendUpdate({
        connection: connection(updates),
        sessionID: "ses_1",
        directory: "/workspace",
      })

      expect(updates).toEqual([])
    }).pipe(
      Effect.provide(
        fakeLayer({
          messages: Effect.succeed([assistant({ cost: 1, providerID: "missing" })]),
        }),
      ),
    )
  })
})
