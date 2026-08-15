import path from "node:path"
import { pathToFileURL } from "node:url"
import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  ToolListChangedNotificationSchema,
  type LoggingMessageNotification,
  type Tool as MCPToolDefinition,
} from "@modelcontextprotocol/sdk/types.js"
import { McpEvent } from "@opencode-ai/schema/mcp-event"
import { Mcp } from "@opencode-ai/schema/mcp"
import { Cause, Context, Effect, Exit, Fiber, Layer, Schema, Scope, Semaphore, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Config } from "../config"
import { ConfigMCP } from "../config/mcp"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { Tools } from "../tool/tools"
import { McpAuth } from "./auth"
import { McpBrowser } from "./browser"
import { McpCatalog } from "./catalog"
import { McpOAuthCallback } from "./oauth-callback"
import { McpOAuthPendingProvider, McpOAuthProvider, type McpOAuthConfig } from "./oauth-provider"
import { McpResourceTools } from "./resource-tools"

const CLIENT_OPTIONS = {
  capabilities: {
    roots: {},
  },
} satisfies ClientOptions

type ServerConfig = typeof ConfigMCP.Server.Type
type PromptInfo = Awaited<ReturnType<Client["listPrompts"]>>["prompts"][number]
type ResourceInfo = Awaited<ReturnType<Client["listResources"]>>["resources"][number]
type ResourceTemplateInfo = Awaited<ReturnType<Client["listResourceTemplates"]>>["resourceTemplates"][number]
type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
type TransportWithAuth = StreamableHTTPClientTransport | SSEClientTransport

export type AuthStatus = "authenticated" | "expired" | "not_authenticated"

export const Resource = Mcp.Resource
export type Resource = Mcp.Resource
export const Status = Mcp.Status
export type Status = Mcp.Status

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("MCP.NotFoundError", {
  name: Schema.String,
}) {}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("MCP.AuthError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface ServerInstructions {
  readonly name: string
  readonly instructions: string
  readonly tools: ReadonlyArray<string>
}

export type McpTool = McpCatalog.McpTool

export interface Interface {
  readonly status: () => Effect.Effect<Record<string, Status>>
  readonly clients: () => Effect.Effect<Record<string, Client>>
  readonly instructions: () => Effect.Effect<ReadonlyArray<ServerInstructions>>
  readonly tools: () => Effect.Effect<Record<string, McpTool>>
  readonly prompts: () => Effect.Effect<Record<string, PromptInfo & { client: string }>>
  readonly resources: (clientName?: string) => Effect.Effect<Record<string, ResourceInfo & { client: string }>>
  readonly resourceTemplates: (
    clientName?: string,
  ) => Effect.Effect<Record<string, ResourceTemplateInfo & { client: string }>>
  readonly add: (name: string, server: ServerConfig) => Effect.Effect<{ status: Record<string, Status> }>
  readonly connect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly disconnect: (name: string) => Effect.Effect<void, NotFoundError>
  readonly getPrompt: (
    clientName: string,
    name: string,
    args?: Record<string, string>,
  ) => Effect.Effect<Awaited<ReturnType<Client["getPrompt"]>> | undefined>
  readonly readResource: (
    clientName: string,
    resourceUri: string,
  ) => Effect.Effect<Awaited<ReturnType<Client["readResource"]>> | undefined>
  readonly startAuth: (
    name: string,
  ) => Effect.Effect<{ authorizationUrl: string; oauthState: string }, NotFoundError | AuthError>
  readonly authenticate: (
    name: string,
    onAuthorization?: (authorizationUrl: string) => void,
  ) => Effect.Effect<Status, NotFoundError | AuthError>
  readonly finishAuth: (name: string, authorizationCode: string) => Effect.Effect<Status, NotFoundError | AuthError>
  readonly removeAuth: (name: string) => Effect.Effect<void>
  readonly supportsOAuth: (name: string) => Effect.Effect<boolean, NotFoundError>
  readonly hasStoredTokens: (name: string) => Effect.Effect<boolean>
  readonly getAuthStatus: (name: string) => Effect.Effect<AuthStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/MCP") {}

export const emptyLayer = Layer.succeed(
  Service,
  Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: {} }),
    connect: (name) => Effect.fail(new NotFoundError({ name })),
    disconnect: (name) => Effect.fail(new NotFoundError({ name })),
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: (name) => Effect.fail(new NotFoundError({ name })),
    authenticate: (name) => Effect.fail(new NotFoundError({ name })),
    finishAuth: (name) => Effect.fail(new NotFoundError({ name })),
    removeAuth: () => Effect.void,
    supportsOAuth: (name) => Effect.fail(new NotFoundError({ name })),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated"),
  }),
)

