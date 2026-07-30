import fs from "node:fs/promises"
import path from "node:path"
import { createServer as createNetServer } from "node:net"
import { describe, expect } from "bun:test"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@opencode-ai/core/config"
import { ConfigMCP } from "@opencode-ai/core/config/mcp"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2 } from "@opencode-ai/core/event"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import {
  MCP,
  McpAuth,
  McpBrowser,
  McpOAuthCallback,
  McpOAuthPendingProvider,
  McpOAuthProvider,
  parseRedirectUri,
} from "@opencode-ai/core/mcp"
import { Effect, Fiber, Layer, Stream } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { tempLocationLayer } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const configLayer = Layer.succeed(
  Config.Service,
  Config.Service.of({ entries: () => Effect.succeed([]) }),
)

const published: Array<{ type: string; data: unknown }> = []
const eventLayer = Layer.succeed(
  EventV2.Service,
  EventV2.Service.of({
    publish: ((definition: any, data: any, options?: any) =>
      Effect.sync(() => {
        const event = {
          id: options?.id ?? EventV2.ID.create(),
          type: definition.type,
          ...(options?.location ? { location: options.location } : {}),
          data,
        }
        published.push(event)
        return event
      })) as EventV2.Interface["publish"],
    subscribe: (() => Stream.empty) as EventV2.Interface["subscribe"],
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.die("unused"),
    project: () => Effect.die("unused"),
    replay: () => Effect.die("unused"),
    replayAll: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
    claim: () => Effect.die("unused"),
  }),
)

const spawnerLayer = Layer.mock(ChildProcessSpawner, {
  spawn: () => Effect.die("process discovery is not used on Windows tests"),
})

const memoryAuthLayer = Layer.sync(McpAuth.Service, () => {
  const data: Record<string, McpAuth.Entry> = {}
  const update = (name: string, value: Partial<McpAuth.Entry>, serverUrl?: string) =>
    Effect.sync(() => {
      data[name] = { ...data[name], ...value, ...(serverUrl ? { serverUrl } : {}) }
    })
  return McpAuth.Service.of({
    all: () => Effect.sync(() => ({ ...data })),
    get: (name) => Effect.sync(() => data[name]),
    getForUrl: (name, serverUrl) =>
      Effect.sync(() => (data[name]?.serverUrl === serverUrl ? data[name] : undefined)),
    set: (name, entry, serverUrl) =>
      Effect.sync(() => {
        data[name] = serverUrl ? { ...entry, serverUrl } : entry
      }),
    remove: (name) =>
      Effect.sync(() => {
        delete data[name]
      }),
    updateTokens: (name, tokens, serverUrl) => update(name, { tokens }, serverUrl),
    updateClientInfo: (name, clientInfo, serverUrl) => update(name, { clientInfo }, serverUrl),
    updateCodeVerifier: (name, codeVerifier) => update(name, { codeVerifier }),
    clearCodeVerifier: (name) =>
      Effect.sync(() => {
        if (data[name]) delete data[name].codeVerifier
      }),
    updateOAuthState: (name, oauthState) => update(name, { oauthState }),
    getOAuthState: (name) => Effect.sync(() => data[name]?.oauthState),
    clearOAuthState: (name) =>
      Effect.sync(() => {
        if (data[name]) delete data[name].oauthState
      }),
  })
})

let browserFailure = false
const opened: string[] = []
const browserLayer = Layer.succeed(
  McpBrowser.Service,
  McpBrowser.Service.of({
    open: (url) => {
      opened.push(url)
      if (browserFailure) return Effect.fail(new Error("spawn xdg-open ENOENT"))
      return Effect.tryPromise({
        try: async () => {
          const response = await fetch(url)
          await response.body?.cancel()
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    },
  }),
)

const oauthLayer = AppNodeBuilder.build(
  LayerNode.group([MCP.node, Location.node, McpAuth.node, McpOAuthCallback.node]),
  [
    [Config.node, configLayer],
    [EventV2.node, eventLayer],
    [Location.node, tempLocationLayer],
    [CrossSpawnSpawner.node, spawnerLayer],
    [McpAuth.node, memoryAuthLayer],
    [McpBrowser.node, browserLayer],
  ],
)
const oauthIt = testEffect(oauthLayer)

const isolatedGlobalLayer = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.map((tmp) =>
      Global.layerWith({
        data: tmp.path,
        state: tmp.path,
        config: tmp.path,
      }),
    ),
  ),
)
const authIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([McpAuth.node, Global.node]), [[Global.node, isolatedGlobalLayer]]),
)

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      probe.close(() => {
        if (typeof address === "object" && address) resolve(address.port)
        else reject(new Error("Could not allocate a loopback port"))
      })
    })
  })
}

