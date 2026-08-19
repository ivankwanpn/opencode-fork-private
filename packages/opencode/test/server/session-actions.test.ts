import { afterEach, describe, expect, mock } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { SessionWire } from "@/compat/session-wire"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap, locationServiceMapV2Layer } from "@opencode-ai/core/location-services"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import { TestSessionV2 } from "../fixture/session-v2"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(SessionV2.node, [
      [SessionExecution.node, SessionExecution.noopLayer],
      [LocationServiceMap.node, locationServiceMapV2Layer],
    ]),
    httpApiLayer,
  ),
)

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

describe("session action routes", () => {
  it.instance(
    "session routes expose metadata on create, update, get, and fork",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "Content-Type": "application/json" }

        const created = yield* requestInDirectory("/session", test.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "meta-session",
            metadata: { source: "sdk", trace: { id: "abc" } },
          }),
        })
        expect(created.status).toBe(200)

        const session = (yield* created.json) as SessionWire.Info
        expect(session.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })

        const updated = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ metadata: { source: "sdk", trace: { id: "def" }, tags: ["one"] } }),
        })
        expect(updated.status).toBe(200)

        const next = (yield* updated.json) as SessionWire.Info
        expect(next.metadata).toEqual({ source: "sdk", trace: { id: "def" }, tags: ["one"] })

        const fetched = yield* requestInDirectory(`/session/${session.id}`, test.directory)
        expect(fetched.status).toBe(200)
        expect(((yield* fetched.json) as SessionWire.Info).metadata).toEqual(next.metadata)

        const forked = yield* requestInDirectory(`/session/${session.id}/fork`, test.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(forked.status).toBe(200)

        const fork = (yield* forked.json) as SessionWire.Info
        expect(fork.metadata).toEqual(next.metadata)

        const reset = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ metadata: {} }),
        })
        expect(reset.status).toBe(200)
        expect(((yield* reset.json) as SessionWire.Info).metadata).toEqual({})

        yield* SessionV2.Service.use((svc) => svc.remove(SessionV2.ID.make(fork.id)).pipe(Effect.ignore))
        yield* SessionV2.Service.use((svc) => svc.remove(SessionV2.ID.make(session.id)).pipe(Effect.ignore))
      }),
    { git: true },
  )

  it.instance(
    "abort route returns success",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(TestSessionV2.create(), (created) =>
          SessionV2.Service.use((svc) => svc.remove(created.id).pipe(Effect.ignore)),
        )

        const res = yield* requestInDirectory(`/session/${session.id}/abort`, test.directory, { method: "POST" })

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
        const admitted = yield* requestInDirectory(`/api/session/${session.id}/prompt`, test.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "msg_idle_abort_reuse",
            prompt: { text: "reuse after idle abort" },
            resume: false,
          }),
        })
        expect(admitted.status).toBe(200)
      }),
    { git: true },
  )

  it.instance(
    "experimental background route is a no-op without synchronous subagents",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Effect.acquireRelease(TestSessionV2.create(), (created) =>
          SessionV2.Service.use((svc) => svc.remove(created.id).pipe(Effect.ignore)),
        )

        const res = yield* requestInDirectory(`/experimental/session/${session.id}/background`, test.directory, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(false)
      }),
    { git: true },
  )
})