type ResolvedConfig = {
  readonly timeout: ConfigMCP.Timeout
  readonly servers: Readonly<Record<string, ServerConfig>>
  readonly blockedTools: ReadonlySet<string>
  readonly directTools: ReadonlySet<string>
}

export const DEFAULT_BLOCKED_TOOLS: readonly string[] = ["browser_run_code_unsafe"]

type State = {
  readonly configured: Readonly<Record<string, ServerConfig>>
  readonly runtime: Map<string, ServerConfig>
  readonly status: Map<string, Status>
  readonly clients: Map<string, Client>
  readonly definitions: Map<string, ReadonlyArray<MCPToolDefinition>>
  readonly instructions: Map<string, string>
  readonly pendingOAuth: Map<string, PendingOAuth>
}

type CreateResult = {
  readonly status: Status
  readonly client?: Client
  readonly definitions?: ReadonlyArray<MCPToolDefinition>
  readonly instructions?: string
}

type PendingOAuth = {
  readonly transport: TransportWithAuth
  readonly provider: McpOAuthPendingProvider
}

type AuthResult = {
  readonly authorizationUrl: string
  readonly oauthState: string
  readonly client?: Client
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const auth = yield* McpAuth.Service
    const browser = yield* McpBrowser.Service
    const callback = yield* McpOAuthCallback.Service
    const resolved = resolveConfig(yield* config.entries())
    const locationRef = Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID })
    const captured = yield* Effect.context<never>()
    const runPromise = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(effect.pipe(Effect.provide(captured)) as Effect.Effect<A, E>)
    const runFork = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.runFork(effect.pipe(Effect.provide(captured)) as Effect.Effect<A, E>)

    const state: State = {
      configured: resolved.servers,
      runtime: new Map(),
      status: new Map(),
      clients: new Map(),
      definitions: new Map(),
      instructions: new Map(),
      pendingOAuth: new Map(),
    }

    const configured = () => ({ ...state.configured, ...Object.fromEntries(state.runtime) })
    const serverConfig = (name: string) => state.runtime.get(name) ?? state.configured[name]
    const startupTimeout = (server: ServerConfig) =>
      server.timeout?.startup ?? resolved.timeout.startup ?? McpCatalog.DEFAULT_TIMEOUT
    const requestTimeout = (server: ServerConfig) =>
      server.timeout?.request ?? resolved.timeout.request ?? McpCatalog.DEFAULT_TIMEOUT
    const authKey = (name: string) => `${location.directory}\u0000${location.workspaceID ?? ""}\u0000${name}`
    const oauthConfig = (server: ConfigMCP.Remote): McpOAuthConfig => {
      const info = typeof server.oauth === "object" ? server.oauth : undefined
      return {
        clientId: info?.client_id,
        clientSecret: info?.client_secret,
        scope: info?.scope,
        callbackPort: info?.callback_port,
        redirectUri: info?.redirect_uri,
      }
    }

    const publishChanged = (name: string) =>
      events.publish(McpEvent.ToolsChanged, { server: name }, { location: locationRef }).pipe(Effect.asVoid)

    const descendants = Effect.fnUntraced(
      function* (pid: number) {
        if (process.platform === "win32") return [] as number[]
        const pids: number[] = []
        const queue = [pid]
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index]
          const process = yield* spawner.spawn(ChildProcess.make("pgrep", ["-P", String(current)], { stdin: "ignore" }))
          const text = yield* Stream.mkString(Stream.decodeText(process.stdout))
          yield* process.exitCode
          for (const token of text.split("\n")) {
            const child = Number.parseInt(token, 10)
            if (Number.isNaN(child) || pids.includes(child)) continue
            pids.push(child)
            queue.push(child)
          }
        }
        return pids
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed([] as number[])),
    )

    const close = Effect.fnUntraced(function* (client: Client) {
      const pid = client.transport instanceof StdioClientTransport ? client.transport.pid : undefined
      if (typeof pid === "number") {
        for (const child of yield* descendants(pid)) {
          try {
            process.kill(child, "SIGTERM")
          } catch {}
        }
      }
      yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
    })

    const closeTransport = (transport: TransportWithAuth) =>
      Effect.tryPromise(() => transport.close()).pipe(Effect.ignore)

    const removeClient = Effect.fnUntraced(function* (name: string) {
      const client = state.clients.get(name)
      state.clients.delete(name)
      state.definitions.delete(name)
      state.instructions.delete(name)
      if (client) yield* close(client)
      return client !== undefined
    })

    const connectTransport = Effect.fn("MCP.connectTransport")(function* (transport: Transport, timeout: number) {
      return yield* Effect.acquireUseRelease(
        Effect.succeed(transport),
        (current) =>
          Effect.tryPromise({
            try: () => {
              const client = createClient(location.directory)
              return withTimeout(client.connect(current), timeout).then(() => client)
            },
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }),
        (current, exit) =>
          Exit.isFailure(exit) ? Effect.tryPromise(() => current.close()).pipe(Effect.ignore) : Effect.void,
      )
    })

    const connectLocal: (name: string, server: ConfigMCP.Local) => Effect.Effect<CreateResult> = Effect.fn(
      "MCP.connectLocal",
    )(function* (name, server) {
      const [command, ...args] = server.command
      if (!command)
        return {
          status: { status: "failed", error: `MCP server "${name}" has an empty command` },
        } satisfies CreateResult
      const cwd = server.cwd ? path.resolve(location.directory, server.cwd) : location.directory
      const transport = new StdioClientTransport({
        stderr: "pipe",
        command,
        args,
        cwd,
        env: {
          ...process.env,
          ...(command === "opencode" ? { BUN_BE_BUN: "1" } : {}),
          ...server.environment,
        },
      })
      return yield* connectTransport(transport, startupTimeout(server)).pipe(
        Effect.map((client) => ({ client, status: { status: "connected" as const } })),
        Effect.catch((error) =>
          Effect.succeed({
            status: {
              status: "failed" as const,
              error: error instanceof Error ? error.message : String(error),
            },
          }),
        ),
      )
    })

    const connectRemote: (name: string, server: ConfigMCP.Remote) => Effect.Effect<CreateResult> = Effect.fn(
      "MCP.connectRemote",
    )(function* (name, server) {
      if (!URL.canParse(server.url)) return { status: { status: "failed", error: `Invalid MCP URL for "${name}"` } }
      const url = new URL(server.url)
      const authProvider =
        server.oauth === false
          ? undefined
          : new McpOAuthProvider(name, server.url, oauthConfig(server), { onRedirect: () => {} }, auth)
      const transports: ReadonlyArray<TransportWithAuth> = [
        new StreamableHTTPClientTransport(url, {
          authProvider,
          requestInit: server.headers ? { headers: server.headers } : undefined,
        }),
        new SSEClientTransport(url, {
          authProvider,
          requestInit: server.headers ? { headers: server.headers } : undefined,
        }),
      ]
      let last: Status = { status: "failed", error: "Unknown error" }
      for (const transport of transports) {
        const attempt = yield* connectTransport(transport, startupTimeout(server)).pipe(
          Effect.map((client) => ({ client }) as const),
          Effect.catch((error) => {
            const failure = error instanceof Error ? error : new Error(String(error))
            const requiresAuth =
              server.oauth !== false &&
              (error instanceof UnauthorizedError || failure.message.toLowerCase().includes("oauth"))
            const status: Status = requiresAuth
              ? /registration|client_id/i.test(failure.message)
                ? {
                    status: "needs_client_registration",
                    error: "Server does not support dynamic client registration. Please provide client_id in config.",
                  }
                : { status: "needs_auth" }
              : { status: "failed", error: failure.message }
            return Effect.succeed({ status } as const)
          }),
        )
        if ("client" in attempt) return { client: attempt.client, status: { status: "connected" } }
        last = attempt.status
        if (last.status === "needs_auth" || last.status === "needs_client_registration") break
      }
      return { status: last }
    })

    const completeClient: (server: ServerConfig, client: Client) => Effect.Effect<CreateResult> = Effect.fn(
      "MCP.completeClient",
    )(function* (server, client) {
      return yield* Effect.gen(function* () {
        const definitions = client.getServerCapabilities()?.tools
          ? yield* McpCatalog.definitions(client, requestTimeout(server))
          : []
        if (!definitions) return yield* Effect.fail(new Error("Failed to get MCP tools"))
        return {
          client,
          status: { status: "connected" },
          definitions,
          instructions: client.getInstructions()?.trim(),
        } satisfies CreateResult
      }).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return close(client).pipe(Effect.andThen(Effect.interrupt))
          const error = Cause.squash(cause)
          return close(client).pipe(
            Effect.andThen(
              Effect.succeed({
                status: {
                  status: "failed" as const,
                  error: error instanceof Error ? error.message : String(error),
                },
              } satisfies CreateResult),
            ),
          )
        }),
      )
    })

    const create: (name: string, server: ServerConfig) => Effect.Effect<CreateResult> = Effect.fn("MCP.create")(
      function* (name, server) {
        if (server.disabled) return { status: { status: "disabled" } } satisfies CreateResult
        const connected =
          server.type === "local" ? yield* connectLocal(name, server) : yield* connectRemote(name, server)
        if (!connected.client) return connected
        return yield* completeClient(server, connected.client)
      },
    )

    function serverLog(name: string, params: LoggingMessageNotification["params"]) {
      const fields = { server: name, logger: params.logger, level: params.level, data: params.data }
      switch (params.level) {
        case "debug":
          return Effect.logDebug("MCP server log", fields)
        case "info":
        case "notice":
          return Effect.logInfo("MCP server log", fields)
        case "warning":
          return Effect.logWarning("MCP server log", fields)
        case "error":
        case "critical":
        case "alert":
        case "emergency":
          return Effect.logError("MCP server log", fields)
      }
      return Effect.void
    }

    function watch(name: string, client: Client, timeout: number) {
      client.onclose = () => {
        if (state.clients.get(name) !== client) return
        state.clients.delete(name)
        state.definitions.delete(name)
        state.instructions.delete(name)
        state.status.set(name, { status: "failed", error: "Connection closed" })
        runFork(
          Effect.logWarning("MCP connection closed", { server: name }).pipe(
            Effect.andThen(publishChanged(name)),
            Effect.ignore,
          ),
        )
      }
      client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) =>
        runPromise(serverLog(name, notification.params)),
      )
      if (!client.getServerCapabilities()?.tools) return
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        if (state.clients.get(name) !== client || state.status.get(name)?.status !== "connected") return
        const definitions = await runPromise(McpCatalog.definitions(client, timeout))
        if (!definitions) return
        if (state.clients.get(name) !== client || state.status.get(name)?.status !== "connected") return
        state.definitions.set(name, definitions)
        await runPromise(publishChanged(name).pipe(Effect.ignore))
      })
    }

    const store = Effect.fnUntraced(function* (
      name: string,
      client: Client,
      definitions: ReadonlyArray<MCPToolDefinition>,
      instructions: string | undefined,
      timeout: number,
      notify: boolean,
    ) {
      const previous = state.clients.get(name)
      state.status.set(name, { status: "connected" })
      state.clients.set(name, client)
      state.definitions.set(name, definitions)
      if (instructions) state.instructions.set(name, instructions)
      else state.instructions.delete(name)
      watch(name, client, timeout)
      if (previous && previous !== client) yield* close(previous)
      if (notify) yield* publishChanged(name)
    })

    const applyResult = Effect.fnUntraced(function* (
      name: string,
      server: ServerConfig,
      result: CreateResult,
      notify: boolean,
    ) {
      state.status.set(name, result.status)
      if (!result.client) {
        yield* removeClient(name)
        if (notify) yield* publishChanged(name)
        return result.status
      }
      yield* store(name, result.client, result.definitions ?? [], result.instructions, requestTimeout(server), notify)
      return result.status
    })

    const createAndStore = Effect.fn("MCP.createAndStore")(function* (
      name: string,
      server: ServerConfig,
      notify = true,
    ) {
      return yield* applyResult(name, server, yield* create(name, server), notify)
    })

    yield* Effect.forEach(Object.entries(state.configured), ([name, server]) => createAndStore(name, server, false), {
      concurrency: "unbounded",
      discard: true,
    })

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const clients = Array.from(state.clients.values())
        const oauth = Array.from(state.pendingOAuth)
        state.clients.clear()
        state.definitions.clear()
        state.instructions.clear()
        state.pendingOAuth.clear()
        yield* Effect.forEach(clients, close, { concurrency: "unbounded", discard: true })
        yield* Effect.forEach(
          oauth,
          ([name, pending]) =>
            callback.cancelPending(authKey(name)).pipe(Effect.andThen(closeTransport(pending.transport))),
          { concurrency: "unbounded", discard: true },
        )
      }),
    )

    const status: Interface["status"] = Effect.fn("MCP.status")(function* () {
      return Object.fromEntries(
        Object.keys(configured())
          .toSorted()
          .map((name): [string, Status] => [name, state.status.get(name) ?? { status: "disabled" }]),
      )
    })

    const clients = Effect.fn("MCP.clients")(function* () {
      return Object.fromEntries(state.clients)
    })

    const instructions = Effect.fn("MCP.instructions")(function* () {
      return Array.from(state.instructions)
        .filter(([name]) => state.status.get(name)?.status === "connected")
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([name, instructions]) => ({
          name,
          instructions,
          tools: McpCatalog.toolNames(name, state.definitions.get(name) ?? []),
        }))
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const result: Record<string, McpTool> = {}
      for (const [name, client] of state.clients) {
        if (state.status.get(name)?.status !== "connected") continue
        const server = serverConfig(name)
        if (!server) continue
        const definitions = state.definitions.get(name)
        if (!definitions) {
          yield* Effect.logWarning("missing cached MCP tools for connected server", { server: name })
          continue
        }
        const timeout = requestTimeout(server)
        const names = McpCatalog.toolNames(name, definitions)
        for (const [index, definition] of definitions.entries())
          result[names[index]!] = {
            clientName: name,
            def: definition,
            client,
            timeout,
          }
      }
      return result
    })

    const collectConnected = <T extends { name: string }>(
      clientName: string | undefined,
      list: (client: Client, timeout: number) => Promise<T[]>,
      label: string,
      key?: (item: T) => string,
    ) =>
      Effect.forEach(
        Array.from(state.clients).filter(
          ([name]) => state.status.get(name)?.status === "connected" && (!clientName || name === clientName),
        ),
        ([name, client]) => {
          const server = serverConfig(name)!
          return McpCatalog.collect(name, client, (current) => list(current, requestTimeout(server)), label, key).pipe(
            Effect.map((items) => Object.entries(items ?? {})),
          )
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.map((entries) => Object.fromEntries<T & { client: string }>(entries.flat())))

    const prompts = Effect.fn("MCP.prompts")(function* () {
      return yield* collectConnected(undefined, McpCatalog.prompts, "prompts")
    })

    const resources = Effect.fn("MCP.resources")(function* (clientName?: string) {
      return yield* collectConnected(clientName, McpCatalog.resources, "resources", (resource) => resource.uri)
    })

    const resourceTemplates = Effect.fn("MCP.resourceTemplates")(function* (clientName?: string) {
      return yield* collectConnected(
        clientName,
        McpCatalog.resourceTemplates,
        "resource templates",
        (template) => template.uriTemplate,
      )
    })

    const requireServer = Effect.fnUntraced(function* (name: string) {
      const server = serverConfig(name)
      if (!server) return yield* new NotFoundError({ name })
      return server
    })

    const add: Interface["add"] = Effect.fn("MCP.add")(function* (name, server) {
      state.runtime.set(name, server)
      yield* createAndStore(name, server)
      return { status: yield* status() }
    })

    const connect = Effect.fn("MCP.connect")(function* (name: string) {
      const server = yield* requireServer(name)
      yield* createAndStore(name, { ...server, disabled: false })
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      yield* requireServer(name)
      yield* removeClient(name)
      state.status.set(name, { status: "disabled" })
      yield* publishChanged(name)
    })

    const withClient = Effect.fnUntraced(function* <A>(
      clientName: string,
      run: (client: Client, timeout: number) => Promise<A>,
      label: string,
      metadata?: Record<string, unknown>,
    ) {
      const client = state.clients.get(clientName)
      const server = serverConfig(clientName)
      if (!client || !server) return undefined
      return yield* Effect.tryPromise({
        try: () => run(client, requestTimeout(server)),
        catch: (cause) => cause,
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError(`failed to ${label}`, {
            clientName,
            ...metadata,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
        Effect.orElseSucceed(() => undefined),
      )
    })

    const getPrompt = Effect.fn("MCP.getPrompt")(function* (
      clientName: string,
      name: string,
      args?: Record<string, string>,
    ) {
      return yield* withClient(
        clientName,
        (client, timeout) => client.getPrompt({ name, arguments: args }, { timeout }),
        "get MCP prompt",
        { promptName: name },
      )
    })

    const readResource = Effect.fn("MCP.readResource")(function* (clientName: string, resourceUri: string) {
      return yield* withClient(
        clientName,
        (client, timeout) => client.readResource({ uri: resourceUri }, { timeout }),
        "read MCP resource",
        { resourceUri },
      )
    })

    const discardPendingAuth = Effect.fnUntraced(function* (name: string) {
      const pending = state.pendingOAuth.get(name)
      state.pendingOAuth.delete(name)
      yield* callback.cancelPending(authKey(name))
      if (pending) yield* closeTransport(pending.transport)
    })

    const beginAuth: (name: string) => Effect.Effect<AuthResult, NotFoundError | AuthError> = Effect.fn(
      "MCP.beginAuth",
    )(function* (name) {
      const server = yield* requireServer(name)
      if (server.type !== "remote") return yield* new AuthError({ name, message: `MCP server ${name} is not remote` })
      if (server.oauth === false)
        return yield* new AuthError({ name, message: `MCP server ${name} has OAuth disabled` })
      if (!URL.canParse(server.url)) return yield* new AuthError({ name, message: `Invalid MCP URL for "${name}"` })

      yield* discardPendingAuth(name)
      const oauthState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
      yield* auth.updateOAuthState(name, oauthState)

      let authorizationUrl: URL | undefined
      const provider = new McpOAuthPendingProvider(
        name,
        server.url,
        oauthConfig(server),
        { onRedirect: (url) => void (authorizationUrl = url) },
        auth,
      )
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        authProvider: provider,
        requestInit: server.headers ? { headers: server.headers } : undefined,
      })
      const client = createClient(location.directory)
      const attempt = yield* Effect.tryPromise({
        try: () =>
          withTimeout(client.connect(transport), startupTimeout(server)).then(async () => {
            await provider.commit()
            return client
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.map((connected) => ({ client: connected }) as const),
        Effect.catch((error) => Effect.succeed({ error } as const)),
      )

      if ("client" in attempt) return { authorizationUrl: "", oauthState, client: attempt.client }

      if (attempt.error instanceof UnauthorizedError && authorizationUrl) {
        const running = yield* callback.ensureRunning(provider.redirectUrl).pipe(
          Effect.mapError((error) => new AuthError({ name, message: error.message })),
          Effect.exit,
        )
        if (Exit.isFailure(running)) {
          yield* closeTransport(transport)
          yield* auth.clearOAuthState(name)
          yield* auth.clearCodeVerifier(name)
          return yield* Effect.failCause(running.cause)
        }
        state.pendingOAuth.set(name, { transport, provider })
        return { authorizationUrl: authorizationUrl.toString(), oauthState }
      }

      yield* closeTransport(transport)
      yield* auth.clearOAuthState(name)
      yield* auth.clearCodeVerifier(name)
      return yield* new AuthError({ name, message: attempt.error.message })
    })

    const storeAuthenticatedClient = Effect.fnUntraced(function* (name: string, client: Client) {
      const server = yield* requireServer(name)
      const status = yield* applyResult(name, server, yield* completeClient(server, client), true)
      yield* auth.clearOAuthState(name)
      yield* auth.clearCodeVerifier(name)
      return status
    })

    const startAuth: Interface["startAuth"] = Effect.fn("MCP.startAuth")(function* (name) {
      const result = yield* beginAuth(name)
      if (result.client) yield* storeAuthenticatedClient(name, result.client)
      return { authorizationUrl: result.authorizationUrl, oauthState: result.oauthState }
    })

    const finishAuth: Interface["finishAuth"] = Effect.fn("MCP.finishAuth")(function* (name, authorizationCode) {
      const server = yield* requireServer(name)
      const pending = state.pendingOAuth.get(name)
      if (!pending) return yield* new AuthError({ name, message: `No pending OAuth flow for MCP server: ${name}` })

      const error = yield* Effect.tryPromise({
        try: () => pending.transport.finishAuth(authorizationCode),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.match({
          onFailure: (cause) => cause.message,
          onSuccess: () => undefined,
        }),
      )
      if (error) return { status: "failed", error: `OAuth completion failed: ${error}` }

      yield* Effect.tryPromise({
        try: () => pending.provider.commit(),
        catch: (cause) => new AuthError({ name, message: cause instanceof Error ? cause.message : String(cause) }),
      })
      state.pendingOAuth.delete(name)
      yield* callback.cancelPending(authKey(name))
      yield* closeTransport(pending.transport)
      yield* auth.clearCodeVerifier(name)
      yield* auth.clearOAuthState(name)
      return yield* createAndStore(name, { ...server, disabled: false })
    })

    const authenticate: Interface["authenticate"] = Effect.fn("MCP.authenticate")(function* (name, onAuthorization) {
      const result = yield* beginAuth(name)
      if (result.client) return yield* storeAuthenticatedClient(name, result.client)

      return yield* Effect.gen(function* () {
        const waiting = yield* callback.waitForCallback(result.oauthState, authKey(name)).pipe(
          Effect.mapError((error) => new AuthError({ name, message: error.message })),
          Effect.forkChild,
        )
        if (onAuthorization) yield* Effect.sync(() => onAuthorization(result.authorizationUrl))
        yield* browser
          .open(result.authorizationUrl)
          .pipe(
            Effect.catch(() =>
              events
                .publish(
                  McpEvent.BrowserOpenFailed,
                  { mcpName: name, url: result.authorizationUrl },
                  { location: locationRef },
                )
                .pipe(Effect.ignore),
            ),
          )
        const code = yield* Fiber.join(waiting)
        const storedState = yield* auth.getOAuthState(name)
        if (storedState !== result.oauthState) {
          yield* auth.clearOAuthState(name)
          return yield* new AuthError({ name, message: "OAuth state mismatch - potential CSRF attack" })
        }
        return yield* finishAuth(name, code)
      }).pipe(Effect.onInterrupt(() => discardPendingAuth(name)))
    })

    const removeAuth = Effect.fn("MCP.removeAuth")(function* (name: string) {
      yield* discardPendingAuth(name)
      yield* auth.remove(name)
    })

    const supportsOAuth = Effect.fn("MCP.supportsOAuth")(function* (name: string) {
      const server = yield* requireServer(name)
      return server.type === "remote" && server.oauth !== false
    })

    const hasStoredTokens = Effect.fn("MCP.hasStoredTokens")(function* (name: string) {
      return Boolean((yield* auth.get(name))?.tokens)
    })

    const getAuthStatus: Interface["getAuthStatus"] = Effect.fn("MCP.getAuthStatus")(function* (name) {
      const server = serverConfig(name)
      if (!server || server.type !== "remote") return "not_authenticated"
      const entry = yield* auth.getForUrl(name, server.url)
      if (!entry?.tokens) return "not_authenticated"
      if (entry.tokens.expiresAt && entry.tokens.expiresAt < Date.now() / 1_000) return "expired"
      return "authenticated"
    })

    return Service.of({
      status,
      clients,
      instructions,
      tools,
      prompts,
      resources,
      resourceTemplates,
      add,
      connect,
      disconnect,
      getPrompt,
      readResource,
      startAuth,
      authenticate,
      finishAuth,
      removeAuth,
      supportsOAuth,
      hasStoredTokens,
      getAuthStatus,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Config.node,
    EventV2.node,
    Location.node,
    CrossSpawnSpawner.node,
    McpAuth.node,
    McpBrowser.node,
    McpOAuthCallback.node,
  ],
})

const toolsLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* Service
    const tools = yield* Tools.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const captured = yield* Effect.context<Service | PermissionV2.Service>()
    const parent = yield* Scope.make()
    yield* Effect.addFinalizer((exit) => Scope.close(parent, exit).pipe(Effect.ignore))
    const lock = Semaphore.makeUnsafe(1)
    let current: Scope.Closeable | undefined
    const resolved = resolveConfig(yield* config.entries())

    const sync = lock.withPermit(
      Effect.gen(function* () {
        const child = yield* Scope.fork(parent)
        const statuses = yield* mcp.status()
        const grouped = Object.groupBy(
          Object.entries(yield* mcp.tools())
            .filter(([, entry]) => !McpCatalog.isBlockedTool(entry.def.name, resolved.blockedTools))
            .filter(([, entry]) => McpCatalog.isModelVisible(entry.def)),
          ([, entry]) => entry.clientName,
        )
        const registered = yield* Effect.gen(function* () {
          for (const [name, status] of Object.entries(statuses).toSorted(([left], [right]) =>
            left.localeCompare(right),
          )) {
            const source = { type: "mcp" as const, id: name, displayName: name }
            const state = sourceStatus(status)
            yield* tools.contribute({
              source,
              state: state.state,
              ...(state.message === undefined ? {} : { message: state.message }),
              permissions: [`${mcpToolPrefix(name)}*`],
              tools: Object.fromEntries(
                (grouped[name] ?? []).map(([callableName, entry]) => {
                  const exposed = Tool.withExposure(
                    McpCatalog.toCoreTool(entry),
                    resolved.directTools.has(callableName) ? "direct" : "deferred",
                  )
                  return [
                    callableName,
                    Tool.withCatalog(exposed, {
                      source,
                      sourceLocalID: entry.def.name,
                      namespace: entry.clientName,
                    }),
                  ]
                }),
              ),
            })
          }
          yield* tools.register(yield* McpResourceTools.catalog())
        }).pipe(Scope.provide(child), Effect.orDie, Effect.exit)
        if (Exit.isFailure(registered)) {
          yield* Scope.close(child, registered).pipe(Effect.ignore)
          return yield* registered
        }
        const previous = current
        current = child
        if (previous) yield* Scope.close(previous, Exit.void).pipe(Effect.ignore)
      }),
    )

    yield* sync
    const unsubscribe = yield* events.listen((event) => {
      if (event.type !== McpEvent.ToolsChanged.type) return Effect.void
      if (event.location?.directory !== location.directory || event.location.workspaceID !== location.workspaceID)
        return Effect.void
      return sync.pipe(Effect.provide(captured))
    })
    yield* Effect.addFinalizer(() => unsubscribe)
  }),
)

export const toolsNode = makeLocationNode({
  name: "mcp-tools",
  layer: toolsLayer,
  deps: [node, ToolRegistry.toolsNode, EventV2.node, Location.node, PermissionV2.node, Config.node],
})

function resolveConfig(entries: ReadonlyArray<Config.Entry>): ResolvedConfig {
  const configured = entries.flatMap((entry) => (entry.type === "document" && entry.info.mcp ? [entry.info.mcp] : []))
  return {
    timeout: Object.assign(new ConfigMCP.Timeout({}), ...configured.map((info) => info.timeout ?? {})),
    servers: Object.assign({}, ...configured.map((info) => info.servers ?? {})),
    blockedTools: new Set([...DEFAULT_BLOCKED_TOOLS, ...configured.flatMap((info) => info.blockedTools ?? [])]),
    directTools: new Set(configured.flatMap((info) => info.directTools ?? [])),
  }
}

function sourceStatus(status: Status): { readonly state: "ready" | "disabled" | "failed"; readonly message?: string } {
  if (status.status === "connected") return { state: "ready" }
  if (status.status === "disabled") return { state: "disabled" }
  return {
    state: "failed",
    ...("error" in status ? { message: status.error } : {}),
  }
}

function mcpToolPrefix(name: string) {
  const prefix = McpCatalog.toolName(name, "")
  return prefix.endsWith("_") ? prefix : `${prefix}_`
}

function createClient(directory: string) {
  const client = new Client({ name: "opencode", version: InstallationVersion }, CLIENT_OPTIONS)
  client.setRequestHandler(ListRootsRequestSchema, () =>
    Promise.resolve({ roots: [{ uri: pathToFileURL(directory).href }] }),
  )
  return client
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer)
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operation timed out after ${milliseconds}ms`)), milliseconds)
    }),
  ])
}

export * as MCP from "./runtime"
