import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createConnection } from "node:net"
import { Context, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { OauthCallbackPage } from "../oauth/page"
import { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT, parseRedirectUri } from "./oauth-provider"

const OAUTH_CALLBACK_HOST = "127.0.0.1"
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000

export class CallbackError extends Schema.TaggedErrorClass<CallbackError>()("McpOAuthCallback.Error", {
  message: Schema.String,
}) {}

type PendingAuth = {
  readonly resume: (effect: Effect.Effect<string, CallbackError>) => void
  readonly timeout: ReturnType<typeof setTimeout>
  readonly key?: string
}

export interface Interface {
  readonly ensureRunning: (redirectUri?: string) => Effect.Effect<void, CallbackError>
  readonly waitForCallback: (oauthState: string, key?: string) => Effect.Effect<string, CallbackError>
  readonly cancelPending: (key: string) => Effect.Effect<void>
  readonly stop: () => Effect.Effect<void>
  readonly isRunning: () => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/McpOAuthCallback") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let currentPort = OAUTH_CALLBACK_PORT
    let currentPath = OAUTH_CALLBACK_PATH
    let server: ReturnType<typeof createServer> | undefined
    let closing: Promise<void> | undefined
    const pending = new Map<string, PendingAuth>()
    const keyToState = new Map<string, string>()

    const remove = (state: string) => {
      const item = pending.get(state)
      if (!item) return
      clearTimeout(item.timeout)
      pending.delete(state)
      if (item.key && keyToState.get(item.key) === state) keyToState.delete(item.key)
      return item
    }

    const closeServer = () => {
      const current = server
      server = undefined
      if (!current) return closing ?? Promise.resolve()
      closing = new Promise<void>((resolve) => {
        current.close(() => {
          closing = undefined
          resolve()
        })
      })
      return closing
    }

    const stopIfIdle = () => {
      if (pending.size || !server) return
      void closeServer()
    }

    const failPending = (state: string, message: string) => {
      const item = remove(state)
      if (!item) return
      item.resume(Effect.fail(new CallbackError({ message })))
      stopIfIdle()
    }

    const handleRequest = (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url || "/", `http://localhost:${currentPort}`)
      if (url.pathname !== currentPath) {
        response.writeHead(404)
        response.end("Not found")
        return
      }

      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const description = url.searchParams.get("error_description")

      if (!state) {
        const message = "Missing required state parameter - potential CSRF attack"
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        response.end(OauthCallbackPage.error(message, { provider: "MCP" }))
        return
      }

      if (error) {
        const message = description || error
        failPending(state, message)
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        response.end(OauthCallbackPage.error(message, { provider: "MCP" }))
        return
      }

      if (!code) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        response.end(OauthCallbackPage.error("No authorization code provided", { provider: "MCP" }))
        return
      }

      const item = remove(state)
      if (!item) {
        const message = "Invalid or expired state parameter - potential CSRF attack"
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        response.end(OauthCallbackPage.error(message, { provider: "MCP" }))
        return
      }

      item.resume(Effect.succeed(code))
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(OauthCallbackPage.success({ provider: "MCP" }))
      stopIfIdle()
    }

    const stop = Effect.fn("McpOAuthCallback.stop")(function* () {
      for (const state of Array.from(pending.keys())) failPending(state, "OAuth callback server stopped")
      keyToState.clear()
      yield* Effect.promise(closeServer)
    })

    const ensureRunning = Effect.fn("McpOAuthCallback.ensureRunning")(function* (redirectUri?: string) {
      const next = parseRedirectUri(redirectUri)
      if (server && (currentPort !== next.port || currentPath !== next.path)) yield* stop()
      if (closing) yield* Effect.promise(() => closing!)
      if (server) return
      if (yield* Effect.promise(() => isPortInUse(next.port)))
        return yield* new CallbackError({ message: `OAuth callback port ${next.port} is already in use` })

      currentPort = next.port
      currentPath = next.path
      const candidate = createServer(handleRequest)
      yield* Effect.tryPromise({
        try: () =>
          new Promise<void>((resolve, reject) => {
            const failed = (cause: Error) => reject(cause)
            candidate.once("error", failed)
            candidate.listen(currentPort, OAUTH_CALLBACK_HOST, () => {
              candidate.off("error", failed)
              resolve()
            })
          }),
        catch: (cause) =>
          new CallbackError({ message: cause instanceof Error ? cause.message : String(cause) }),
      })
      server = candidate
    })

    const waitForCallback = Effect.fn("McpOAuthCallback.waitForCallback")(function* (
      oauthState: string,
      key?: string,
    ) {
      return yield* Effect.callback<string, CallbackError>((resume) => {
        const previous = key ? keyToState.get(key) : undefined
        if (previous) failPending(previous, "Authorization replaced by a newer attempt")
        if (pending.has(oauthState)) failPending(oauthState, "Authorization replaced by a newer attempt")

        const timeout = setTimeout(
          () => failPending(oauthState, "OAuth callback timeout - authorization took too long"),
          CALLBACK_TIMEOUT_MS,
        )
        pending.set(oauthState, { resume, timeout, key })
        if (key) keyToState.set(key, oauthState)

        return Effect.sync(() => {
          const item = pending.get(oauthState)
          if (item?.resume !== resume) return
          remove(oauthState)
          stopIfIdle()
        })
      })
    })

    const cancelPending = Effect.fn("McpOAuthCallback.cancelPending")(function* (key: string) {
      const state = keyToState.get(key)
      if (state) failPending(state, "Authorization cancelled")
      else stopIfIdle()
    })

    yield* Effect.addFinalizer(() => stop())
    return Service.of({
      ensureRunning,
      waitForCallback,
      cancelPending,
      stop,
      isRunning: () => Effect.sync(() => server !== undefined),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, OAUTH_CALLBACK_HOST)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

export * as McpOAuthCallback from "./oauth-callback"
