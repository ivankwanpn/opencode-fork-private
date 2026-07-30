import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

const it = testEffect(Layer.empty)

const instructionLayer = (input: {
  config: string
  home?: string
  locationServiceLayer: Layer.Layer<Location.Service>
  filesystemLayer?: Layer.Layer<FSUtil.Service>
}) =>
  AppNodeBuilder.build(LayerNode.group([SystemContextRegistry.node, InstructionContext.node]), [
    [Global.node, Global.layerWith({ config: input.config, ...(input.home ? { home: input.home } : {}) })],
    [Location.node, input.locationServiceLayer],
    ...(input.filesystemLayer ? [[FSUtil.node, input.filesystemLayer] as const] : []),
  ])

const configuredInstructionLayer = (input: {
  config: string
  home: string
  entries: () => Config.Entry[]
  locationServiceLayer: Layer.Layer<Location.Service>
  filesystemLayer?: Layer.Layer<FSUtil.Service>
  httpClient?: HttpClient.HttpClient
}) =>
  AppNodeBuilder.build(LayerNode.group([SystemContextRegistry.node, InstructionContext.configuredNode]), [
    [Global.node, Global.layerWith({ config: input.config, home: input.home })],
    [Location.node, input.locationServiceLayer],
    [
      Config.node,
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.sync(input.entries),
        }),
      ),
    ],
    ...(input.filesystemLayer ? [[FSUtil.node, input.filesystemLayer] as const] : []),
    ...(input.httpClient
      ? [[LayerNodePlatform.httpClient, Layer.succeed(HttpClient.HttpClient, input.httpClient)] as const]
      : []),
  ])

const configuredEntries = (instructions: string[]) => [
  new Config.Document({
    type: "document" as const,
    path: "/config/opencode.json",
    info: new Config.Info({ instructions }),
  }),
]

const nestedInstructionLayer = (input: {
  config: string
  home: string
  entries: () => Config.Entry[]
  locationServiceLayer: Layer.Layer<Location.Service>
  filesystemLayer?: Layer.Layer<FSUtil.Service>
}) =>
  AppNodeBuilder.build(InstructionContext.nestedNode, [
    [Global.node, Global.layerWith({ config: input.config, home: input.home })],
    [Location.node, input.locationServiceLayer],
    [
      Config.node,
      Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.sync(input.entries),
        }),
      ),
    ],
    ...(input.filesystemLayer ? [[FSUtil.node, input.filesystemLayer] as const] : []),
  ])

const completedReadHistory = (...loaded: string[]): ReadonlyArray<SessionMessage.Message> => [
  {
    type: "assistant",
    content: [
      {
        type: "tool",
        name: "read",
        state: {
          status: "completed",
          structured: { loaded },
        },
      },
    ],
  } as unknown as SessionMessage.Message,
]