const oauthServer = Effect.acquireRelease(
  Effect.promise(async () => {
    const protocol = new Server(
      { name: "core-oauth-test", version: "1.0.0" },
      { capabilities: { tools: {} } },
    )
    protocol.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: [
          {
            name: "secure_echo",
            description: "Secure echo",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }),
    )
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    await protocol.connect(transport)

    const requests: Array<{ pathname: string; authorization: string | null }> = []
    let refreshes = 0
    const http = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push({ pathname: url.pathname, authorization: request.headers.get("authorization") })
        const origin = url.origin

        if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
          return Response.json({
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
            scopes_supported: ["mcp"],
          })
        if (url.pathname === "/.well-known/oauth-protected-resource")
          return Response.json({
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
            scopes_supported: ["mcp"],
          })
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            token_endpoint_auth_methods_supported: ["none"],
            code_challenge_methods_supported: ["S256"],
            scopes_supported: ["mcp"],
          })
        if (url.pathname === "/register") {
          const metadata = (await request.json()) as Record<string, unknown>
          return Response.json({ ...metadata, client_id: "replacement-client" }, { status: 201 })
        }
        if (url.pathname === "/authorize") {
          const redirect = new URL(url.searchParams.get("redirect_uri") ?? "")
          redirect.searchParams.set("code", "valid-code")
          const state = url.searchParams.get("state")
          if (state) redirect.searchParams.set("state", state)
          return Response.redirect(redirect.toString(), 302)
        }
        if (url.pathname === "/token") {
          const body = new URLSearchParams(await request.text())
          if (body.get("grant_type") === "refresh_token" && body.get("refresh_token") === "refresh-token") {
            refreshes++
            return Response.json({
              access_token: "replacement-token",
              refresh_token: "refresh-token",
              token_type: "Bearer",
              scope: "mcp",
            })
          }
          if (body.get("code") !== "valid-code")
            return Response.json(
              { error: "invalid_grant", error_description: "Token exchange failed" },
              { status: 400 },
            )
          return Response.json({
            access_token: "replacement-token",
            token_type: "Bearer",
            scope: "mcp",
          })
        }
        if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 })
        if (request.method === "GET") return new Response(null, { status: 405 })
        if (request.headers.get("authorization") !== "Bearer replacement-token")
          return new Response("Unauthorized", {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
            },
          })
        return transport.handleRequest(request)
      },
    })

    return {
      url: new URL("/mcp", http.url).toString(),
      requests,
      refreshes: () => refreshes,
      close: async () => {
        await protocol.close().catch(() => {})
        http.stop(true)
      },
    }
  }),
  (server) => Effect.promise(server.close),
)

const remote = (url: string, callbackPort: number) =>
  new ConfigMCP.Remote({
    type: "remote",
    url,
    oauth: new ConfigMCP.OAuth({ callback_port: callbackPort }),
  })

function waitFor<A>(effect: Effect.Effect<A>, accept: (value: A) => boolean, message: string) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = yield* effect
      if (accept(value)) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.die(message)
  })
}

