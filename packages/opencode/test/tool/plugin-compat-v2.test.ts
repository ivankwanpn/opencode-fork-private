import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import type { Hooks, ToolContext } from "@opencode-ai/plugin"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolProgress } from "@opencode-ai/core/tool/progress"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Tools } from "@opencode-ai/core/tool/tools"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Cause, Effect, Exit, Fiber, Layer, LayerMap, Schema, Scope } from "effect"
import { Config } from "@/config/config"
import { WorkspaceRef } from "@/effect/instance-ref"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { InstanceStore } from "@/project/instance-store"
import { MessageID, SessionID } from "@/session/schema"
import { PluginToolCompat } from "@/tool/plugin-compat"
import { PluginToolCompatV2 } from "@/tool/plugin-compat-v2"
import { TestConfig } from "../fixture/config"
import { TestInstance } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const sessionID = SessionSchema.ID.make("ses_plugin_compat")
const assistantMessageID = SessionMessage.ID.make("msg_plugin_compat")
const agentID = AgentV2.ID.make("build")
const projectID = ProjectV2.ID.make("project_plugin_compat")

type ProgressRecord = {
  readonly context: Tool.Context
  readonly update: ToolProgress.Update
}

type BoundRecord = Parameters<ToolOutputStore.Interface["bound"]>[0]

type HarnessOptions = {
  readonly hooks?: ReadonlyArray<Hooks>
  readonly permissions?: PermissionV2.Ruleset
  readonly progress?: ProgressRecord[]
  readonly progressPublish?: ToolProgress.Interface["publish"]
  readonly bounds?: BoundRecord[]
  readonly saved?: PermissionSaved.AddInput[]
}

const legacyRegistryModule = await import("@/tool/registry")

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((directory) => [path.join(directory, ".opencode")])),
})

function pluginLayer(hooks: ReadonlyArray<Hooks>) {
  return Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      trigger: ((_name: unknown, _input: unknown, output: unknown) =>
        Effect.succeed(output)) as Plugin.Interface["trigger"],
      list: () => Effect.succeed([...hooks]),
    }),
  )
}

function progressLayer(records: ProgressRecord[], publish?: ToolProgress.Interface["publish"]) {
  return Layer.succeed(
    ToolProgress.Service,
    ToolProgress.Service.of({
      publish:
        publish ??
        ((context, update) =>
          Effect.sync(() => {
            records.push({ context, update })
          })),
    }),
  )
}

function focusedLocationLayer(
  ref: Location.Ref,
  saved: PermissionSaved.AddInput[],
  permissions: PermissionV2.Ruleset,
  bounds: BoundRecord[],
): Layer.Layer<LocationServices> {
  const agent = AgentV2.Info.make({ ...AgentV2.Info.empty(agentID), permissions })
  const layer = AppNodeBuilder.build(
    LayerNode.group([Location.node, ToolRegistry.node, ToolRegistry.toolsNode, PermissionV2.node, PluginRuntime.node]),
    [
      [
        Location.node,
        Layer.succeed(
          Location.Service,
          Location.Service.of({
            directory: ref.directory,
            workspaceID: ref.workspaceID,
            project: { id: projectID, directory: ref.directory },
          }),
        ),
      ],
      [
        AgentV2.node,
        Layer.mock(AgentV2.Service, {
          resolve: () => Effect.succeed(agent),
        }),
      ],
      [
        SessionStore.node,
        Layer.mock(SessionStore.Service, {
          get: () => Effect.succeed({ agent: agentID } as SessionSchema.Info),
          latestPrompt: () => Effect.succeed(undefined),
        }),
      ],
      [
        PermissionSaved.node,
        Layer.mock(PermissionSaved.Service, {
          list: () => Effect.succeed([]),
          add: (input) =>
            Effect.sync(() => {
              saved.push(input)
            }),
        }),
      ],
      [
        EventV2.node,
        Layer.mock(EventV2.Service, {
          publish: () => Effect.succeed(undefined as never),
        }),
      ],
      [
        ToolOutputStore.node,
        Layer.mock(ToolOutputStore.Service, {
          bound: (input) =>
            Effect.sync(() => {
              bounds.push(input)
              return { output: input.output, outputPaths: [] }
            }),
        }),
      ],
    ],
  )

  // LocationServiceMap is intentionally fixed to the complete LocationServices
  // graph. This focused harness exposes only the real services used by the
  // adapter; the complete graph would also start unrelated watcher, MCP,
  // plugin-host, and session services. Keep the unavoidable cast at this seam.
  return layer as unknown as Layer.Layer<LocationServices>
}

function locationServiceMapLayer(
  saved: PermissionSaved.AddInput[],
  permissions: PermissionV2.Ruleset,
  bounds: BoundRecord[],
) {
  return Layer.effect(
    LocationServiceMap.Service,
    LayerMap.make((ref: Location.Ref) => focusedLocationLayer(ref, saved, permissions, bounds).pipe(Layer.fresh), {
      idleTimeToLive: "1 minute",
    }),
  )
}

