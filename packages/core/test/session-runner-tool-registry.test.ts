import { describe, expect } from "bun:test"
import type { MutableValue, ToolResult } from "@opencode-ai/plugin/v2/effect"
import { Tool } from "@opencode-ai/core/tool/tool"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ModelV2 } from "@opencode-ai/core/model"
import { McpCatalog } from "@opencode-ai/core/mcp/catalog"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolCatalog } from "@opencode-ai/core/tool/catalog"
import { executeTool, settleTool, toolDefinitions } from "./lib/tool"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, SchemaGetter, SchemaIssue, Scope } from "effect"
import { testEffect } from "./lib/effect"

const bounds: ToolOutputStore.BoundInput[] = []
const retentionFailure = new ToolOutputStore.StorageError({ operation: "write", cause: new Error("disk full") })
const outputStore = Layer.mock(ToolOutputStore.Service, {
  bound: (input) => {
    if (input.toolCallID === "call-retention-failure") return Effect.fail(retentionFailure)
    return Effect.sync(() => bounds.push(input)).pipe(
      Effect.as(
        input.toolCallID === "call-bounded"
          ? {
              output: { structured: {}, content: [{ type: "text" as const, text: "bounded reference" }] },
              outputPaths: ["/managed/generic"],
            }
          : { output: input.output, outputPaths: [] },
      ),
    )
  },
})
const registryLayer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, PluginRuntime.node]), [
  [ToolOutputStore.node, outputStore],
])
const it = testEffect(registryLayer)
const integrated = testEffect(
  AppNodeBuilder.build(LayerNode.group([ApplicationTools.node, ToolRegistry.node]), [
    [ToolOutputStore.node, outputStore],
  ]),
)
const identity = {
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_registry"),
}
const sessionID = SessionV2.ID.make("ses_registry")
const call = (name: string, id = `call-${name}`): ToolRegistry.ExecuteInput => ({
  sessionID,
  ...identity,
  call: { type: "tool-call", id, name, input: { text: name } },
})

const make = (permission?: string | readonly [string, ...string[]]) => {
  const tool = Tool.make({
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text }),
    toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
  })
  if (!permission) return tool
  return typeof permission === "string" ? Tool.withPermission(tool, permission) : Tool.withPermissions(tool, permission)
}

