import { LspEvent } from "@opencode-ai/schema/lsp-event"
import { Lsp } from "@opencode-ai/schema/lsp"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Location } from "../location"
import { NonNegativeInt } from "../schema"
import { LSPClient } from "./client"
import { LSPDiagnostic } from "./diagnostic"
import { LSPProcess } from "./process"
import { LSPServer } from "./server"

export const Event = LspEvent

const Position = Schema.Struct({
  line: NonNegativeInt,
  character: NonNegativeInt,
})

export const Range = Schema.Struct({
  start: Position,
  end: Position,
}).annotate({ identifier: "Range" })
export type Range = typeof Range.Type

export const Symbol = Schema.Struct({
  name: Schema.String,
  kind: NonNegativeInt,
  location: Schema.Struct({
    uri: Schema.String,
    range: Range,
  }),
}).annotate({ identifier: "Symbol" })
export type Symbol = typeof Symbol.Type

export const DocumentSymbol = Schema.Struct({
  name: Schema.String,
  detail: Schema.optional(Schema.String),
  kind: NonNegativeInt,
  range: Range,
  selectionRange: Range,
}).annotate({ identifier: "DocumentSymbol" })
export type DocumentSymbol = typeof DocumentSymbol.Type

export const Status = Lsp.Status
export type Status = Lsp.Status

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("LSP.RegistrationError", {
  id: Schema.String,
  message: Schema.String,
}) {}

enum SymbolKind {
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Struct = 23,
}

const kinds = [
  SymbolKind.Class,
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Interface,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
  SymbolKind.Enum,
]

