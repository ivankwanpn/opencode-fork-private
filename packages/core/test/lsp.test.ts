import { describe, expect } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { ConfigLSP } from "@opencode-ai/core/config/lsp"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LSP } from "@opencode-ai/core/lsp/lsp"
import { LSPServer } from "@opencode-ai/core/lsp/server"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect"
import path from "node:path"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const directory = AbsolutePath.make(process.cwd())
const publish = <D extends EventV2.Definition>(definition: D, data: EventV2.Data<D>) =>
  Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<D>)
const events = Layer.succeed(
  EventV2.Service,
  EventV2.Service.of({
    publish,
    publishBatch: (options) =>
      Effect.forEach(options.events, (item) => publish(item.definition, item.data), { discard: false }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  }),
)
const activeLocation = Layer.succeed(Location.Service, Location.Service.of(location(Location.Ref.make({ directory }))))
const document = (lsp: Config.Info["lsp"]) =>
  new Config.Document({
    type: "document",
    info: new Config.Info({ lsp }),
  })
const layer = (input: { readonly servers?: ReadonlyArray<LSPServer.Info>; readonly entries?: Config.Entry[] } = {}) =>
  LSP.layerWith({ servers: input.servers ?? [] }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed(input.entries ?? []) })),
        events,
        activeLocation,
      ),
    ),
  )

const disabled = testEffect(layer())
const configured = testEffect(
  layer({
    entries: [
      document({
        custom: new ConfigLSP.Server({
          command: ["custom-language-server", "--stdio"],
          extensions: [".ts"],
          env: { CUSTOM_LSP: "1" },
        }),
      }),
    ],
  }),
)
const catalog = testEffect(
  layer({
    entries: [document(true)],
    servers: [
      {
        id: "typescript",
        extensions: [".ts"],
        root: async (_file, context) => context.directory,
        spawn: async () => undefined,
      },
    ],
  }),
)

describe("LSP", () => {
  disabled.effect("exposes the complete canonical V1 built-in catalog", () =>
    Effect.sync(() => {
      const ids = LSPServer.builtins.map((server) => server.id)
      expect(ids).toEqual([
        "deno",
        "typescript",
        "vue",
        "eslint",
        "oxlint",
        "biome",
        "gopls",
        "ruby-lsp",
        "ty",
        "pyright",
        "elixir-ls",
        "zls",
        "csharp",
        "razor",
        "fsharp",
        "sourcekit-lsp",
        "rust",
        "clangd",
        "svelte",
        "astro",
        "jdtls",
        "kotlin-ls",
        "yaml-ls",
        "lua-ls",
        "php intelephense",
        "prisma",
        "dart",
        "ocaml-lsp",
        "bash",
        "terraform",
        "texlab",
        "dockerfile",
        "gleam",
        "clojure-lsp",
        "nixd",
        "tinymist",
        "haskell-language-server",
        "julials",
      ])
      expect(new Set(ids).size).toBe(38)
      for (const server of LSPServer.builtins) {
        expect(Array.isArray(server.extensions)).toBe(true)
        expect(typeof server.root).toBe("function")
        expect(typeof server.spawn).toBe("function")
      }
    }),
  )

  disabled.effect("keeps the Location-scoped service disabled without LSP configuration", () =>
    Effect.gen(function* () {
      const lsp = yield* LSP.Service

      expect(yield* lsp.status()).toEqual([])
      expect(yield* lsp.hasClients(path.join(directory, "index.ts"))).toBe(false)
      expect(yield* lsp.diagnostics()).toEqual({})
    }),
  )

  disabled.effect("removes a scoped LSP contribution when its owner scope closes", () =>
    Effect.gen(function* () {
      const lsp = yield* LSP.Service
      const scope = yield* Scope.make()
      const file = path.join(directory, "index.ts")

      yield* lsp
        .contribute({
          id: "plugin-typescript",
          extensions: [".ts"],
          root: async (_file, context) => context.directory,
          spawn: async () => undefined,
        })
        .pipe(Scope.provide(scope))

      expect(yield* lsp.hasClients(file)).toBe(true)
      yield* Scope.close(scope, Exit.void)
      expect(yield* lsp.hasClients(file)).toBe(false)
      expect(yield* lsp.status()).toEqual([])
    }),
  )

  disabled.effect("does not spawn a scoped LSP contribution after its owner scope closes", () => {
    let rootReady!: () => void
    let releaseRoot!: (root: string) => void
    const entered = new Promise<void>((resolve) => {
      rootReady = resolve
    })
    const root = new Promise<string>((resolve) => {
      releaseRoot = resolve
    })
    let spawns = 0

    return Effect.gen(function* () {
      const lsp = yield* LSP.Service
      const scope = yield* Scope.make()

      yield* lsp
        .contribute({
          id: "slow-plugin",
          extensions: [".ts"],
          root: async () => {
            rootReady()
            return root
          },
          spawn: async () => {
            spawns++
            return undefined
          },
        })
        .pipe(Scope.provide(scope))

      const touching = yield* lsp.touchFile(path.join(directory, "index.ts")).pipe(Effect.forkChild)
      yield* Effect.promise(() => entered)
      yield* Scope.close(scope, Exit.void)
      releaseRoot(directory)
      yield* Fiber.join(touching)

      expect(spawns).toBe(0)
      expect(yield* lsp.hasClients(path.join(directory, "index.ts"))).toBe(false)
    })
  })

  configured.effect("materializes configured servers without V1 runtime services", () =>
    Effect.gen(function* () {
      const lsp = yield* LSP.Service

      expect(yield* lsp.hasClients(path.join(directory, "index.ts"))).toBe(true)
      expect(yield* lsp.hasClients(path.join(directory, "main.py"))).toBe(false)
    }),
  )

  catalog.effect("accepts the canonical built-in server catalog supplied by the V2 layer", () =>
    Effect.gen(function* () {
      const lsp = yield* LSP.Service

      expect(yield* lsp.hasClients(path.join(directory, "index.ts"))).toBe(true)
      expect(yield* lsp.hasClients(path.join(directory, "main.py"))).toBe(false)
    }),
  )
})