describe("MCP OAuth", () => {
  authIt.live("keeps the V1 mcp-auth.json format and URL-bound credential lookup", () =>
    Effect.gen(function* () {
      const auth = yield* McpAuth.Service
      const global = yield* Global.Service
      yield* auth.updateClientInfo("demo", { clientId: "client" }, "https://mcp.example/a")
      yield* auth.updateTokens("demo", { accessToken: "token" }, "https://mcp.example/a")

      expect((yield* auth.getForUrl("demo", "https://mcp.example/a"))?.tokens?.accessToken).toBe("token")
      expect(yield* auth.getForUrl("demo", "https://mcp.example/b")).toBeUndefined()
      expect(JSON.parse(yield* Effect.promise(() => fs.readFile(path.join(global.data, "mcp-auth.json"), "utf8")))).toEqual({
        demo: {
          clientInfo: { clientId: "client" },
          tokens: { accessToken: "token" },
          serverUrl: "https://mcp.example/a",
        },
      })
    }),
  )

  oauthIt.live("persists state and atomically commits pending replacement credentials", () =>
    Effect.gen(function* () {
      const auth = yield* McpAuth.Service
      const name = "provider"
      const url = "https://mcp.example/mcp"
      yield* auth.updateClientInfo(name, { clientId: "old-client" }, url)
      yield* auth.updateTokens(name, { accessToken: "old-token" }, url)

      const regular = new McpOAuthProvider(name, url, {}, { onRedirect: () => {} }, auth)
      const state = yield* Effect.promise(() => regular.state())
      expect(state).toHaveLength(64)
      expect(yield* Effect.promise(() => regular.state())).toBe(state)

      const pending = new McpOAuthPendingProvider(name, url, {}, { onRedirect: () => {} }, auth)
      expect(yield* Effect.promise(() => pending.clientInformation())).toBeUndefined()
      expect(yield* Effect.promise(() => pending.tokens())).toBeUndefined()
      yield* Effect.promise(() =>
        pending.saveClientInformation({ client_id: "new-client", redirect_uris: ["http://127.0.0.1/callback"] }),
      )
      yield* Effect.promise(() => pending.saveTokens({ access_token: "new-token", token_type: "Bearer" }))
      expect((yield* auth.get(name))?.tokens?.accessToken).toBe("old-token")
      yield* Effect.promise(() => pending.commit())
      expect(yield* auth.get(name)).toMatchObject({
        clientInfo: { clientId: "new-client" },
        tokens: { accessToken: "new-token" },
        serverUrl: url,
      })
    }),
  )

  oauthIt.live("validates callback state and stops the loopback server after completion", () =>
    Effect.gen(function* () {
      const callback = yield* McpOAuthCallback.Service
      const port = yield* Effect.promise(freePort)
      const redirect = `http://127.0.0.1:${port}/custom/callback`
      expect(parseRedirectUri(redirect)).toEqual({ port, path: "/custom/callback" })
      yield* callback.ensureRunning(redirect)
      const waiting = yield* callback.waitForCallback("expected", "callback-test").pipe(Effect.forkChild)
      yield* Effect.yieldNow

      const invalid = yield* Effect.promise(() => fetch(`${redirect}?code=wrong&state=unexpected`))
      expect(invalid.status).toBe(400)
      const valid = yield* Effect.promise(() => fetch(`${redirect}?code=right&state=expected`))
      expect(valid.status).toBe(200)
      expect(yield* Fiber.join(waiting)).toBe("right")
      yield* waitFor(callback.isRunning(), (running) => !running, "callback server did not stop")
    }),
  )

  oauthIt.live("completes interactive OAuth and reconnects with committed credentials", () =>
    Effect.gen(function* () {
      browserFailure = false
      opened.length = 0
      published.length = 0
      const server = yield* oauthServer
      const port = yield* Effect.promise(freePort)
      const mcp = yield* MCP.Service
      const auth = yield* McpAuth.Service
      const added = yield* mcp.add("secure", remote(server.url, port))
      expect(added.status.secure).toEqual({ status: "needs_auth" })

      expect(yield* mcp.authenticate("secure")).toEqual({ status: "connected" })
      expect((yield* mcp.status()).secure).toEqual({ status: "connected" })
      expect(Object.keys(yield* mcp.tools())).toEqual(["secure_secure_echo"])
      expect(yield* mcp.getAuthStatus("secure")).toBe("authenticated")
      expect(yield* mcp.hasStoredTokens("secure")).toBe(true)
      expect(opened).toHaveLength(1)
      expect(new URL(opened[0]!).pathname).toBe("/authorize")
      expect(yield* auth.get("secure")).toMatchObject({
        clientInfo: { clientId: "replacement-client" },
        tokens: { accessToken: "replacement-token" },
        serverUrl: server.url,
      })
      expect(server.requests.some((request) => request.authorization === "Bearer replacement-token")).toBe(true)

      yield* mcp.removeAuth("secure")
      expect(yield* auth.get("secure")).toBeUndefined()
    }),
  )

  oauthIt.live("preserves existing credentials when reauthentication fails", () =>
    Effect.gen(function* () {
      browserFailure = false
      opened.length = 0
      const server = yield* oauthServer
      const port = yield* Effect.promise(freePort)
      const mcp = yield* MCP.Service
      const auth = yield* McpAuth.Service
      yield* auth.updateClientInfo("reauth", { clientId: "old-client", clientSecret: "old-secret" }, server.url)
      yield* auth.updateTokens("reauth", { accessToken: "old-token" }, server.url)
      expect((yield* mcp.add("reauth", remote(server.url, port))).status.reauth).toEqual({ status: "needs_auth" })

      expect((yield* mcp.startAuth("reauth")).authorizationUrl).toContain("/authorize")
      expect(yield* mcp.finishAuth("reauth", "invalid-code")).toEqual({
        status: "failed",
        error: "OAuth completion failed: Token exchange failed",
      })
      expect(yield* auth.get("reauth")).toMatchObject({
        clientInfo: { clientId: "old-client", clientSecret: "old-secret" },
        tokens: { accessToken: "old-token" },
      })
      yield* mcp.removeAuth("reauth")
    }),
  )

  oauthIt.live("uses stored tokens on automatic connect and reports URL-bound expiry", () =>
    Effect.gen(function* () {
      const server = yield* oauthServer
      const port = yield* Effect.promise(freePort)
      const mcp = yield* MCP.Service
      const auth = yield* McpAuth.Service
      yield* auth.updateClientInfo("stored", { clientId: "replacement-client" }, server.url)
      yield* auth.updateTokens("stored", { accessToken: "replacement-token" }, server.url)

      expect((yield* mcp.add("stored", remote(server.url, port))).status.stored).toEqual({ status: "connected" })
      expect(yield* mcp.getAuthStatus("stored")).toBe("authenticated")
      yield* auth.updateTokens("stored", { accessToken: "replacement-token", expiresAt: 1 }, server.url)
      expect(yield* mcp.getAuthStatus("stored")).toBe("expired")
      yield* auth.updateTokens("stored", { accessToken: "other" }, "https://other.example/mcp")
      expect(yield* mcp.getAuthStatus("stored")).toBe("not_authenticated")
    }),
  )

  oauthIt.live("refreshes expired stored tokens before connecting", () =>
    Effect.gen(function* () {
      const server = yield* oauthServer
      const port = yield* Effect.promise(freePort)
      const mcp = yield* MCP.Service
      const auth = yield* McpAuth.Service
      yield* auth.updateClientInfo("refresh", { clientId: "replacement-client" }, server.url)
      yield* auth.updateTokens(
        "refresh",
        {
          accessToken: "expired-token",
          refreshToken: "refresh-token",
          expiresAt: 1,
        },
        server.url,
      )

      expect((yield* mcp.add("refresh", remote(server.url, port))).status.refresh).toEqual({ status: "connected" })
      expect(server.refreshes()).toBe(1)
      expect((yield* auth.get("refresh"))?.tokens).toMatchObject({
        accessToken: "replacement-token",
        refreshToken: "refresh-token",
      })
    }),
  )

  oauthIt.live("publishes BrowserOpenFailed and cancels pending auth on interruption", () =>
    Effect.gen(function* () {
      browserFailure = true
      opened.length = 0
      published.length = 0
      const server = yield* oauthServer
      const port = yield* Effect.promise(freePort)
      const mcp = yield* MCP.Service
      expect((yield* mcp.add("browser-fail", remote(server.url, port))).status["browser-fail"]).toEqual({
        status: "needs_auth",
      })

      const fiber = yield* mcp.authenticate("browser-fail").pipe(Effect.forkChild)
      const event = yield* waitFor(
        Effect.sync(() => published.find((item) => item.type === "mcp.browser.open.failed")),
        (item) => item !== undefined,
        "BrowserOpenFailed event was not published",
      )
      expect(event?.data).toMatchObject({ mcpName: "browser-fail" })
      yield* Fiber.interrupt(fiber)
      expect(yield* mcp.finishAuth("browser-fail", "valid-code").pipe(Effect.flip)).toMatchObject({
        _tag: "MCP.AuthError",
      })
      browserFailure = false
    }),
  )
})
