import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import { Effect, Fiber } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import { waitGlobalBusEvent } from "./global-bus"
import { GlobalBus, type GlobalEvent } from "@/bus/global"

function app() {
  return Server.Default().app
}

function waitDisposed(directory: string) {
  return waitGlobalBusEvent({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const updateAgent = (input: {
  route: "/api/config" | "/global/config"
  directory: string
  model: string
  protocol: string
  variant: string
}) => {
  const config = {
    agent: {
      worker: { model: input.model, protocol: input.protocol, variant: input.variant },
    },
  }
  return Effect.promise(() =>
    Promise.resolve(
      app().request(input.route, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-opencode-directory": input.directory,
        },
        body: JSON.stringify(input.route === "/api/config" ? { config } : config),
      }),
    ),
  )
}

const worker = (directory: string) =>
  Effect.promise(() =>
    Promise.resolve(
      app().request("/api/agent", {
        headers: { "x-opencode-directory": directory },
      }),
    ).then(async (response) => {
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        data: Array<{ id: string; model?: { id: string; providerID: string; protocol?: string; variant?: string } }>
      }
      return body.data.find((agent) => agent.id === "worker")
    }),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  it.live(
    "does not dispose active instances for an agent-only update",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      yield* worker(tmp.path)
      const disposed: GlobalEvent[] = []
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const handler = (event: GlobalEvent) => {
            if (event.payload.type === "server.instance.disposed") disposed.push(event)
          }
          GlobalBus.on("event", handler)
          return handler
        }),
        (handler) => Effect.sync(() => GlobalBus.off("event", handler)),
      )

      expect(
        (yield* updateAgent({
          route: "/api/config",
          directory: tmp.path,
          model: "deepseek/deepseek-v4-flash",
          protocol: "anthropic-messages",
          variant: "max",
        })).status,
      ).toBe(200)
      expect(disposed).toEqual([])
      expect(yield* worker(tmp.path)).toMatchObject({
        model: { id: "deepseek-v4-flash", providerID: "deepseek", variant: "max" },
      })
    }),
    15_000,
  )

  it.live(
    "refreshes the V2 agent catalog before an agent config update returns",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      expect(
        (yield* updateAgent({
          route: "/api/config",
          directory: tmp.path,
          model: "openai/gpt-5.6-luna",
          protocol: "openai-responses",
          variant: "high",
        })).status,
      ).toBe(200)
      expect(yield* worker(tmp.path)).toMatchObject({
        model: { id: "gpt-5.6-luna", providerID: "openai", protocol: "openai-responses", variant: "high" },
      })

      expect(
        (yield* updateAgent({
          route: "/api/config",
          directory: tmp.path,
          model: "deepseek/deepseek-v4-flash",
          protocol: "anthropic-messages",
          variant: "max",
        })).status,
      ).toBe(200)
      expect(yield* worker(tmp.path)).toMatchObject({
        model: {
          id: "deepseek-v4-flash",
          providerID: "deepseek",
          protocol: "anthropic-messages",
          variant: "max",
        },
      })
    }),
    15_000,
  )

  it.live(
    "refreshes the V2 agent catalog after a global compatibility update",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      yield* worker(tmp.path)
      const updated = yield* updateAgent({
        route: "/global/config",
        directory: tmp.path,
        model: "deepseek/deepseek-v4-flash",
        protocol: "anthropic-messages",
        variant: "max",
      })
      expect(updated.status).toBe(200)
      expect(yield* worker(tmp.path)).toMatchObject({
        model: {
          id: "deepseek-v4-flash",
          providerID: "deepseek",
          protocol: "anthropic-messages",
          variant: "max",
        },
      })
    }),
    15_000,
  )

  it.live(
    "serves config update through the default server app",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const disposed = yield* waitDisposed(tmp.path).pipe(Effect.forkScoped({ startImmediately: true }))

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              "x-opencode-directory": tmp.path,
            },
            body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
      yield* Fiber.join(disposed)
      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, "config.json")).json())).toMatchObject({
        username: "patched-user",
        formatter: false,
        lsp: false,
      })
    }),
  )

  it.live(
    "serves config with active provider model status",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            omniroute: {
              models: {
                "gpt-4o": {
                  status: "active",
                },
              },
            },
          },
        },
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request("/config", {
            headers: {
              "x-opencode-directory": tmp.path,
            },
          }),
        ),
      )

      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.json())).toMatchObject({
        provider: {
          omniroute: {
            models: {
              "gpt-4o": {
                status: "active",
              },
            },
          },
        },
      })
    }),
  )
})
