import { describe, expect } from "bun:test"
import { Effect, Layer, Queue, Ref, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { LLM } from "../src"
import { Auth, LLMClient, RequestExecutor, WebSocketExecutor, WebSocketPool, type WebSocketPoolKey } from "../src/route"
import * as OpenAIResponses from "../src/protocols/openai-responses"
import * as ProviderShared from "../src/protocols/shared"
import { it } from "./lib/effect"

const makeExecutorWithOpenCounter = (opened: Ref.Ref<number>) =>
  WebSocketExecutor.Service.of({
    open: () =>
      Ref.update(opened, (count) => count + 1).pipe(
        Effect.as({
          sendText: () => Effect.void,
          messages: Stream.empty,
          close: Effect.void,
        }),
      ),
  })

const makeStreamingExecutor = (opened: Ref.Ref<number>, closed: Ref.Ref<number>) =>
  WebSocketExecutor.Service.of({
    open: () =>
      Effect.gen(function* () {
        yield* Ref.update(opened, (count) => count + 1)
        const queue = yield* Queue.unbounded<string>()
        return {
          sendText: () =>
            Effect.sync(() => {
              Queue.offerUnsafe(
                queue,
                ProviderShared.encodeJson({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" }),
              )
              Queue.offerUnsafe(queue, ProviderShared.encodeJson({ type: "response.completed", response: { id: "resp" } }))
            }),
          messages: Stream.fromQueue(queue),
          close: Ref.update(closed, (count) => count + 1),
        }
      }),
  })

describe("WebSocketPool", () => {
  it.effect("reuses an open connection for repeated sends on the same key", () =>
    Effect.gen(function* () {
      const opened = yield* Ref.make(0)
      const executor = makeExecutorWithOpenCounter(opened)
      const key: WebSocketPoolKey = { url: "ws://mock/key", headers: Headers.empty, headersKey: "" }
      const exercise = Effect.gen(function* () {
        const pool = yield* WebSocketPool.make()
        const first = yield* pool.acquire(key)
        yield* pool.release(first)
        const second = yield* pool.acquire(key)
        expect((yield* Ref.get(opened))).toBe(1)
        expect(second).toBe(first)
      })
      yield* exercise.pipe(Effect.provideService(WebSocketExecutor.Service, executor))
    }),
  )

  it.effect("reuses one connection across repeated streams through the WebSocket transport", () =>
    Effect.gen(function* () {
      const opened = yield* Ref.make(0)
      const closed = yield* Ref.make(0)
      const executor = makeStreamingExecutor(opened, closed)
      const pool = yield* WebSocketPool.make()
      const deps = Layer.mergeAll(
        Layer.succeed(
          RequestExecutor.Service,
          RequestExecutor.Service.of({ execute: () => Effect.die("unexpected HTTP request") }),
        ),
        Layer.succeed(WebSocketExecutor.Service, executor),
        Layer.succeed(WebSocketPool.Service, pool),
      )
      const model = OpenAIResponses.webSocketRoute
        .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
        .model({ id: "gpt-4.1-mini" })
      const run = (prompt: string) =>
        LLMClient.generate(LLM.request({ model, prompt })).pipe(
          Effect.provide(LLMClient.layer.pipe(Layer.provideMerge(deps))),
        )
      const first = yield* run("Say hello.")
      const second = yield* run("Say hi.")
      expect(first.text).toBe("Hi")
      expect(second.text).toBe("Hi")
      expect((yield* Ref.get(opened))).toBe(1)
      yield* pool.closeAll
      expect((yield* Ref.get(closed))).toBe(1)
    }),
  )
})
