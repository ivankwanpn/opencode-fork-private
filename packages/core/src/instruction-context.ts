export * as InstructionContext from "./instruction-context"

import { Array, Context, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "path"
import { Config } from "./config"
import { httpClient } from "./effect/app-node-platform"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { SessionMessage } from "./session/message"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { Hash } from "./util/hash"
import { makeLocationNode } from "./effect/app-node"

class File extends Schema.Class<File>("InstructionContext.File")({
  path: AbsolutePath,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = SystemContext.Key.make("core/instructions")
const configuredRegistryKey = SystemContext.Key.make("core/instructions-configured")

class ConfiguredItem extends Schema.Class<ConfiguredItem>("InstructionContext.ConfiguredItem")({
  source: Schema.String,
  content: Schema.String,
}) {}

class ConfiguredValue extends Schema.Class<ConfiguredValue>("InstructionContext.ConfiguredValue")({
  priority: Schema.Number,
  items: Schema.Array(ConfiguredItem),
}) {}

const ConfiguredValueCodec = Schema.toCodecJson(ConfiguredValue)

const configuredKey = (instruction: string, occurrence: number) =>
  SystemContext.Key.make(`core/instructions-configured/${Hash.sha256(instruction).slice(0, 24)}-${occurrence}`)

const configuredSource = (input: {
  readonly key: SystemContext.Key
  readonly instruction: string
  readonly value: ConfiguredValue | SystemContext.Unavailable
}) =>
  SystemContext.make({
    key: input.key,
    codec: ConfiguredValueCodec,
    load: Effect.succeed(input.value),
    baseline: renderConfigured,
    update: (_previous, current) =>
      `These configured instructions supersede the previously loaded value for ${input.instruction}.\n\n${renderConfigured(current)}`,
    removed: () => `Configured instructions from ${input.instruction} no longer apply.`,
  })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service

    const source = (value: ReadonlyArray<File> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Files),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
        removed: () => "Previously loaded instructions no longer apply.",
      })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const claudeEnabled = !Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT
      const globalCandidates = [
        join(global.config, "AGENTS.md"),
        ...(claudeEnabled ? [join(global.home, ".claude", "CLAUDE.md")] : []),
      ]
      let globalPath: string | undefined
      for (const candidate of globalCandidates) {
        if (!(yield* fs.existsSafe(candidate))) continue
        globalPath = yield* fs.resolve(candidate)
        break
      }

      const discovered = new Set<string>()
      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG && insideProject) {
        for (const target of ["AGENTS.md", ...(claudeEnabled ? ["CLAUDE.md"] : []), "CONTEXT.md"]) {
          const matches = yield* fs.up({ targets: [target], start, stop })
          if (matches.length === 0) continue
          for (const match of yield* Effect.forEach(matches, fs.resolve)) discovered.add(match)
          break
        }
      }

      const paths = Array.dedupe([...(globalPath ? [globalPath] : []), ...discovered])
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(
              Effect.map((content) =>
                content === undefined ? undefined : new File({ path: AbsolutePath.make(path), content }),
              ),
            ),
        { concurrency: "unbounded" },
      )
      if (files.some((file) => file === undefined)) return SystemContext.unavailable
      return files.filter((file): file is File => file !== undefined)
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((files) =>
          files === SystemContext.unavailable
            ? source(files)
            : files.length === 0
              ? SystemContext.empty
              : source(files),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

const configuredMatches = Effect.fn("InstructionContext.configuredMatches")(function* (input: {
  readonly fs: FSUtil.Interface
  readonly global: Global.Interface
  readonly location: Location.Interface
  readonly instruction: string
}) {
  const expanded = input.instruction.startsWith("~/")
    ? join(input.global.home, input.instruction.slice(2))
    : input.instruction
  const matches = isAbsolute(expanded)
    ? yield* input.fs.glob(basename(expanded), {
        cwd: dirname(expanded),
        absolute: true,
        include: "file",
        dot: true,
      })
    : yield* Effect.gen(function* () {
        const start = yield* input.fs.resolve(
          Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? input.global.config : input.location.directory,
        )
        const project = yield* input.fs.resolve(
          Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? input.global.config : input.location.project.directory,
        )
        const stop = FSUtil.contains(project, start) ? project : start
        return yield* input.fs.globUp(expanded, start, stop)
      })
  return Array.dedupe(yield* Effect.forEach(matches, input.fs.resolve)).toSorted((left, right) =>
    left.localeCompare(right),
  )
})

const configuredLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const unavailable = (instruction: string, sourceKey: SystemContext.Key) =>
      configuredSource({ key: sourceKey, instruction, value: SystemContext.unavailable })

    const localMatches = (instruction: string) => configuredMatches({ fs, global, location, instruction })

    const observeLocal = (instruction: string, sourceKey: SystemContext.Key, priority: number) =>
      Effect.gen(function* () {
        const paths = yield* localMatches(instruction)
        if (paths.length === 0) return SystemContext.empty
        const files = yield* Effect.forEach(
          paths,
          (path) =>
            fs
              .readFileStringSafe(path)
              .pipe(
                Effect.map((content) =>
                  content === undefined ? undefined : new ConfiguredItem({ source: resolvePath(path), content }),
                ),
              ),
          { concurrency: "unbounded" },
        )
        if (files.some((file) => file === undefined)) return unavailable(instruction, sourceKey)
        return configuredSource({
          key: sourceKey,
          instruction,
          value: new ConfiguredValue({
            priority,
            items: files.filter((file): file is ConfiguredItem => file !== undefined),
          }),
        })
      }).pipe(
        Effect.catch(() => Effect.succeed(unavailable(instruction, sourceKey))),
        Effect.catchDefect(() => Effect.succeed(unavailable(instruction, sourceKey))),
      )

    const observeRemote = (instruction: string, sourceKey: SystemContext.Key, priority: number) =>
      HttpClientRequest.get(instruction).pipe(
        http.execute,
        Effect.flatMap((response) => response.text),
        Effect.timeout("5 seconds"),
        Effect.map((content) =>
          content.length === 0
            ? SystemContext.empty
            : configuredSource({
                key: sourceKey,
                instruction,
                value: new ConfiguredValue({
                  priority,
                  items: [new ConfiguredItem({ source: instruction, content })],
                }),
              }),
        ),
        Effect.catch(() => Effect.succeed(unavailable(instruction, sourceKey))),
        Effect.catchDefect(() => Effect.succeed(unavailable(instruction, sourceKey))),
      )

    yield* registry.register({
      key: configuredRegistryKey,
      load: Effect.gen(function* () {
        const instructions = Config.latest(yield* config.entries(), "instructions") ?? []
        const occurrences = new Map<string, number>()
        const sources = yield* Effect.forEach(
          instructions,
          (instruction, priority) => {
            const occurrence = occurrences.get(instruction) ?? 0
            occurrences.set(instruction, occurrence + 1)
            const sourceKey = configuredKey(instruction, occurrence)
            return instruction.startsWith("https://") || instruction.startsWith("http://")
              ? observeRemote(instruction, sourceKey, priority)
              : observeLocal(instruction, sourceKey, priority)
          },
          { concurrency: "unbounded" },
        )
        return SystemContext.combine(sources)
      }),
    })
  }),
)