type LocInput = { readonly file: string; readonly line: number; readonly character: number }

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly contribute: (server: LSPServer.Info) => Effect.Effect<void, RegistrationError, Scope.Scope>
  readonly status: () => Effect.Effect<Status[]>
  readonly hasClients: (file: string) => Effect.Effect<boolean>
  readonly touchFile: (input: string, diagnostics?: "document" | "full") => Effect.Effect<void>
  readonly diagnostics: () => Effect.Effect<Record<string, LSPClient.Diagnostic[]>>
  readonly hover: (input: LocInput) => Effect.Effect<unknown[]>
  readonly definition: (input: LocInput) => Effect.Effect<unknown[]>
  readonly references: (input: LocInput) => Effect.Effect<unknown[]>
  readonly implementation: (input: LocInput) => Effect.Effect<unknown[]>
  readonly documentSymbol: (uri: string) => Effect.Effect<(DocumentSymbol | Symbol)[]>
  readonly workspaceSymbol: (query: string) => Effect.Effect<Symbol[]>
  readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<unknown[]>
  readonly incomingCalls: (input: LocInput) => Effect.Effect<unknown[]>
  readonly outgoingCalls: (input: LocInput) => Effect.Effect<unknown[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LSP") {}

export interface LayerOptions {
  readonly servers?: ReadonlyArray<LSPServer.Info>
  readonly disableDownload?: boolean
  readonly experimentalTy?: boolean
}

const envBoolean = (name: string) => {
  const value = process.env[name]?.toLowerCase()
  return value === "1" || value === "true"
}

export const layerWith = (options: LayerOptions = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const events = yield* EventV2.Service
      const location = yield* Location.Service
      const context: LSPServer.Context = {
        directory: location.directory,
        projectDirectory: location.project.directory,
        disableDownload: options.disableDownload ?? envBoolean("OPENCODE_DISABLE_LSP_DOWNLOAD"),
        experimentalTy: options.experimentalTy ?? envBoolean("OPENCODE_EXPERIMENTAL_LSP_TY"),
      }
      const configured = Config.latest(yield* config.entries(), "lsp")
      const servers: Record<string, LSPServer.Info> = Object.fromEntries(
        (options.servers ?? LSPServer.builtins).map((server) => [server.id, server]),
      )

      if (!configured) {
        yield* Effect.logInfo("all LSPs are disabled")
        for (const id of Object.keys(servers)) delete servers[id]
      }
      if (configured && configured !== true) {
        for (const [name, item] of Object.entries(configured)) {
          const existing = servers[name]
          if (item.disabled) {
            delete servers[name]
            continue
          }
          const command = item.command[0]
          if (!command) {
            yield* Effect.logWarning(`LSP server ${name} has an empty command`)
            continue
          }
          servers[name] = {
            ...existing,
            id: name,
            root: existing?.root ?? (async () => location.directory),
            extensions: item.extensions ?? existing?.extensions ?? [],
            spawn: async (root) => ({
              process: LSPProcess.spawn(command, item.command.slice(1), {
                cwd: root,
                env: { ...process.env, ...item.env },
              }),
              initialization: item.initialization,
            }),
          }
        }
      }
      if (context.experimentalTy) delete servers.pyright
      if (!context.experimentalTy) delete servers.ty

      yield* Effect.logInfo("enabled LSP servers", { serverIds: Object.keys(servers).join(", ") })
      type PendingSpawn = {
        readonly server: LSPServer.Info
        stale: boolean
        handle?: LSPServer.Handle
        task: Promise<LSPClient.Info | undefined>
      }
      const state = {
        clients: [] as LSPClient.Info[],
        servers,
        owners: new Map<string, symbol>(),
        broken: new Set<string>(),
        spawning: new Map<string, PendingSpawn>(),
      }
      const spawnKey = (root: string, id: string) => `${root}\u0000${id}`
      const owns = (server: LSPServer.Info) => state.servers[server.id] === server

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          for (const id of Object.keys(state.servers)) delete state.servers[id]
          state.owners.clear()
          for (const pending of state.spawning.values()) {
            pending.stale = true
            if (pending.handle) await LSPProcess.stop(pending.handle.process)
          }
          state.spawning.clear()
          const clients = state.clients.splice(0)
          await Promise.all(clients.map((client) => client.shutdown()))
        }),
      )

      const removeContribution = Effect.fnUntraced(function* (server: LSPServer.Info, owner: symbol) {
        if (state.owners.get(server.id) !== owner) return
        state.owners.delete(server.id)
        delete state.servers[server.id]
        const handles: LSPServer.Handle[] = []
        for (const [key, pending] of state.spawning) {
          if (pending.server !== server) continue
          pending.stale = true
          state.spawning.delete(key)
          if (pending.handle) handles.push(pending.handle)
        }
        for (const key of state.broken) {
          if (key.endsWith(`\u0000${server.id}`)) state.broken.delete(key)
        }
        const clients = state.clients.filter((client) => client.serverID === server.id)
        state.clients.splice(
          0,
          state.clients.length,
          ...state.clients.filter((client) => client.serverID !== server.id),
        )
        yield* events.publish(Event.Updated, {})
        yield* Effect.forEach(handles, (handle) => Effect.promise(() => LSPProcess.stop(handle.process)), {
          concurrency: "unbounded",
          discard: true,
        })
        yield* Effect.forEach(clients, (client) => Effect.promise(() => client.shutdown()), {
          concurrency: "unbounded",
          discard: true,
        })
      })

      const getClients = Effect.fnUntraced(function* (file: string) {
        const clients = yield* Effect.promise(async () => {
          const extension = path.parse(file).ext || file
          const result: LSPClient.Info[] = []
          let updated = 0

          async function schedule(server: LSPServer.Info, root: string, key: string, pending: PendingSpawn) {
            const handle = await server.spawn(root, context).catch(() => undefined)
            pending.handle = handle
            if (pending.stale || !owns(server)) {
              if (handle) await LSPProcess.stop(handle.process)
              pending.handle = undefined
              return
            }
            if (!handle) {
              state.broken.add(key)
              return
            }
            const client = await LSPClient.create({
              serverID: server.id,
              server: handle,
              root,
              directory: location.directory,
            }).catch(async () => {
              if (owns(server)) state.broken.add(key)
              pending.handle = undefined
              await LSPProcess.stop(handle.process)
              return undefined
            })
            pending.handle = undefined
            if (!client) return
            if (pending.stale || !owns(server)) {
              await client.shutdown()
              return
            }
            const existing = state.clients.find((item) => item.root === root && item.serverID === server.id)
            if (existing) {
              await client.shutdown()
              return existing
            }
            state.clients.push(client)
            return client
          }

          for (const server of Object.values(state.servers)) {
            if (server.extensions.length && !server.extensions.includes(extension)) continue
            const root = await server.root(file, context)
            if (!root || !owns(server)) continue
            const key = spawnKey(root, server.id)
            if (state.broken.has(key)) continue
            const existing = state.clients.find((item) => item.root === root && item.serverID === server.id)
            if (existing) {
              result.push(existing)
              continue
            }
            const inflight = state.spawning.get(key)
            if (inflight) {
              const client = await inflight.task
              if (client && owns(server)) result.push(client)
              continue
            }
            const pending: PendingSpawn = {
              server,
              stale: false,
              task: Promise.resolve(undefined),
            }
            const task = schedule(server, root, key, pending)
            pending.task = task
            state.spawning.set(key, pending)
            const clear = () => {
              if (state.spawning.get(key) === pending) state.spawning.delete(key)
            }
            void task.then(clear, clear)
            const client = await task
            if (!client || !owns(server)) continue
            result.push(client)
            updated++
          }
          return { result, updated }
        })
        yield* Effect.forEach(Array.from({ length: clients.updated }), () => events.publish(Event.Updated, {}), {
          discard: true,
        })
        return clients.result
      })

      const run = Effect.fnUntraced(function* <T>(file: string, fn: (client: LSPClient.Info) => Promise<T>) {
        const clients = yield* getClients(file)
        return yield* Effect.promise(() => Promise.all(clients.map((client) => fn(client))))
      })

      const runAll = Effect.fnUntraced(function* <T>(fn: (client: LSPClient.Info) => Promise<T>) {
        return yield* Effect.promise(() => Promise.all(state.clients.map((client) => fn(client))))
      })

      const init = Effect.fn("LSP.init")(function* () {
        return yield* Effect.void
      })

      const contribute: Interface["contribute"] = Effect.fn("LSP.contribute")(function* (server) {
        if (state.servers[server.id]) {
          return yield* new RegistrationError({
            id: server.id,
            message: `LSP server "${server.id}" is already registered`,
          })
        }

        const scope = yield* Scope.Scope
        const owner = globalThis.Symbol(server.id)
        state.servers[server.id] = server
        state.owners.set(server.id, owner)
        yield* Scope.addFinalizer(scope, removeContribution(server, owner).pipe(Effect.ignore))
        yield* events.publish(Event.Updated, {})
      })

      const status = Effect.fn("LSP.status")(function* () {
        return state.clients.map((client) => ({
          id: client.serverID,
          name: state.servers[client.serverID]?.id ?? client.serverID,
          root: path.relative(location.directory, client.root),
          status: "connected" as const,
        }))
      })

      const hasClients = Effect.fn("LSP.hasClients")(function* (file: string) {
        const extension = path.parse(file).ext || file
        return yield* Effect.promise(async () => {
          for (const server of Object.values(state.servers)) {
            if (server.extensions.length && !server.extensions.includes(extension)) continue
            const root = await server.root(file, context)
            if (!root || !owns(server)) continue
            if (!state.broken.has(spawnKey(root, server.id))) return true
          }
          return false
        })
      })

      const touchFile = Effect.fn("LSP.touchFile")(function* (input: string, diagnostics?: "document" | "full") {
        const clients = yield* getClients(input)
        yield* Effect.promise(() =>
          Promise.all(
            clients.map(async (client) => {
              const after = Date.now()
              const version = await client.notify.open({ path: input })
              if (!diagnostics) return
              await client.waitForDiagnostics({ path: input, version, mode: diagnostics, after })
            }),
          ).then(() => undefined),
        )
      })

      const diagnostics = Effect.fn("LSP.diagnostics")(function* () {
        const results: Record<string, LSPClient.Diagnostic[]> = {}
        for (const result of yield* runAll(async (client) => client.diagnostics)) {
          for (const [file, items] of result.entries()) results[file] = [...(results[file] ?? []), ...items]
        }
        return results
      })

      const hover = Effect.fn("LSP.hover")(function* (input: LocInput) {
        return yield* run(input.file, (client) =>
          client.connection
            .sendRequest("textDocument/hover", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => null),
        )
      })

      const definition = Effect.fn("LSP.definition")(function* (input: LocInput) {
        const values = yield* run(input.file, (client) =>
          client.connection
            .sendRequest<unknown>("textDocument/definition", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => null),
        )
        return values.flatMap((value) => (Array.isArray(value) ? value : value === null ? [] : [value]))
      })

      const references = Effect.fn("LSP.references")(function* (input: LocInput) {
        return (yield* run(input.file, (client) =>
          client.connection
            .sendRequest<unknown[]>("textDocument/references", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
              context: { includeDeclaration: true },
            })
            .catch(() => []),
        )).flat()
      })

      const implementation = Effect.fn("LSP.implementation")(function* (input: LocInput) {
        const values = yield* run(input.file, (client) =>
          client.connection
            .sendRequest<unknown>("textDocument/implementation", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => null),
        )
        return values.flatMap((value) => (Array.isArray(value) ? value : value === null ? [] : [value]))
      })

      const documentSymbol = Effect.fn("LSP.documentSymbol")(function* (uri: string) {
        return (yield* run(fileURLToPath(uri), (client) =>
          client.connection
            .sendRequest<(DocumentSymbol | Symbol)[]>("textDocument/documentSymbol", { textDocument: { uri } })
            .catch(() => []),
        )).flat()
      })

      const workspaceSymbol = Effect.fn("LSP.workspaceSymbol")(function* (query: string) {
        return (yield* runAll((client) =>
          client.connection
            .sendRequest<Symbol[]>("workspace/symbol", { query })
            .then((result) => result.filter((item) => kinds.includes(item.kind)).slice(0, 10))
            .catch(() => []),
        )).flat()
      })

      const prepareCallHierarchy = Effect.fn("LSP.prepareCallHierarchy")(function* (input: LocInput) {
        return (yield* run(input.file, (client) =>
          client.connection
            .sendRequest<unknown[]>("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => []),
        )).flat()
      })

      const callHierarchyRequest = Effect.fnUntraced(function* (
        input: LocInput,
        direction: "callHierarchy/incomingCalls" | "callHierarchy/outgoingCalls",
      ) {
        return (yield* run(input.file, async (client) => {
          const items = await client.connection
            .sendRequest<unknown[]>("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            })
            .catch(() => [])
          if (!items.length) return []
          return client.connection.sendRequest<unknown[]>(direction, { item: items[0] }).catch(() => [])
        })).flat()
      })

      const incomingCalls = Effect.fn("LSP.incomingCalls")(function* (input: LocInput) {
        return yield* callHierarchyRequest(input, "callHierarchy/incomingCalls")
      })
      const outgoingCalls = Effect.fn("LSP.outgoingCalls")(function* (input: LocInput) {
        return yield* callHierarchyRequest(input, "callHierarchy/outgoingCalls")
      })

      return Service.of({
        contribute,
        init,
        status,
        hasClients,
        touchFile,
        diagnostics,
        hover,
        definition,
        references,
        implementation,
        documentSymbol,
        workspaceSymbol,
        prepareCallHierarchy,
        incomingCalls,
        outgoingCalls,
      })
    }),
  )

const layer = layerWith()

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, EventV2.node, Location.node],
})

export const Diagnostic = LSPDiagnostic
export * as LSP from "./lsp"