describe("ToolRegistry", () => {
  it.effect("filters disabled tools with edit aliases and ordered wildcard precedence", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        question: make(),
        bash: make(),
        edit: make("edit"),
        write: make("edit"),
        apply_patch: make("edit"),
        task_status: make(["task", "bash"]),
      })
      const names = (rules: Parameters<ToolRegistry.Interface["materialize"]>[0]) =>
        toolDefinitions(service, rules).pipe(Effect.map((definitions) => definitions.map((tool) => tool.name)))

      expect(yield* names([{ action: "question", resource: "*", effect: "deny" }])).toEqual([
        "bash",
        "edit",
        "write",
        "apply_patch",
        "task_status",
      ])
      expect(
        yield* names([
          { action: "*", resource: "*", effect: "deny" },
          { action: "question", resource: "private", effect: "allow" },
        ]),
      ).toEqual(["question"])
      expect(
        yield* names([
          { action: "question", resource: "private", effect: "allow" },
          { action: "*", resource: "*", effect: "deny" },
        ]),
      ).toEqual([])
      expect(yield* names([{ action: "edit", resource: "*", effect: "deny" }])).toEqual([
        "question",
        "bash",
        "task_status",
      ])
      expect(
        yield* names([
          { action: "*", resource: "*", effect: "deny" },
          { action: "bash", resource: "*", effect: "allow" },
        ]),
      ).toEqual(["bash", "task_status"])
      expect(
        yield* names([
          { action: "*", resource: "*", effect: "deny" },
          { action: "task", resource: "*", effect: "allow" },
        ]),
      ).toEqual(["task_status"])
    }),
  )

  it.effect("advertises tool_search only when a deferred tool is registered", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ deferred: Tool.withExposure(make(), "deferred") })

      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["tool_search"])
    }),
  )

  it.effect("materializes managed Playwright tools without exposing other managed MCP tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const managedPlaywright = McpCatalog.toolName(
        "claude:claude-plugins-official:playwright:playwright",
        "browser_take_screenshot",
      )
      const managedOther = McpCatalog.toolName("claude:claude-plugins-official:context7:context7", "resolve-library-id")
      yield* service.register({ [managedPlaywright]: make(), [managedOther]: make() })

      const definitions = yield* toolDefinitions(service, [
        { action: "*", resource: "*", effect: "deny" },
        {
          action: "claude_claude-plugins-official_playwright_playwright_*",
          resource: "*",
          effect: "allow",
        },
      ])

      expect(definitions.map((definition) => definition.name)).toEqual([managedPlaywright])
    }),
  )

  it.effect("matches official model and feature tool visibility", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        question: make(),
        edit: make("edit"),
        write: make("edit"),
        apply_patch: make("edit"),
        websearch: make(),
        execute: make(),
        lsp: make(),
        plan_exit: make(),
        custom: make(),
      })
      const names = (
        providerID: ProviderV2.ID,
        modelID: ModelV2.ID,
        features: Partial<ToolRegistry.MaterializationFeatures> = {},
      ) =>
        service
          .materialize([], {}, { model: { providerID, modelID }, features })
          .pipe(Effect.map((result) => result.definitions.map((tool) => tool.name)))
      const disabled = {
        client: "desktop",
        enableExa: false,
        enableParallel: false,
        question: false,
        codeMode: false,
        lsp: false,
        plan: false,
      }

      expect(yield* names(ProviderV2.ID.openai, ModelV2.ID.make("gpt-5"), disabled)).toEqual([
        "question",
        "apply_patch",
        "custom",
      ])
      expect(yield* names(ProviderV2.ID.anthropic, ModelV2.ID.make("claude-sonnet-4"), disabled)).toEqual([
        "question",
        "edit",
        "write",
        "custom",
      ])
      expect(yield* names(ProviderV2.ID.opencode, ModelV2.ID.make("claude-sonnet-4"), disabled)).toEqual([
        "question",
        "edit",
        "write",
        "websearch",
        "custom",
      ])
      expect(
        yield* names(ProviderV2.ID.openai, ModelV2.ID.make("gpt-4.1"), {
          ...disabled,
          client: "cli",
          enableExa: true,
          codeMode: true,
          lsp: true,
          plan: true,
        }),
      ).toEqual(["question", "edit", "write", "websearch", "execute", "lsp", "plan_exit", "custom"])
    }),
  )

  it.effect("keeps permission decoration isolated between registrations", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const shared = make()
      yield* service.register({ first: shared })
      yield* service.register({ second: Tool.withPermission(shared, "edit") })
      Tool.withPermission(shared, "question")

      expect(
        (yield* toolDefinitions(service, [{ action: "edit", resource: "*", effect: "deny" }])).map(
          (definition) => definition.name,
        ),
      ).toEqual(["first"])
    }),
  )

  it.effect("reuses model definitions across provider turns", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const first = yield* toolDefinitions(service)
      const second = yield* toolDefinitions(service)

      expect(second[0]).toBe(first[0])
    }),
  )

  it.effect("removes a scoped registration", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(scope))
      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo"])
      yield* Scope.close(scope, Exit.void)
      expect(yield* toolDefinitions(service)).toEqual([])
    }),
  )

  it.effect("materializes scoped source contributions without leaking hidden or denied tools", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const source = { type: "mcp" as const, id: "calendar", displayName: "Calendar" }
      const scope = yield* Scope.make()
      const visible = Tool.withCatalog(make(), {
        source,
        sourceLocalID: "create_event",
        namespace: "calendar",
        displayName: "Create event",
      })
      yield* service
        .contribute({
          source,
          state: "ready",
          tools: {
            calendar_create: visible,
            calendar_hidden: Tool.withExposure(make(), "hidden"),
            calendar_private: Tool.withPermission(make(), "private"),
          },
        })
        .pipe(Scope.provide(scope))

      const materialized = yield* service.materialize([{ action: "private", resource: "*", effect: "deny" }])
      expect(materialized.catalog.tools.map((tool) => tool.callableName)).toEqual(["calendar_create"])
      expect(materialized.catalog.tools[0]).toMatchObject({
        key: ToolCatalog.key(source, "create_event"),
        source,
        sourceLocalID: "create_event",
        exposure: "direct",
      })
      expect(materialized.catalog.sources).toEqual([{ source, state: "ready" }])
      expect(yield* service.sources()).toEqual([{ source, state: "ready" }])

      yield* Scope.close(scope, Exit.void)
      expect(yield* service.sources()).toEqual([])
      expect((yield* materialized.settle(call("calendar_create"))).result).toEqual({
        type: "error",
        value: "Stale tool call: calendar_create",
      })
    }),
  )

  it.effect("lists an authorized pending source without inventing a tool and hides it from deny-all", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const source = { type: "mcp" as const, id: "weather", displayName: "Weather" }
      yield* service.contribute({
        source,
        state: "pending",
        permissions: ["weather_*"],
        tools: {},
      })

      expect((yield* service.materialize()).catalog).toMatchObject({
        tools: [],
        sources: [{ source, state: "pending" }],
      })
      expect((yield* service.materialize([{ action: "*", resource: "*", effect: "deny" }])).catalog.sources).toEqual([])
    }),
  )

  it.effect("changes catalog identity only for the effective same-name source overlay", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const first = { type: "plugin" as const, id: "first" }
      const second = { type: "plugin" as const, id: "second" }
      yield* service.contribute({ source: first, state: "ready", tools: { shared: make() } })
      const original = (yield* service.materialize()).catalog.tools[0]!
      const scope = yield* Scope.make()
      yield* service
        .contribute({ source: second, state: "ready", tools: { shared: make() } })
        .pipe(Scope.provide(scope))
      const overlay = (yield* service.materialize()).catalog.tools[0]!

      expect(original.key).toBe(ToolCatalog.key(first, "shared"))
      expect(overlay.key).toBe(ToolCatalog.key(second, "shared"))
      expect(overlay.key).not.toBe(original.key)
      yield* Scope.close(scope, Exit.void)
      expect((yield* service.materialize()).catalog.tools[0]?.key).toBe(original.key)
    }),
  )

  it.effect("hashes the final model definition after Plugin definition hooks", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const runtime = yield* PluginRuntime.Service
      yield* service.register({ hooked: make() })
      const beforeMaterialization = yield* service.materialize()
      const before = beforeMaterialization.catalog.tools[0]!
      yield* runtime.hook<{
        readonly definition: {
          readonly update: (
            transform: (value: { description: string; parameters: unknown }) => {
              description: string
              parameters: unknown
            },
          ) => void
        }
      }>(PluginRuntime.HookName.toolDefinition, (event) => {
        event.definition.update((value) => ({ ...value, description: "Hooked description" }))
      })
      const afterMaterialization = yield* service.materialize()
      const after = afterMaterialization.catalog.tools[0]!

      expect(before.description).toBe("Echo text")
      expect(after.description).toBe("Hooked description")
      expect(after.definitionHash).not.toBe(before.definitionHash)
      expect(after.key).toBe(before.key)
      expect(afterMaterialization.catalog.revision).not.toBe(beforeMaterialization.catalog.revision)
    }),
  )

  it.effect("preserves an interrupted registration until its scope closes", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      const registered = yield* Deferred.make<void>()
      const fiber = yield* service
        .register({ echo: make() })
        .pipe(
          Effect.andThen(Deferred.succeed(registered, undefined)),
          Effect.andThen(Effect.never),
          Scope.provide(scope),
          Effect.forkChild,
        )
      yield* Deferred.await(registered)
      yield* Fiber.interrupt(fiber)

      expect((yield* toolDefinitions(service)).map((tool) => tool.name)).toEqual(["echo"])
      yield* Scope.close(scope, Exit.void)
      expect(yield* toolDefinitions(service)).toEqual([])
    }),
  )

  it.effect("returns model errors without swallowing interruption or defects", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({
        failed: Tool.make({
          description: "Failed",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.fail(new Tool.Failure({ message: "Denied" })),
        }),
      })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "failed", name: "failed", input: {} },
        }),
      ).toEqual({ type: "error", value: "Denied" })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "missing", name: "missing", input: {} },
        }),
      ).toEqual({ type: "error", value: "Unknown tool: missing" })

      yield* service.register({
        defect: Tool.make({
          description: "Defect",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.die("unexpected executor defect"),
        }),
      })
      expect(
        yield* service.materialize().pipe(
          Effect.flatMap((materialized) =>
            materialized.settle({
              sessionID,
              ...identity,
              call: { type: "tool-call", id: "defect", name: "defect", input: {} },
            }),
          ),
          Effect.catchDefect(Effect.succeed),
        ),
      ).toBe("unexpected executor defect")
    }),
  )

  it.effect("preserves typed execution failures and interruption through materialized settlement", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const corrected = new PermissionV2.CorrectedError({ feedback: "use another resource" })
      const missing = new SessionCommand.NotFoundError({ sessionID })
      yield* service.register({
        corrected: Tool.make({
          description: "Corrected",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.fail(corrected),
        }),
        missing_session: Tool.make({
          description: "Missing Session",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.fail(missing),
        }),
        interrupted: Tool.make({
          description: "Interrupted",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.interrupt,
        }),
      })
      const materialized = yield* service.materialize()
      const input = (name: string): ToolRegistry.ExecuteInput => ({
        sessionID,
        ...identity,
        call: { type: "tool-call", id: `call-${name}`, name, input: {} },
      })

      expect(yield* Effect.flip(materialized.settle(input("corrected")))).toBe(corrected)
      expect(yield* Effect.flip(materialized.settle(input("missing_session")))).toBe(missing)
      const interrupted = yield* materialized.settle(input("interrupted")).pipe(Effect.exit)
      expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true)
    }),
  )

  it.effect("propagates retention failures through settlement", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const materialized = yield* service.materialize()
      const exit = yield* materialized.settle(call("echo", "call-retention-failure")).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toBe(retentionFailure)
      expect(retentionFailure.message).toBe("Failed to write tool output: disk full")
    }),
  )

  it.effect("exposes settlement only through materialization", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      expect("definitions" in service).toBe(false)
      expect("execute" in service).toBe(false)
      expect("settle" in service).toBe(false)
      expect(typeof service.materialize).toBe("function")
    }),
  )

  it.effect("passes complete invocation identity to the canonical handler", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const contexts: Tool.Context[] = []
      yield* service.register({
        context: Tool.make({
          description: "Context",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: (_, context) => Effect.sync(() => contexts.push(context)).pipe(Effect.as({ ok: true })),
        }),
      })
      yield* executeTool(service, {
        sessionID,
        ...identity,
        call: { type: "tool-call", id: "call-context", name: "context", input: {} },
      })
      expect(contexts).toEqual([{ sessionID, ...identity, toolCallID: "call-context" }])
    }),
  )

  it.effect("encodes output and applies generic settlement bounding", () =>
    Effect.gen(function* () {
      bounds.length = 0
      const service = yield* ToolRegistry.Service
      yield* service.register({ bounded: make() })
      expect(
        yield* settleTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "call-bounded", name: "bounded", input: { text: "complete" } },
        }),
      ).toEqual({
        result: { type: "text", value: "bounded reference" },
        output: { structured: {}, content: [{ type: "text", text: "bounded reference" }] },
        outputPaths: ["/managed/generic"],
      })
      expect(bounds).toHaveLength(1)
    }),
  )

  it.effect("retains MCP file provenance through canonical settlement", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const file = {
        type: "file" as const,
        uri: "mcp://docs/report.pdf",
        mime: "application/pdf",
        name: "report.pdf",
        provenance: {
          type: "mcp" as const,
          clientName: "docs",
          uri: "mcp://docs/report.pdf",
          kind: "resource_link" as const,
          mime: "application/pdf",
          name: "report.pdf",
          description: "Quarterly report",
          size: 42,
          annotations: { audience: ["assistant"] },
          meta: {
            result: { trace: "result" },
            content: { trace: "content" },
            resource: { trace: "resource" },
          },
        },
      }
      yield* service.register({
        mcp: Tool.make({
          description: "Return an MCP resource",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({}),
          toModelOutput: () => [file],
        }),
      })

      const settlement = yield* settleTool(service, call("mcp"))
      expect(settlement.output?.content).toEqual([file])
    }),
  )

  it.effect("keeps legacy canonical files free of provenance", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const file = {
        type: "file" as const,
        uri: "file:///legacy.txt",
        mime: "text/plain",
        name: "legacy.txt",
      }
      yield* service.register({
        legacy_file: Tool.make({
          description: "Return a legacy file",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({}),
          toModelOutput: () => [file],
        }),
      })

      const settlement = yield* settleTool(service, call("legacy_file"))
      expect(settlement.output?.content).toEqual([file])
      expect(settlement.output?.content[0]).not.toHaveProperty("provenance")
    }),
  )

  it.effect("keeps canonical content unchanged through an unchanged tool-after hook", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook<{
        readonly result: MutableValue<ToolResult>
      }>(PluginRuntime.HookName.toolExecuteAfter, (event) => {
        event.result.update((result) => ({ ...result }))
      })
      const content = [
        {
          type: "text" as const,
          text: "Resource text",
          provenance: {
            type: "mcp" as const,
            clientName: "docs",
            uri: "mcp://docs/text",
            kind: "resource" as const,
          },
        },
        {
          type: "file" as const,
          uri: "data:application/pdf;base64,AQID",
          mime: "application/pdf",
          name: "report.pdf",
          provenance: {
            type: "mcp" as const,
            clientName: "docs",
            uri: "mcp://docs/report.pdf",
            kind: "resource_link" as const,
          },
        },
      ]
      yield* service.register({
        unchanged_after: Tool.make({
          description: "Return canonical content",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({}),
          toModelOutput: () => content,
        }),
      })

      const settlement = yield* settleTool(service, call("unchanged_after"))
      expect(settlement.output?.content).toEqual(content)
      expect(settlement.output?.content).toBe(bounds.at(-1)?.output.content)
    }),
  )

  it.effect("mutates one provenance-bearing text without removing files", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook<{
        readonly result: MutableValue<ToolResult>
      }>(PluginRuntime.HookName.toolExecuteAfter, (event) => {
        event.result.update((result) => ({ ...result, output: "Plugin text" }))
      })
      const provenance = {
        type: "mcp" as const,
        clientName: "docs",
        uri: "mcp://docs/text",
        kind: "resource" as const,
        meta: { result: { trace: "single" } },
      }
      const file = {
        type: "file" as const,
        uri: "data:image/png;base64,AQID",
        mime: "image/png",
        name: "image.png",
      }
      yield* service.register({
        single_text_after: Tool.make({
          description: "Return text and media",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({}),
          toModelOutput: () => [{ type: "text", text: "Original", provenance }, file],
        }),
      })

      const settlement = yield* settleTool(service, call("single_text_after"))
      expect(settlement.output?.content).toEqual([{ type: "text", text: "Plugin text", provenance }, file])
    }),
  )

  it.effect("collapses multiple texts to one generic text while retaining file order", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook<{
        readonly result: MutableValue<ToolResult>
      }>(PluginRuntime.HookName.toolExecuteAfter, (event) => {
        event.result.update((result) => ({ ...result, output: "Collapsed" }))
      })
      const file = {
        type: "file" as const,
        uri: "data:image/png;base64,AQID",
        mime: "image/png",
        name: "image.png",
      }
      yield* service.register({
        multiple_text_after: Tool.make({
          description: "Return multiple text resources",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({}),
          toModelOutput: () => [
            {
              type: "text",
              text: "First",
              provenance: {
                type: "mcp",
                clientName: "docs",
                uri: "mcp://docs/first",
                kind: "resource",
              },
            },
            file,
            {
              type: "text",
              text: "Second",
              provenance: {
                type: "mcp",
                clientName: "docs",
                uri: "mcp://docs/second",
                kind: "resource",
              },
            },
          ],
        }),
      })

      const settlement = yield* settleTool(service, call("multiple_text_after"))
      expect(settlement.output?.content).toEqual([{ type: "text", text: "Collapsed" }, file])
      expect(settlement.output?.content[0]).not.toHaveProperty("provenance")
    }),
  )

  it.effect("inserts changed tool-after text before media-only content", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook<{
        readonly result: MutableValue<ToolResult>
      }>(PluginRuntime.HookName.toolExecuteAfter, (event) => {
        event.result.update((result) => ({ ...result, output: "Plugin summary" }))
      })
      const file = {
        type: "file" as const,
        uri: "data:application/octet-stream;base64,AQID",
        mime: "application/octet-stream",
        name: "artifact.bin",
      }
      yield* service.register({
        media_only_after: Tool.make({
          description: "Return only media",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          execute: () => Effect.succeed({}),
          toModelOutput: () => [file],
        }),
      })

      const settlement = yield* settleTool(service, call("media_only_after"))
      expect(settlement.output?.content).toEqual([{ type: "text", text: "Plugin summary" }, file])
    }),
  )

  it.effect("persists tool-after title mutations in canonical structured output", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const runtime = yield* PluginRuntime.Service
      yield* runtime.hook<{
        readonly result: MutableValue<ToolResult>
      }>(PluginRuntime.HookName.toolExecuteAfter, (event) => {
        event.result.update((result) => ({ ...result, title: "Plugin title" }))
      })
      yield* service.register({ echo: make() })

      const settlement = yield* settleTool(service, call("echo", "call-title"))
      expect(settlement.output?.structured).toEqual({ text: "echo", title: "Plugin title" })
    }),
  )

  it.effect("enforces transformed codecs at execution and projection boundaries", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const executed: string[] = []
      const Transformed = Schema.Boolean.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transform((value) => (value ? "yes" : "no")),
          encode: SchemaGetter.transform((value) => value === "yes"),
        }),
      )
      yield* service.register({
        transformed: Tool.make({
          description: "Transform values",
          input: Schema.Struct({ value: Transformed }),
          output: Schema.Struct({ value: Transformed }),
          execute: ({ value }) => Effect.sync(() => executed.push(value)).pipe(Effect.as({ value })),
          toModelOutput: ({ output }) => [{ type: "text", text: String(output.value) }],
        }),
      })

      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "transformed", name: "transformed", input: { value: true } },
        }),
      ).toEqual({ type: "text", value: "true" })
      expect(executed).toEqual(["yes"])
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "invalid-input", name: "transformed", input: { value: "yes" } },
        }),
      ).toMatchObject({ type: "error", value: expect.stringContaining("Invalid tool input") })
      expect(executed).toEqual(["yes"])

      yield* service.register({
        invalid_output: Tool.make({
          description: "Return invalid output",
          input: Schema.Struct({}),
          output: Schema.Struct({
            value: Schema.Boolean.pipe(
              Schema.decodeTo(Schema.String, {
                decode: SchemaGetter.transform((value) => String(value)),
                encode: SchemaGetter.transformOrFail((value) =>
                  value === "valid"
                    ? Effect.succeed(true)
                    : Effect.fail(new SchemaIssue.InvalidValue(Option.some(value), { message: "invalid output" })),
                ),
              }),
            ),
          }),
          execute: () => Effect.succeed({ value: "invalid" }),
        }),
      })
      expect(
        yield* executeTool(service, {
          sessionID,
          ...identity,
          call: { type: "tool-call", id: "invalid-output", name: "invalid_output", input: {} },
        }),
      ).toMatchObject({ type: "error", value: expect.stringContaining("invalid value for its output schema") })
    }),
  )

  it.effect("executes the unchanged registration advertised for a provider turn", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const materialized = yield* service.materialize()

      expect((yield* materialized.settle(call("echo"))).result).toEqual({ type: "text", value: "echo" })
    }),
  )

  it.effect("rejects a call when its advertised registration was removed", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const scope = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(scope))
      const materialized = yield* service.materialize()
      yield* Scope.close(scope, Exit.void)

      expect((yield* materialized.settle(call("echo"))).result).toEqual({
        type: "error",
        value: "Stale tool call: echo",
      })
    }),
  )

  it.effect("rejects only the replaced name from a multi-tool provider turn", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ first: make(), second: make() })
      const materialized = yield* service.materialize()
      yield* service.register({ first: make() })

      expect((yield* materialized.settle(call("first"))).result).toEqual({
        type: "error",
        value: "Stale tool call: first",
      })
      expect((yield* materialized.settle(call("second"))).result).toEqual({ type: "text", value: "second" })
    }),
  )

  it.effect("treats revealing a previous overlay as stale", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      yield* service.register({ echo: make() })
      const overlay = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(overlay))
      const materialized = yield* service.materialize()
      yield* Scope.close(overlay, Exit.void)

      expect((yield* materialized.settle(call("echo"))).result).toEqual({
        type: "error",
        value: "Stale tool call: echo",
      })
    }),
  )

  integrated.effect("rejects an application call after a Location override is registered", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const service = yield* ToolRegistry.Service
      yield* applications.register({ echo: make() })
      const materialized = yield* service.materialize()
      yield* service.register({ echo: make() })

      expect((yield* materialized.settle(call("echo"))).result).toEqual({
        type: "error",
        value: "Stale tool call: echo",
      })
    }),
  )

  integrated.effect("rejects a Location call after removal reveals an application registration", () =>
    Effect.gen(function* () {
      const applications = yield* ApplicationTools.Service
      const service = yield* ToolRegistry.Service
      yield* applications.register({ echo: make() })
      const scope = yield* Scope.make()
      yield* service.register({ echo: make() }).pipe(Scope.provide(scope))
      const materialized = yield* service.materialize()
      yield* Scope.close(scope, Exit.void)

      expect((yield* materialized.settle(call("echo"))).result).toEqual({
        type: "error",
        value: "Stale tool call: echo",
      })
    }),
  )

  it.effect("keeps captured execution running after registration mutation", () =>
    Effect.gen(function* () {
      const service = yield* ToolRegistry.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* service
        .register({
          echo: Tool.make({
            description: "Echo text",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.Struct({ text: Schema.String }),
            execute: ({ text }) =>
              Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as({ text })),
            toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
          }),
        })
        .pipe(Scope.provide(scope))
      const materialized = yield* service.materialize()
      const settlement = yield* materialized.settle(call("echo")).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Scope.close(scope, Exit.void)
      yield* service.register({ echo: make() })
      yield* Deferred.succeed(release, undefined)

      expect(yield* Fiber.join(settlement)).toMatchObject({ result: { type: "text", value: "echo" } })
    }),
  )
})