describe("InstructionContext", () => {
  it.live("loads global and upward project AGENTS.md files as one aggregate context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "packages", "core")
          const outside = path.join(tmp.path, "AGENTS.md")
          const globalFile = path.join(global, "AGENTS.md")
          const projectFile = path.join(project, "AGENTS.md")
          const packageFile = path.join(directory, "AGENTS.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(outside, "outside")
            await fs.writeFile(globalFile, "global")
            await fs.writeFile(projectFile, "project")
            await fs.writeFile(packageFile, "package")
          })

          const load = SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: global,
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )

          const initialized = yield* SystemContext.initialize(yield* load)
          expect(initialized.baseline).toBe(
            [
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${packageFile}\npackage`,
              `Instructions from: ${projectFile}\nproject`,
            ].join("\n\n"),
          )
          expect(initialized.baseline).not.toContain("outside")

          yield* Effect.promise(() => fs.writeFile(packageFile, "changed"))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toMatchObject({
            _tag: "Updated",
            text: expect.stringContaining(`Instructions from: ${packageFile}\nchanged`),
          })

          yield* Effect.promise(() => fs.rm(packageFile))
          const partial = yield* SystemContext.reconcile(yield* load, initialized.snapshot)
          expect(partial).toEqual({
            _tag: "Updated",
            text: [
              "These instructions replace all previously loaded ambient instructions.",
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${projectFile}\nproject`,
            ].join("\n\n"),
            snapshot: expect.any(Object),
          })

          yield* Effect.promise(() => Promise.all([fs.rm(globalFile), fs.rm(projectFile)]))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({
            _tag: "Updated",
            text: "Previously loaded instructions no longer apply.",
            snapshot: {},
          })
        }),
      ),
    ),
  )

  it.live("uses V1 instruction-family precedence with CLAUDE.md and CONTEXT.md fallbacks", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const home = path.join(tmp.path, "home")
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "packages", "core")
          const globalAgents = path.join(global, "AGENTS.md")
          const globalClaude = path.join(home, ".claude", "CLAUDE.md")
          const projectAgents = path.join(project, "AGENTS.md")
          const projectClaude = path.join(project, "CLAUDE.md")
          const nearbyClaude = path.join(directory, "CLAUDE.md")
          const projectContext = path.join(project, "CONTEXT.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(path.dirname(globalClaude), { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(globalAgents, "global-agents")
            await fs.writeFile(globalClaude, "global-claude")
            await fs.writeFile(projectAgents, "project-agents")
            await fs.writeFile(projectClaude, "project-claude")
            await fs.writeFile(nearbyClaude, "nearby-claude")
            await fs.writeFile(projectContext, "project-context")
          })

          const load = SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: global,
                home,
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )
          const initialized = yield* SystemContext.initialize(yield* load)
          expect(initialized.baseline).toBe(
            [
              `Instructions from: ${globalAgents}\nglobal-agents`,
              `Instructions from: ${projectAgents}\nproject-agents`,
            ].join("\n\n"),
          )

          yield* Effect.promise(() => Promise.all([fs.rm(globalAgents), fs.rm(projectAgents)]))
          const claude = yield* SystemContext.reconcile(yield* load, initialized.snapshot)
          expect(claude).toMatchObject({
            _tag: "Updated",
            text: [
              "These instructions replace all previously loaded ambient instructions.",
              `Instructions from: ${globalClaude}\nglobal-claude`,
              `Instructions from: ${nearbyClaude}\nnearby-claude`,
              `Instructions from: ${projectClaude}\nproject-claude`,
            ].join("\n\n"),
          })
          if (claude._tag !== "Updated") throw new Error("Expected CLAUDE.md fallback")

          yield* Effect.promise(() => Promise.all([fs.rm(nearbyClaude), fs.rm(projectClaude)]))
          expect(yield* SystemContext.reconcile(yield* load, claude.snapshot)).toMatchObject({
            _tag: "Updated",
            text: [
              "These instructions replace all previously loaded ambient instructions.",
              `Instructions from: ${globalClaude}\nglobal-claude`,
              `Instructions from: ${projectContext}\nproject-context`,
            ].join("\n\n"),
          })
        }),
      ),
    ),
  )

  it.live("honors direct and broad Claude Code prompt opt-outs", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.acquireUseRelease(
          Effect.sync(() => ({
            broad: process.env.OPENCODE_DISABLE_CLAUDE_CODE,
            direct: process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT,
          })),
          () =>
            Effect.gen(function* () {
              const global = path.join(tmp.path, "global")
              const home = path.join(tmp.path, "home")
              const project = path.join(tmp.path, "project")
              const directory = path.join(project, "src")
              const globalClaude = path.join(home, ".claude", "CLAUDE.md")
              const projectClaude = path.join(project, "CLAUDE.md")
              const projectContext = path.join(project, "CONTEXT.md")
              yield* Effect.promise(async () => {
                await fs.mkdir(path.dirname(globalClaude), { recursive: true })
                await fs.mkdir(directory, { recursive: true })
                await fs.writeFile(globalClaude, "global-claude")
                await fs.writeFile(projectClaude, "project-claude")
                await fs.writeFile(projectContext, "project-context")
              })
              process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = "1"

              const load = SystemContextRegistry.Service.pipe(
                Effect.flatMap((service) => service.load()),
                Effect.provide(
                  instructionLayer({
                    config: global,
                    home,
                    locationServiceLayer: Layer.succeed(
                      Location.Service,
                      Location.Service.of(
                        location(
                          { directory: AbsolutePath.make(directory) },
                          { projectDirectory: AbsolutePath.make(project) },
                        ),
                      ),
                    ),
                  }),
                ),
              )
              const initialized = yield* SystemContext.initialize(yield* load)
              expect(initialized.baseline).toBe(`Instructions from: ${projectContext}\nproject-context`)

              delete process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT
              process.env.OPENCODE_DISABLE_CLAUDE_CODE = "1"
              expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({ _tag: "Unchanged" })
            }),
          (previous) =>
            Effect.sync(() => {
              if (previous.broad === undefined) delete process.env.OPENCODE_DISABLE_CLAUDE_CODE
              else process.env.OPENCODE_DISABLE_CLAUDE_CODE = previous.broad
              if (previous.direct === undefined) delete process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT
              else process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = previous.direct
            }),
        ),
      ),
    ),
  )

  it.live("keeps an empty AGENTS.md as available context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "AGENTS.md")
          yield* Effect.promise(() => fs.writeFile(file, ""))
          const context = yield* SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              instructionLayer({
                config: path.join(tmp.path, "global"),
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
                ),
              }),
            ),
          )

          expect((yield* SystemContext.initialize(context)).baseline).toBe(`Instructions from: ${file}\n`)
        }),
      ),
    ),
  )

  it.effect("preserves admitted instructions while observation is unavailable", () =>
    Effect.gen(function* () {
      const failingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({ ...fs, up: () => Effect.fail(new FSUtil.FileSystemError({ method: "up" })) }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: failingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/instructions": {
            value: [{ path: "/repo/AGENTS.md", content: "old" }],
            removed: "Previously loaded instructions no longer apply.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("preserves admitted instructions when a discovered file disappears before read", () =>
    Effect.gen(function* () {
      const file = AbsolutePath.make("/repo/AGENTS.md")
      const racingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: () => Effect.succeed([file]),
              readFileStringSafe: () => Effect.succeed(undefined),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
      const context = yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: racingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
      )

      expect(
        yield* SystemContext.reconcile(context, {
          "core/instructions": {
            value: [{ path: file, content: "old" }],
            removed: "Previously loaded instructions no longer apply.",
          },
        }),
      ).toEqual({ _tag: "Unchanged" })
    }),
  )

  it.effect("canonicalizes upward discovery boundaries", () =>
    Effect.gen(function* () {
      const observed: { targets: string[]; start: string; stop?: string }[] = []
      const observingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: (options) =>
                Effect.sync(() => {
                  observed.push(options)
                  return []
                }),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: observingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make("/repo/") }, { projectDirectory: AbsolutePath.make("/repo") }),
              ),
            ),
          }),
        ),
      )

      expect(observed).toEqual(
        ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"].map((target) => ({
          targets: [target],
          start: FSUtil.resolve("/repo"),
          stop: FSUtil.resolve("/repo"),
        })),
      )
    }),
  )

  it.effect("honors the project instruction opt-out", () =>
    Effect.gen(function* () {
      const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      let scanned = false
      process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"

      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: Layer.effect(
              FSUtil.Service,
              FSUtil.Service.pipe(
                Effect.map((fs) => FSUtil.Service.of({ ...fs, up: () => Effect.sync(() => ((scanned = true), [])) })),
              ),
            ).pipe(Layer.provide(LayerNode.compile(FSUtil.node))),
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
            else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
          }),
        ),
      )

      expect(scanned).toBe(false)
    }),
  )

  it.effect("does not discover project instructions outside the canonical project root", () =>
    Effect.gen(function* () {
      let scanned = false
      yield* SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(
          instructionLayer({
            config: "/global",
            filesystemLayer: Layer.effect(
              FSUtil.Service,
              FSUtil.Service.pipe(
                Effect.map((fs) => FSUtil.Service.of({ ...fs, up: () => Effect.sync(() => ((scanned = true), [])) })),
              ),
            ).pipe(Layer.provide(LayerNode.compile(FSUtil.node))),
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location(
                  { directory: AbsolutePath.make("/outside") },
                  { projectDirectory: AbsolutePath.make("/repo") },
                ),
              ),
            ),
          }),
        ),
      )

      expect(scanned).toBe(false)
    }),
  )

  it.live("loads effective configured local, glob, home, absolute, and remote instructions in order", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const global = path.join(tmp.path, "global")
          const home = path.join(tmp.path, "home")
          const project = path.join(tmp.path, "project")
          const directory = path.join(project, "packages", "core")
          const contributing = path.join(project, "CONTRIBUTING.md")
          const ruleA = path.join(project, ".cursor", "rules", "a.md")
          const ruleB = path.join(project, ".cursor", "rules", "b.md")
          const absolute = path.join(tmp.path, "absolute.md")
          const homeFile = path.join(home, "home.md")
          const remote = "https://example.test/instructions.md"
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(ruleA), { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.mkdir(home, { recursive: true })
            await fs.writeFile(contributing, "contributing")
            await fs.writeFile(ruleB, "rule-b")
            await fs.writeFile(ruleA, "rule-a")
            await fs.writeFile(absolute, "absolute")
            await fs.writeFile(homeFile, "home")
          })

          const http = HttpClient.make((request) =>
            Effect.succeed(HttpClientResponse.fromWeb(request, new Response("remote", { status: 200 }))),
          )
          const entries = () => [
            new Config.Document({
              type: "document",
              path: path.join(global, "opencode.json"),
              info: new Config.Info({ instructions: ["ignored.md"] }),
            }),
            ...configuredEntries(["CONTRIBUTING.md", ".cursor/rules/*.md", absolute, "~/home.md", remote]),
          ]
          const context = yield* SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(
              configuredInstructionLayer({
                config: global,
                home,
                entries,
                httpClient: http,
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )
          const initialized = yield* SystemContext.initialize(context)

          expect(initialized.baseline).toBe(
            [
              `Instructions from: ${contributing}\ncontributing`,
              `Instructions from: ${ruleA}\nrule-a\n\nInstructions from: ${ruleB}\nrule-b`,
              `Instructions from: ${absolute}\nabsolute`,
              `Instructions from: ${homeFile}\nhome`,
              `Instructions from: ${remote}\nremote`,
            ].join("\n\n"),
          )
          expect(initialized.baseline).not.toContain("ignored")
          expect(Object.keys(initialized.snapshot)).toHaveLength(5)
        }),
      ),
    ),
  )

  it.live("preserves a configured local source while reading is unavailable, then confirms removal", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "rules.md")
          yield* Effect.promise(() => fs.writeFile(file, "initial"))
          let unreadable = false
          const filesystemLayer = Layer.effect(
            FSUtil.Service,
            FSUtil.Service.pipe(
              Effect.map((base) =>
                FSUtil.Service.of({
                  ...base,
                  readFileStringSafe: (target) =>
                    unreadable && path.resolve(target) === path.resolve(file)
                      ? Effect.succeed(undefined)
                      : base.readFileStringSafe(target),
                }),
              ),
            ),
          ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
          const layer = configuredInstructionLayer({
            config: path.join(tmp.path, "global"),
            home: path.join(tmp.path, "home"),
            entries: () => configuredEntries([file]),
            filesystemLayer,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
            ),
          })
          const load = SystemContextRegistry.Service.pipe(
            Effect.flatMap((service) => service.load()),
            Effect.provide(layer),
          )
          const initialized = yield* SystemContext.initialize(yield* load)

          unreadable = true
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({ _tag: "Unchanged" })

          unreadable = false
          yield* Effect.promise(() => fs.rm(file))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({
            _tag: "Updated",
            text: `Configured instructions from ${file} no longer apply.`,
            snapshot: {},
          })
        }),
      ),
    ),
  )

  it.effect("updates remote instructions, preserves them on failure, and removes deleted configuration", () =>
    Effect.gen(function* () {
      const remote = "https://example.test/remote.md"
      let instructions = [remote]
      let response = { body: "initial", status: 200 }
      const http = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response(response.body, { status: response.status }))),
      )
      const layer = configuredInstructionLayer({
        config: "/global",
        home: "/home",
        entries: () => configuredEntries(instructions),
        httpClient: http,
        locationServiceLayer: Layer.succeed(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
        ),
      })
      const load = SystemContextRegistry.Service.pipe(
        Effect.flatMap((service) => service.load()),
        Effect.provide(layer),
      )
      const initialized = yield* SystemContext.initialize(yield* load)
      expect(initialized.baseline).toBe(`Instructions from: ${remote}\ninitial`)

      response = { body: "changed", status: 200 }
      const changed = yield* SystemContext.reconcile(yield* load, initialized.snapshot)
      expect(changed).toMatchObject({
        _tag: "Updated",
        text: expect.stringContaining(`Instructions from: ${remote}\nchanged`),
      })
      if (changed._tag !== "Updated") throw new Error("Expected configured remote instructions to update")

      response = { body: "unavailable", status: 503 }
      expect(yield* SystemContext.reconcile(yield* load, changed.snapshot)).toEqual({ _tag: "Unchanged" })

      instructions = []
      expect(yield* SystemContext.reconcile(yield* load, changed.snapshot)).toEqual({
        _tag: "Updated",
        text: `Configured instructions from ${remote} no longer apply.`,
        snapshot: {},
      })
    }),
  )

  it.live("discovers and deduplicates nearby instruction families from completed reads", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp.path, "project")
          const source = path.join(root, "src")
          const deep = path.join(source, "deep")
          const rootAgents = path.join(root, "AGENTS.md")
          const sourceAgents = path.join(source, "AGENTS.md")
          const sourceClaude = path.join(source, "CLAUDE.md")
          const deepClaude = path.join(deep, "CLAUDE.md")
          const deepContext = path.join(deep, "CONTEXT.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(deep, { recursive: true })
            await fs.writeFile(rootAgents, "root")
            await fs.writeFile(sourceAgents, "source-agents")
            await fs.writeFile(sourceClaude, "source-claude")
            await fs.writeFile(deepClaude, "deep-claude")
            await fs.writeFile(deepContext, "deep-context")
          })

          const layer = nestedInstructionLayer({
            config: path.join(tmp.path, "global"),
            home: path.join(tmp.path, "home"),
            entries: () => [],
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(root) })),
            ),
          })
          const context = yield* InstructionContext.NestedService.pipe(
            Effect.flatMap((service) =>
              service.load(completedReadHistory(path.join(deep, "first.ts"), path.join(deep, "second.ts"))),
            ),
            Effect.provide(layer),
          )
          const initialized = yield* SystemContext.initialize(context)

          expect(initialized.baseline).toBe(
            [`Instructions from: ${deepClaude}\ndeep-claude`, `Instructions from: ${sourceAgents}\nsource-agents`].join(
              "\n\n",
            ),
          )
          expect(initialized.baseline).not.toContain("root\n")
          expect(initialized.baseline).not.toContain("source-claude")
          expect(initialized.baseline).not.toContain("deep-context")
        }),
      ),
    ),
  )

  it.live("rejects external reads and excludes configured or directly read instruction files", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp.path, "project")
          const source = path.join(root, "src")
          const docs = path.join(root, "docs")
          const outside = path.join(tmp.path, "outside")
          const configured = path.join(source, "AGENTS.md")
          const direct = path.join(docs, "AGENTS.md")
          const external = path.join(outside, "AGENTS.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(source, { recursive: true })
            await fs.mkdir(docs, { recursive: true })
            await fs.mkdir(outside, { recursive: true })
            await fs.writeFile(configured, "configured")
            await fs.writeFile(direct, "direct")
            await fs.writeFile(external, "external")
          })

          const layer = nestedInstructionLayer({
            config: path.join(tmp.path, "global"),
            home: path.join(tmp.path, "home"),
            entries: () => configuredEntries([configured]),
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(root) })),
            ),
          })
          const context = yield* InstructionContext.NestedService.pipe(
            Effect.flatMap((service) =>
              service.load(completedReadHistory(path.join(source, "file.ts"), direct, path.join(outside, "file.ts"))),
            ),
            Effect.provide(layer),
          )

          expect(yield* SystemContext.initialize(context)).toEqual({ baseline: "", snapshot: {} })
        }),
      ),
    ),
  )

  it.live("preserves admitted nearby instructions through read races and confirms removal", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = path.join(tmp.path, "project")
          const source = path.join(root, "src")
          const instruction = path.join(source, "AGENTS.md")
          const read = path.join(source, "file.ts")
          yield* Effect.promise(async () => {
            await fs.mkdir(source, { recursive: true })
            await fs.writeFile(instruction, "initial")
          })

          let unreadable = false
          const filesystemLayer = Layer.effect(
            FSUtil.Service,
            FSUtil.Service.pipe(
              Effect.map((base) =>
                FSUtil.Service.of({
                  ...base,
                  readFileStringSafe: (target) =>
                    unreadable && path.resolve(target) === path.resolve(instruction)
                      ? Effect.succeed(undefined)
                      : base.readFileStringSafe(target),
                }),
              ),
            ),
          ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
          const layer = nestedInstructionLayer({
            config: path.join(tmp.path, "global"),
            home: path.join(tmp.path, "home"),
            entries: () => [],
            filesystemLayer,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(root) })),
            ),
          })
          const load = InstructionContext.NestedService.pipe(
            Effect.flatMap((service) => service.load(completedReadHistory(read))),
            Effect.provide(layer),
          )
          const initialized = yield* SystemContext.initialize(yield* load)
          expect(initialized.baseline).toBe(`Instructions from: ${instruction}\ninitial`)

          unreadable = true
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({ _tag: "Unchanged" })

          unreadable = false
          yield* Effect.promise(() => fs.rm(instruction))
          expect(yield* SystemContext.reconcile(yield* load, initialized.snapshot)).toEqual({
            _tag: "Updated",
            text: "Previously discovered nearby instructions no longer apply.",
            snapshot: {},
          })
        }),
      ),
    ),
  )
})