const nestedKey = SystemContext.Key.make("core/instructions-nested")

export interface NestedInterface {
  readonly load: (messages: ReadonlyArray<SessionMessage.Message>) => Effect.Effect<SystemContext.SystemContext>
}

export class NestedService extends Context.Service<NestedService, NestedInterface>()(
  "@opencode/v2/NestedInstructionContext",
) {}

const nestedSource = (value: ReadonlyArray<File> | SystemContext.Unavailable) =>
  SystemContext.make({
    key: nestedKey,
    codec: Schema.toCodecJson(Files),
    load: Effect.succeed(value),
    baseline: render,
    update: (_previous, current) =>
      `These nearby instructions supersede the previously discovered nested instructions.\n\n${render(current)}`,
    removed: () => "Previously discovered nearby instructions no longer apply.",
  })

const loadedReadPaths = (messages: ReadonlyArray<SessionMessage.Message>) => {
  const paths: string[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "read" || part.state.status !== "completed") continue
      const loaded = part.state.structured.loaded
      if (!globalThis.Array.isArray(loaded)) continue
      for (const path of loaded) if (typeof path === "string") paths.push(path)
    }
  }
  return Array.dedupe(paths)
}

const nestedLayer = Layer.effect(
  NestedService,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service

    const observe = Effect.fn("InstructionContext.observeNested")(function* (
      messages: ReadonlyArray<SessionMessage.Message>,
    ) {
      const loaded = loadedReadPaths(messages)
      if (loaded.length === 0) return SystemContext.empty
      const configured = new Set<string>()
      for (const instruction of Config.latest(yield* config.entries(), "instructions") ?? []) {
        if (instruction.startsWith("https://") || instruction.startsWith("http://")) continue
        for (const path of yield* configuredMatches({ fs, global, location, instruction })) configured.add(path)
      }

      const root = yield* fs.resolve(location.directory)
      const discovered = new Set<string>()
      const targets = ["AGENTS.md", ...(!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? ["CLAUDE.md"] : []), "CONTEXT.md"]
      for (const loadedPath of loaded) {
        const target = yield* fs.resolve(loadedPath)
        if (!FSUtil.contains(root, target)) continue
        let current = dirname(target)
        while (current !== root && FSUtil.contains(root, current)) {
          let found: string | undefined
          for (const instruction of targets) {
            const candidate = join(current, instruction)
            if (!(yield* fs.existsSafe(candidate))) continue
            found = yield* fs.resolve(candidate)
            break
          }
          if (found && found !== target && !configured.has(found)) discovered.add(found)
          const parent = dirname(current)
          if (parent === current) break
          current = parent
        }
      }
      if (discovered.size === 0) return SystemContext.empty
      const files = yield* Effect.forEach(
        discovered,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(
              Effect.map((content) =>
                content === undefined ? undefined : new File({ path: AbsolutePath.make(path), content }),
              ),
            ),
        { concurrency: "unbounded" },
      )
      if (files.some((file) => file === undefined)) return nestedSource(SystemContext.unavailable)
      return nestedSource(files.filter((file): file is File => file !== undefined))
    })

    return NestedService.of({
      load: (messages) =>
        observe(messages).pipe(
          Effect.catch(() => Effect.succeed(nestedSource(SystemContext.unavailable))),
          Effect.catchDefect(() => Effect.succeed(nestedSource(SystemContext.unavailable))),
        ),
    })
  }),
)

export const nestedNode = makeLocationNode({
  service: NestedService,
  layer: nestedLayer,
  deps: [Config.node, FSUtil.node, Global.node, Location.node],
})

export const configuredNode = makeLocationNode({
  name: "instruction-context/configured",
  layer: configuredLayer,
  deps: [Config.node, FSUtil.node, Global.node, Location.node, SystemContextRegistry.node, httpClient],
})

export const node = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [FSUtil.node, Global.node, Location.node, SystemContextRegistry.node],
})

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}

function renderConfigured(value: ConfiguredValue) {
  return value.items.map((item) => `Instructions from: ${item.source}\n${item.content}`).join("\n\n")
}
