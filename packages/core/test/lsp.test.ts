import { describe, expect } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { ConfigLSP } from "@opencode-ai/core/config/lsp"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LSP } from "@opencode-ai/core/lsp/lsp"
import { LSPServer } from "@opencode-ai/core/lsp/server"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Stream } from "effect"
import path from "node:path"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const directory = AbsolutePath.make(process.cwd())
const events = Layer.succeed(
  EventV2.Service,
  EventV2.Service.of({
    publish: (definition, data) =>
      Effect.succeed({ id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>),
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
const activeLocation = Layer.succeed(
  Location.Service,
  Location.Service.of(location(Location.Ref.make({ directory }))),
)
const document = (lsp: Config.Info["lsp"]) =>
  new Config.Document({
    type: "document",
    info: new Config.Info({ lsp }),
  })
const layer = (input: { readonly servers?: ReadonlyArray<LSPServer.Info>; readonly entries?: Config.Entry[] } = {}) =>
  LSP.layerWith({ servers: input.servers ?? [] }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          Config.Service,
          Config.Service.of({ entries: () => Effect.succeed(input.entries ?? []) }),
        ),
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