function harness(options: HarnessOptions = {}) {
  const progress = options.progress ?? []
  const saved = options.saved ?? []
  return testEffect(
    LayerNode.compile(LayerNode.group([PluginToolCompat.node, PluginToolCompatV2.node, LocationServiceMap.node]), [
      [Config.node, configLayer],
      [Plugin.node, pluginLayer(options.hooks ?? [])],
      [LocationServiceMap.node, locationServiceMapLayer(saved, options.permissions ?? [], options.bounds ?? [])],
      [ToolProgress.node, progressLayer(progress, options.progressPublish)],
    ]),
  )
}

function parityHarness() {
  return testEffect(
    LayerNode.compile(
      LayerNode.group([
        legacyRegistryModule.ToolRegistry.node,
        PluginToolCompat.node,
        PluginToolCompatV2.node,
        LocationServiceMap.node,
      ]),
      [
        [Config.node, configLayer],
        [Plugin.node, pluginLayer([])],
        [RuntimeFlags.node, RuntimeFlags.layer()],
        [LocationServiceMap.node, locationServiceMapLayer([], [], [])],
        [ToolProgress.node, progressLayer([])],
      ],
    ),
  )
}

function locationRef(directory: string, workspaceID?: WorkspaceV2.ID) {
  return Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID })
}

function withLocation<A, E, R>(directory: string, effect: Effect.Effect<A, E, R>, workspaceID?: WorkspaceV2.ID) {
  return effect.pipe(Effect.provide(LocationServiceMap.Service.get(locationRef(directory, workspaceID))))
}

function initialize(workspaceID?: WorkspaceV2.ID) {
  return PluginToolCompatV2.Service.use((compatibility) => compatibility.init()).pipe(
    Effect.provideService(WorkspaceRef, workspaceID),
  )
}

function call(name: string, input: unknown = {}, id = `call-${name}`): ToolRegistry.ExecuteInput {
  return {
    sessionID,
    agent: agentID,
    assistantMessageID,
    call: { type: "tool-call", id, name, input },
  }
}

function settle(registry: ToolRegistry.Interface, name: string, input: unknown = {}, id?: string) {
  return registry.materialize().pipe(Effect.flatMap((materialized) => materialized.settle(call(name, input, id))))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function localJsonReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localJsonReferences)
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) =>
    key === "$ref" && typeof item === "string" && item.startsWith("#/") ? [item] : localJsonReferences(item),
  )
}

function resolveLocalJsonReference(document: unknown, reference: string): unknown {
  let current = document
  for (const token of reference.slice(2).split("/")) {
    if (!isRecord(current)) return undefined
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~")
    if (!Object.hasOwn(current, key)) return undefined
    current = current[key]
  }
  return current
}

function writeTool(directory: string, folder: "tool" | "tools", filename: string, source: string) {
  return Effect.promise(async () => {
    const target = path.join(directory, ".opencode", folder)
    await fs.mkdir(target, { recursive: true })
    await Bun.write(path.join(target, filename), source)
  })
}

const parity = parityHarness()
const discovery = harness()

const precedenceHooks: Hooks[] = [
  {
    tool: {
      override: {
        description: "first plugin",
        args: {},
        execute: async () => "first plugin",
      },
      plugin_only: {
        description: "plugin hook tool",
        args: {},
        execute: async () => "plugin only",
      },
    },
  },
  {
    tool: {
      override: {
        description: "second plugin",
        args: {},
        execute: async () => "second plugin",
      },
    },
  },
]
const precedence = harness({ hooks: precedenceHooks })

let invocationContext: (ToolContext & { readonly callID: string }) | undefined
const context = harness({
  hooks: [
    {
      tool: {
        context_probe: {
          description: "capture invocation context",
          args: {},
          execute: async (_input, value) => {
            invocationContext = value as ToolContext & { readonly callID: string }
            return "captured"
          },
        },
      },
    },
  ],
})

const savedPermissions: PermissionSaved.AddInput[] = []
const permissionHooks: Hooks[] = [
  {
    tool: {
      protected_action: {
        description: "request permission",
        args: {},
        execute: async (_input, context) => {
          await context.ask({
            permission: "deploy",
            patterns: ["production"],
            always: ["production/**"],
            metadata: { reason: "release" },
          })
          return "allowed"
        },
      },
    },
  },
]
const permission = harness({
  saved: savedPermissions,
  hooks: permissionHooks,
})
const deniedPermission = harness({
  hooks: permissionHooks,
  permissions: [
    {
      action: "deploy",
      resource: "*",
      effect: "deny",
    },
  ],
})

let interruptedSignal: AbortSignal | undefined
let releaseInterruption: (() => void) | undefined
let interruptionCleaned = false
const interruption = harness({
  hooks: [
    {
      tool: {
        interruptible: {
          description: "wait for interruption",
          args: {},
          execute: (_input, context) =>
            new Promise<string>((resolve) => {
              interruptedSignal = context.abort
              context.abort.addEventListener(
                "abort",
                () => {
                  releaseInterruption = () => resolve("aborted")
                },
                { once: true },
              )
            }).finally(() => {
              interruptionCleaned = true
            }),
        },
      },
    },
  ],
})

const progressRecords: ProgressRecord[] = []
const progress = harness({
  progress: progressRecords,
  hooks: [
    {
      tool: {
        reporting: {
          description: "report native progress",
          args: {},
          execute: async (_input, context) => {
            context.metadata({ title: "Preparing", metadata: { phase: 1 } })
            context.metadata({ title: "Working", metadata: { phase: 2 } })
            context.metadata({ title: "Boundary", metadata: { phase: 3 } })
            return "complete"
          },
        },
      },
    },
  ],
})

const progressFailureRecords: ProgressRecord[] = []
const progressFailure = harness({
  progressPublish: (context, update) =>
    Effect.sync(() => {
      progressFailureRecords.push({ context, update })
    }).pipe(
      Effect.andThen(
        update.structured.title === "First" ? Effect.die(new Error("progress publication failed")) : Effect.void,
      ),
    ),
  hooks: [
    {
      tool: {
        detached_progress: {
          description: "exercise detached progress behavior",
          args: {},
          execute: async (_input, context) => {
            context.metadata({ title: "First", metadata: { order: 1 } })
            context.metadata({ title: "Second", metadata: { order: 2 } })
            context.metadata({ title: "Boundary", metadata: { order: 3 } })
            return "complete"
          },
        },
      },
    },
  ],
})

const completeOutput = "complete plugin output\n".repeat(10_000)
const resultBounds: BoundRecord[] = []
const results = harness({
  bounds: resultBounds,
  hooks: [
    {
      tool: {
        plain_result: {
          description: "return a string",
          args: {},
          execute: async () => "plain text",
        },
        rich_result: {
          description: "return structured output",
          args: {},
          execute: async () => ({
            output: "structured text",
            title: "Structured title",
            metadata: { status: "ready", count: 2 },
            attachments: [
              {
                type: "file",
                mime: "image/png",
                filename: "chart.png",
                url: "https://example.test/chart.png",
              },
              {
                type: "file",
                mime: "application/pdf",
                url: "file:///tmp/plugin-report.pdf",
              },
            ],
          }),
        },
        complete_result: {
          description: "return complete output for Core bounding",
          args: {},
          execute: async () => completeOutput,
        },
      },
    },
  ],
})

const failures = harness({
  hooks: [
    {
      tool: {
        rejected_result: {
          description: "reject execution",
          args: {},
          execute: async () => {
            throw new Error("plugin rejected")
          },
        },
        malformed_result: {
          description: "return malformed output",
          args: {},
          execute: async () => ({ invalid: true }) as unknown as string,
        },
        invalid_attachment: {
          description: "return an invalid attachment",
          args: {},
          execute: async () =>
            ({
              output: "invalid attachment",
              attachments: [{ type: "file", mime: 42, url: "file:///tmp/invalid" }],
            }) as unknown as string,
        },
      },
    },
  ],
})

const lifecycle = harness({
  hooks: [
    {
      tool: {
        layered: {
          description: "compatibility registration",
          args: {},
          execute: async () => "compatibility",
        },
      },
    },
  ],
})

const hooks = harness({
  hooks: [
    {
      tool: {
        hooked: {
          description: "exercise core hooks",
          args: {},
          execute: async () => "once",
        },
      },
    },
  ],
})

describe("plugin tool compatibility v2", () => {
  parity.instance("materializes and executes aligned V1/V2 config tools from singular and plural directories", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tools",
        "plural.ts",
        [
          "export default { description: 'plural default', args: {}, execute: async () => 'default' }",
          "export const named = { description: 'plural named', args: {}, execute: async () => 'named' }",
          "",
        ].join("\n"),
      )
      yield* writeTool(
        test.directory,
        "tool",
        "singular.ts",
        [
          "export default { description: 'singular default', args: {}, execute: async () => 'default' }",
          "export const named = { description: 'singular named', args: {}, execute: async () => 'named' }",
          "",
        ].join("\n"),
      )

      const legacyRegistry = yield* legacyRegistryModule.ToolRegistry.Service
      const legacyTools = yield* legacyRegistry.all()
      yield* initialize()

      const materialized = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
      )
      const names = ["plural", "plural_named", "singular", "singular_named"]
      expect(
        legacyTools
          .filter((item) => names.includes(item.id))
          .map((item) => item.id)
          .toSorted(),
      ).toEqual(names)
      expect(
        materialized.definitions
          .filter((item) => names.includes(item.name))
          .map((item) => item.name)
          .toSorted(),
      ).toEqual(names)

      for (const name of names) {
        const legacy = legacyTools.find((item) => item.id === name)
        const definition = materialized.definitions.find((item) => item.name === name)
        expect(definition?.description).toBe(legacy?.description)
        expect(definition?.inputSchema as unknown).toEqual(legacy?.jsonSchema)
      }

      const legacyPlural = legacyTools.find((item) => item.id === "plural")
      if (!legacyPlural) throw new Error("V1 plural tool was not materialized")
      expect(
        yield* legacyPlural.execute(
          {},
          {
            sessionID: SessionID.make("ses_plugin_compat_v1"),
            messageID: MessageID.make("msg_plugin_compat_v1"),
            callID: "call-plugin-compat-v1",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        ),
      ).toMatchObject({ output: "default" })
      expect((yield* materialized.settle(call("plural"))).result).toEqual({ type: "text", value: "default" })
    }),
  )

  discovery.instance("normalizes missing and null args to an empty object schema", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tools",
        "noargs.ts",
        [
          "export default { description: 'undefined args', args: undefined, execute: async () => 'undefined' }",
          "export const nullable = { description: 'null args', args: null, execute: async () => 'null' }",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          for (const name of ["noargs", "noargs_nullable"]) {
            expect(materialized.definitions.find((item) => item.name === name)?.inputSchema).toMatchObject({
              type: "object",
              properties: {},
            })
            expect((yield* materialized.settle(call(name))).result).toMatchObject({ type: "text" })
          }
        }),
      )
    }),
  )

  discovery.instance("decodes Zod transforms, coercions, and defaults and preserves issue diagnostics", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const toolModule = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* writeTool(
        test.directory,
        "tools",
        "query.ts",
        [
          `import { tool } from ${JSON.stringify(toolModule)}`,
          "export default tool({",
          "  description: 'query a database',",
          "  args: {",
          "    query: tool.schema.string().trim().toUpperCase().describe('SQL statement'),",
          "    limit: tool.schema.coerce.number().int().default(5),",
          "  },",
          "  execute: async ({ query, limit }) => JSON.stringify({ query, limit }),",
          "})",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect(materialized.definitions.find((item) => item.name === "query")?.inputSchema).toMatchObject({
            type: "object",
            properties: {
              query: { type: "string", description: "SQL statement" },
            },
            required: ["query"],
          })
          const invalid = yield* materialized.settle(call("query", { query: 42, limit: 1 }))
          expect(invalid.result.type).toBe("error")
          if (invalid.result.type !== "error") throw new Error("expected invalid tool input")
          expect(invalid.result.value).toContain("Invalid tool input")
          expect(invalid.result.value).toContain("query")
          expect((yield* materialized.settle(call("query", { query: " select 1 ", limit: "7" }))).result).toEqual({
            type: "text",
            value: JSON.stringify({ query: "SELECT 1", limit: 7 }),
          })
          expect((yield* materialized.settle(call("query", { query: " select 2 " }))).result).toEqual({
            type: "text",
            value: JSON.stringify({ query: "SELECT 2", limit: 5 }),
          })
        }),
      )
    }),
  )

  discovery.instance("advertises resolvable Draft-7 references and executes nested mixed input", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const toolModule = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* writeTool(
        test.directory,
        "tools",
        "recursive.js",
        [
          `import { tool } from ${JSON.stringify(toolModule)}`,
          "const Node = tool.schema.lazy(() => tool.schema.object({",
          "  name: tool.schema.string(),",
          "  children: tool.schema.array(Node).optional(),",
          "}))",
          "export default {",
          "  description: 'walk a recursive tree',",
          "  args: {",
          "    root: Node,",
          "    depth: { type: 'integer', minimum: 1 },",
          "  },",
          "  execute: async ({ root, depth }) => JSON.stringify({ root, depth }),",
          "}",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          const inputSchema = materialized.definitions.find((item) => item.name === "recursive")?.inputSchema
          if (!isRecord(inputSchema)) throw new Error("recursive input schema was not advertised")
          const definitions = inputSchema.definitions
          expect(isRecord(definitions) ? Object.keys(definitions).length : 0).toBeGreaterThan(0)
          const references = localJsonReferences(inputSchema)
          expect(references.length).toBeGreaterThan(0)
          for (const reference of references) {
            expect(resolveLocalJsonReference(inputSchema, reference)).toBeDefined()
          }

          const root = {
            name: "root",
            children: [{ name: "leaf" }],
          }
          expect((yield* materialized.settle(call("recursive", { root, depth: 2 }))).result).toEqual({
            type: "text",
            value: JSON.stringify({ root, depth: 2 }),
          })
        }),
      )
    }),
  )

  discovery.instance("enforces legal Draft-7 conditional keywords for legacy fields", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tools",
        "conditional.ts",
        [
          "export default {",
          "  description: 'conditional legacy schema',",
          "  args: {",
          "    payload: {",
          "      type: 'object',",
          "      properties: {",
          "        kind: { enum: ['short', 'long'] },",
          "        value: { type: 'string' },",
          "      },",
          "      required: ['kind', 'value'],",
          "      if: { properties: { kind: { const: 'long' } } },",
          "      then: { properties: { value: { minLength: 5 } } },",
          "      else: { properties: { value: { maxLength: 3 } } },",
          "    },",
          "  },",
          "  execute: async ({ payload }) => payload.value,",
          "}",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect(
            (yield* materialized.settle(call("conditional", { payload: { kind: "long", value: "no" } }))).result,
          ).toMatchObject({
            type: "error",
            value: expect.stringContaining("payload/value"),
          })
          expect(
            (yield* materialized.settle(call("conditional", { payload: { kind: "long", value: "ready" } }))).result,
          ).toEqual({
            type: "text",
            value: "ready",
          })
        }),
      )
    }),
  )

  discovery.instance("isolates equal JSON Schema identifiers across contributions", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tools",
        "schemaid.ts",
        [
          "export const first = {",
          "  description: 'first schema identifier owner',",
          "  args: { value: { $id: 'urn:opencode:plugin-value', type: 'string', pattern: '^A' } },",
          "  execute: async ({ value }) => value,",
          "}",
          "export const second = {",
          "  description: 'second schema identifier owner',",
          "  args: { value: { $id: 'urn:opencode:plugin-value', type: 'string', pattern: '^B' } },",
          "  execute: async ({ value }) => value,",
          "}",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect((yield* materialized.settle(call("schemaid_first", { value: "Alpha" }))).result).toEqual({
            type: "text",
            value: "Alpha",
          })
          expect((yield* materialized.settle(call("schemaid_second", { value: "Beta" }))).result).toEqual({
            type: "text",
            value: "Beta",
          })
          expect((yield* materialized.settle(call("schemaid_first", { value: "Beta" }))).result).toMatchObject({
            type: "error",
            value: expect.stringContaining("value"),
          })
          expect((yield* materialized.settle(call("schemaid_second", { value: "Alpha" }))).result).toMatchObject({
            type: "error",
            value: expect.stringContaining("value"),
          })
        }),
      )
    }),
  )

  discovery.instance("retains legacy JSON-schema-shaped args as the wire schema", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tools",
        "legacy.ts",
        [
          "export default {",
          "  description: 'legacy schema',",
          "  args: { text: { type: 'string', minLength: 3, description: 'Text to render' } },",
          "  execute: async ({ text }) => text,",
          "}",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect(materialized.definitions.find((item) => item.name === "legacy")?.inputSchema).toEqual({
            type: "object",
            properties: {
              text: { type: "string", minLength: 3, description: "Text to render" },
            },
            required: ["text"],
          })
          expect((yield* materialized.settle(call("legacy", {}))).result).toMatchObject({
            type: "error",
            value: expect.stringContaining("Invalid tool input"),
          })
          expect((yield* materialized.settle(call("legacy", { text: "no" }))).result).toMatchObject({
            type: "error",
            value: expect.stringContaining("Invalid tool input"),
          })
          expect((yield* materialized.settle(call("legacy", { text: "rendered" }))).result).toEqual({
            type: "text",
            value: "rendered",
          })
        }),
      )
    }),
  )

  discovery.instance("compiles mixed Zod and legacy argument maps without advertising raw Zod objects", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const toolModule = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* writeTool(
        test.directory,
        "tools",
        "mixed.ts",
        [
          `import { tool } from ${JSON.stringify(toolModule)}`,
          "export default {",
          "  description: 'mixed schema',",
          "  args: {",
          "    query: tool.schema.string().trim().toUpperCase().describe('SQL statement'),",
          "    category: tool.schema.string().default('general'),",
          "    note: tool.schema.string().trim().optional(),",
          "    count: tool.schema.coerce.number().int(),",
          "    size: tool.schema.string().transform((value) => value.length),",
          "    limit: { type: 'integer', minimum: 1 },",
          "  },",
          "  execute: async ({ query, category, note, count, size, limit }) =>",
          "    JSON.stringify({ query, category, note, count, size, limit }),",
          "}",
          "",
        ].join("\n"),
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          const inputSchema = materialized.definitions.find((item) => item.name === "mixed")?.inputSchema
          expect(inputSchema).toMatchObject({
            type: "object",
            properties: {
              query: { type: "string", description: "SQL statement" },
              category: { type: "string", default: "general" },
              note: { type: "string" },
              count: { type: "integer" },
              size: { type: "string" },
              limit: { type: "integer", minimum: 1 },
            },
            required: ["query", "count", "size", "limit"],
            additionalProperties: false,
          })
          expect(JSON.stringify(inputSchema)).not.toContain('"_zod"')
          expect(
            (yield* materialized.settle(
              call("mixed", {
                query: " select 1 ",
                note: " memo ",
                count: "7",
                size: "four",
                limit: 2,
              }),
            )).result,
          ).toEqual({
            type: "text",
            value: JSON.stringify({
              query: "SELECT 1",
              category: "general",
              note: "memo",
              count: 7,
              size: 4,
              limit: 2,
            }),
          })
          expect(
            (yield* materialized.settle(call("mixed", { query: " select 2 ", count: "8", size: "ok", limit: 3 })))
              .result,
          ).toEqual({
            type: "text",
            value: JSON.stringify({ query: "SELECT 2", category: "general", count: 8, size: 2, limit: 3 }),
          })
          const invalidZod = yield* materialized.settle(call("mixed", { query: 42, count: "7", size: "bad", limit: 2 }))
          expect(invalidZod.result.type).toBe("error")
          if (invalidZod.result.type !== "error") throw new Error("expected invalid tool input")
          expect(invalidZod.result.value).toContain("Invalid tool input")
          expect(invalidZod.result.value).toContain("query")
          expect(
            (yield* materialized.settle(call("mixed", { query: "select 3", count: "7", size: "bad", limit: 0 })))
              .result,
          ).toMatchObject({
            type: "error",
            value: expect.stringContaining("limit"),
          })
          expect(
            (yield* materialized.settle(call("mixed", { query: "select 4", count: "7", size: "bad", limit: "raw" })))
              .result,
          ).toMatchObject({
            type: "error",
            value: expect.stringContaining("limit"),
          })
          expect(
            (yield* materialized.settle(call("mixed", { query: "select 5", count: "7", size: "bad" }))).result,
          ).toMatchObject({
            type: "error",
            value: expect.stringContaining("limit"),
          })
          expect(
            (yield* materialized.settle(
              call("mixed", {
                query: "select 6",
                count: "7",
                size: "bad",
                limit: 2,
                unexpected: true,
              }),
            )).result,
          ).toMatchObject({
            type: "error",
            value: expect.stringContaining("additional properties"),
          })
        }),
      )
    }),
  )

  discovery.instance("orders colliding config files deterministically within a discovery directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tool",
        "collision.ts",
        "export default { description: 'singular config', args: {}, execute: async () => 'singular' }\n",
      )
      yield* writeTool(
        test.directory,
        "tools",
        "collision.ts",
        "export default { description: 'plural config', args: {}, execute: async () => 'plural' }\n",
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect(materialized.definitions.filter((item) => item.name === "collision")).toHaveLength(1)
          expect(materialized.definitions.find((item) => item.name === "collision")?.description).toBe("plural config")
          expect((yield* materialized.settle(call("collision"))).result).toEqual({
            type: "text",
            value: "plural",
          })
        }),
      )
    }),
  )

  precedence.instance("loads plugin hook tools and applies deterministic later-wins precedence", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* writeTool(
        test.directory,
        "tools",
        "override.ts",
        "export default { description: 'config', args: {}, execute: async () => 'config' }\n",
      )
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect(materialized.definitions.find((item) => item.name === "plugin_only")?.description).toBe(
            "plugin hook tool",
          )
          expect(materialized.definitions.filter((item) => item.name === "override")).toHaveLength(1)
          expect(materialized.definitions.find((item) => item.name === "override")?.description).toBe("second plugin")
          expect((yield* materialized.settle(call("override"))).result).toEqual({
            type: "text",
            value: "second plugin",
          })
        }),
      )
    }),
  )

  context.instance("passes the complete invocation identity and instance paths to the plugin callback", () =>
    Effect.gen(function* () {
      invocationContext = undefined
      const test = yield* TestInstance
      const instance = yield* InstanceState.context
      yield* initialize()
      yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => settle(registry, "context_probe", {}, "call-context")),
      )

      expect(invocationContext).toMatchObject({
        sessionID,
        messageID: assistantMessageID,
        callID: "call-context",
        agent: agentID,
        directory: test.directory,
        worktree: instance.worktree,
      })
      const capturedContext = () => invocationContext
      expect(capturedContext()?.abort).toBeInstanceOf(AbortSignal)
    }),
  )

  permission.instance("bridges permission requests, replies, and saved resources through PermissionV2", () =>
    Effect.gen(function* () {
      savedPermissions.length = 0
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const permissions = yield* PermissionV2.Service
          const fiber = yield* settle(registry, "protected_action", {}, "call-permission").pipe(Effect.forkScoped)
          const request = yield* pollWithTimeout(
            permissions.list().pipe(Effect.map((pending) => pending[0])),
            "permission request did not become pending",
          )

          expect(request).toMatchObject({
            sessionID,
            action: "deploy",
            resources: ["production"],
            save: ["production/**"],
            metadata: { reason: "release" },
            source: {
              type: "tool",
              messageID: assistantMessageID,
              callID: "call-permission",
            },
          })
          yield* permissions.reply({ requestID: request.id, reply: "always" })
          expect((yield* Fiber.join(fiber)).result).toEqual({ type: "text", value: "allowed" })
          expect(savedPermissions).toEqual([
            {
              projectID,
              action: "deploy",
              resources: ["production/**"],
            },
          ])
        }),
      )
    }),
  )

  deniedPermission.instance("settles policy-blocked permission failures as model-visible ToolFailure output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* initialize()

      const result = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => settle(registry, "protected_action", {}, "call-permission-blocked")),
      )

      expect(result.result).toEqual({
        type: "error",
        value: "Permission denied: deploy",
      })
    }),
  )

  permission.instance("settles corrected permission replies with canonical feedback", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const permissions = yield* PermissionV2.Service
          const fiber = yield* settle(registry, "protected_action", {}, "call-permission-corrected").pipe(
            Effect.forkScoped,
          )
          const request = yield* pollWithTimeout(
            permissions.list().pipe(Effect.map((pending) => pending[0])),
            "corrected permission request did not become pending",
          )

          yield* permissions.reply({
            requestID: request.id,
            reply: "reject",
            message: "Use another tool",
          })
          expect((yield* Fiber.join(fiber)).result).toEqual({
            type: "error",
            value: "Use another tool",
          })
        }),
      )
    }),
  )

  permission.instance("preserves a declined permission reply as the canonical PermissionV2 defect", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const permissions = yield* PermissionV2.Service
          const fiber = yield* settle(registry, "protected_action", {}, "call-permission-declined").pipe(
            Effect.forkScoped,
          )
          const request = yield* pollWithTimeout(
            permissions.list().pipe(Effect.map((pending) => pending[0])),
            "declined permission request did not become pending",
          )

          yield* permissions.reply({ requestID: request.id, reply: "reject" })
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            const defect = exit.cause.reasons.find(Cause.isDieReason)?.defect
            expect(defect).toBeInstanceOf(PermissionV2.DeclinedError)
          }
        }),
      )
    }),
  )

  permission.instance("interrupts the canonical pending permission when settlement is interrupted", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const permissions = yield* PermissionV2.Service
          const fiber = yield* settle(registry, "protected_action", {}, "call-permission-interrupted").pipe(
            Effect.forkScoped,
          )
          yield* pollWithTimeout(
            permissions.list().pipe(Effect.map((pending) => pending[0])),
            "interrupted permission request did not become pending",
          )

          yield* Fiber.interrupt(fiber)
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
          yield* pollWithTimeout(
            permissions.list().pipe(Effect.map((pending) => (pending.length === 0 ? true : undefined))),
            "interrupted permission request remained pending",
          )
        }),
      )
    }),
  )

  interruption.instance("waits for plugin cleanup when Core settlement is interrupted", () =>
    Effect.gen(function* () {
      interruptedSignal = undefined
      releaseInterruption = undefined
      interruptionCleaned = false
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const fiber = yield* settle(registry, "interruptible").pipe(Effect.forkScoped)
          const signal = yield* pollWithTimeout(
            Effect.sync(() => interruptedSignal),
            "plugin invocation did not expose its AbortSignal",
          )
          const interruptFiber = yield* Fiber.interrupt(fiber).pipe(Effect.forkScoped)
          const release = yield* pollWithTimeout(
            Effect.sync(() => (signal.aborted ? releaseInterruption : undefined)),
            "plugin invocation did not observe interruption",
          )

          expect(signal.aborted).toBe(true)
          expect(interruptFiber.pollUnsafe()).toBeUndefined()
          expect(interruptionCleaned).toBe(false)
          release()
          yield* Fiber.join(interruptFiber)
          expect(interruptionCleaned).toBe(true)
          const exit = yield* Fiber.await(fiber)
          expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
        }),
      )
    }),
  )

  progress.instance("publishes plugin metadata through native ToolProgress without a legacy event bridge", () =>
    Effect.gen(function* () {
      progressRecords.length = 0
      const test = yield* TestInstance
      yield* initialize()
      yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => settle(registry, "reporting", {}, "call-progress")),
      )
      yield* pollWithTimeout(
        Effect.sync(() =>
          progressRecords.some((record) => record.update.structured.title === "Boundary") ? true : undefined,
        ),
        "native tool progress publications did not complete",
      )

      expect(progressRecords).toEqual([
        {
          context: {
            sessionID,
            agent: agentID,
            assistantMessageID,
            toolCallID: "call-progress",
          },
          update: {
            structured: { title: "Preparing", phase: 1 },
            content: [],
          },
        },
        {
          context: {
            sessionID,
            agent: agentID,
            assistantMessageID,
            toolCallID: "call-progress",
          },
          update: {
            structured: { title: "Working", phase: 2 },
            content: [],
          },
        },
        {
          context: {
            sessionID,
            agent: agentID,
            assistantMessageID,
            toolCallID: "call-progress",
          },
          update: {
            structured: { title: "Boundary", phase: 3 },
            content: [],
          },
        },
      ])
    }),
  )

  progressFailure.instance("keeps progress failures detached and attempts independent publications", () =>
    Effect.gen(function* () {
      progressFailureRecords.length = 0
      const test = yield* TestInstance
      yield* initialize()
      const settlement = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => settle(registry, "detached_progress", {}, "call-progress-failure")),
      )
      yield* pollWithTimeout(
        Effect.sync(() =>
          progressFailureRecords.some((record) => record.update.structured.title === "Boundary") ? true : undefined,
        ),
        "detached progress publication boundary did not run",
      )

      expect(settlement.result).toEqual({ type: "text", value: "complete" })
      expect(progressFailureRecords.map((record) => record.update.structured.title).toSorted()).toEqual([
        "Boundary",
        "First",
        "Second",
      ])
    }),
  )

  results.instance("settles string and structured results with title, metadata, and URI attachments", () =>
    Effect.gen(function* () {
      resultBounds.length = 0
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          const plain = yield* materialized.settle(call("plain_result"))
          const rich = yield* materialized.settle(call("rich_result"))

          expect(plain).toMatchObject({
            result: { type: "text", value: "plain text" },
            output: {
              structured: {},
              content: [{ type: "text", text: "plain text" }],
            },
          })
          expect(rich).toMatchObject({
            result: {
              type: "content",
              value: [
                { type: "text", text: "structured text" },
                {
                  type: "file",
                  uri: "https://example.test/chart.png",
                  mime: "image/png",
                  name: "chart.png",
                },
                {
                  type: "file",
                  uri: "file:///tmp/plugin-report.pdf",
                  mime: "application/pdf",
                  name: undefined,
                },
              ],
            },
            output: {
              structured: { status: "ready", count: 2, title: "Structured title" },
              content: [
                { type: "text", text: "structured text" },
                {
                  type: "file",
                  uri: "https://example.test/chart.png",
                  mime: "image/png",
                  name: "chart.png",
                },
                {
                  type: "file",
                  uri: "file:///tmp/plugin-report.pdf",
                  mime: "application/pdf",
                  name: undefined,
                },
              ],
            },
          })
          expect(resultBounds.map((record) => record.toolCallID)).toEqual(["call-plain_result", "call-rich_result"])
        }),
      )
    }),
  )

  results.instance("delivers complete plugin output to Core bounding exactly once", () =>
    Effect.gen(function* () {
      resultBounds.length = 0
      const test = yield* TestInstance
      yield* initialize()

      const settlement = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => settle(registry, "complete_result")),
      )

      expect(settlement.result).toEqual({ type: "text", value: completeOutput })
      expect(resultBounds).toHaveLength(1)
      expect(resultBounds[0]).toMatchObject({
        sessionID,
        toolCallID: "call-complete_result",
        output: {
          structured: {},
          content: [{ type: "text", text: completeOutput }],
        },
      })
    }),
  )

  failures.instance("settles rejected and malformed plugin results as model-visible errors", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const rejected = yield* settle(registry, "rejected_result")
          const malformed = yield* settle(registry, "malformed_result")
          const invalidAttachment = yield* settle(registry, "invalid_attachment")

          expect(rejected.result).toEqual({
            type: "error",
            value: expect.stringContaining("plugin rejected"),
          })
          expect(malformed.result).toEqual({
            type: "error",
            value: expect.stringContaining("Plugin tool returned an invalid result"),
          })
          expect(invalidAttachment.result).toEqual({
            type: "error",
            value: expect.stringContaining("Plugin tool attachment is invalid"),
          })
        }),
      )
    }),
  )

  lifecycle.instance("isolates same-directory registrations by workspace and cleans every placement", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* InstanceState.context
      const store = yield* InstanceStore.Service
      const workspaceA = WorkspaceV2.ID.make("wrk_plugin_compat_a")
      const workspaceB = WorkspaceV2.ID.make("wrk_plugin_compat_b")

      yield* initialize(workspaceA)
      yield* initialize(workspaceB)
      const advertisedA = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
        workspaceA,
      )
      const advertisedB = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
        workspaceB,
      )
      expect(advertisedA.definitions.find((item) => item.name === "layered")?.description).toBe(
        "compatibility registration",
      )
      expect(advertisedB.definitions.find((item) => item.name === "layered")?.description).toBe(
        "compatibility registration",
      )

      yield* store.dispose(instance)
      const cleanedA = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
        workspaceA,
      )
      const cleanedB = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
        workspaceB,
      )
      expect(cleanedA.definitions.find((item) => item.name === "layered")).toBeUndefined()
      expect(cleanedB.definitions.find((item) => item.name === "layered")).toBeUndefined()
      expect((yield* advertisedA.settle(call("layered"))).result).toEqual({
        type: "error",
        value: "Stale tool call: layered",
      })
      expect((yield* advertisedB.settle(call("layered"))).result).toEqual({
        type: "error",
        value: "Stale tool call: layered",
      })

      yield* initialize(workspaceB)
      const refreshedB = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
        workspaceB,
      )
      expect(refreshedB.definitions.find((item) => item.name === "layered")?.description).toBe(
        "compatibility registration",
      )
      expect((yield* advertisedB.settle(call("layered"))).result).toEqual({
        type: "error",
        value: "Stale tool call: layered",
      })
      const stillCleanA = yield* withLocation(
        test.directory,
        ToolRegistry.Service.use((registry) => registry.materialize()),
        workspaceA,
      )
      expect(stillCleanA.definitions.find((item) => item.name === "layered")).toBeUndefined()
    }),
  )

  lifecycle.instance("removes the instance registration, reveals the previous tool, and rejects stale identity", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const instance = yield* InstanceState.context
      const store = yield* InstanceStore.Service
      const compatibility = yield* PluginToolCompatV2.Service

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const registry = yield* ToolRegistry.Service
          const tools = yield* Tools.Service
          const previousScope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(previousScope, Exit.void))
          yield* tools
            .register({
              layered: Tool.make({
                description: "previous registration",
                input: Schema.Struct({}),
                output: Schema.String,
                execute: () => Effect.succeed("previous"),
                toModelOutput: ({ output }) => [{ type: "text", text: output }],
              }),
            })
            .pipe(Scope.provide(previousScope))

          yield* compatibility.init()
          const advertised = yield* registry.materialize()
          expect(advertised.definitions.find((item) => item.name === "layered")?.description).toBe(
            "compatibility registration",
          )

          yield* store.dispose(instance)
          const revealed = yield* registry.materialize()
          expect(revealed.definitions.find((item) => item.name === "layered")?.description).toBe(
            "previous registration",
          )
          expect((yield* advertised.settle(call("layered"))).result).toEqual({
            type: "error",
            value: "Stale tool call: layered",
          })
          expect((yield* revealed.settle(call("layered"))).result).toEqual({
            type: "text",
            value: "previous",
          })
        }),
      )
    }),
  )

  hooks.instance("runs Core definition, before, and after hooks exactly once", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* initialize()

      yield* withLocation(
        test.directory,
        Effect.gen(function* () {
          const counts = { definition: 0, before: 0, after: 0 }
          const runtime = yield* PluginRuntime.Service
          yield* runtime.hook(PluginRuntime.HookName.toolDefinition, () => {
            counts.definition++
          })
          yield* runtime.hook(PluginRuntime.HookName.toolExecuteBefore, () => {
            counts.before++
          })
          yield* runtime.hook(PluginRuntime.HookName.toolExecuteAfter, () => {
            counts.after++
          })

          const registry = yield* ToolRegistry.Service
          const materialized = yield* registry.materialize()
          expect((yield* materialized.settle(call("hooked"))).result).toEqual({
            type: "text",
            value: "once",
          })
          expect(counts).toEqual({ definition: 1, before: 1, after: 1 })
        }),
      )
    }),
  )
})
