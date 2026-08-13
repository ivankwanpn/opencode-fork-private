import { describe, expect } from "bun:test"
import {
  LLMClient,
  LLMError,
  LLMEvent,
  Model,
  TransportReason,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import {
  WebSocketExecutor,
  WebSocketPool,
  type WebSocketConnection,
  type WebSocketPool as WebSocketPoolShape,
  type WebSocketPoolKey,
} from "@opencode-ai/llm/route"
import { Database } from "@opencode-ai/core/database/database"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Tool } from "@opencode-ai/core/tool/tool"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { ModelV2 } from "@opencode-ai/core/model"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp/runtime"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { Effect, Layer, Option, Schema, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const requests: LLMRequest[] = []
let responses: LLMEvent[][] | undefined
let streamFailure: LLMError | undefined
// Observed through the mock client: the pool the runner provides per turn, the
// pooled connections it acquires, and the executor open/close counts.
const observedPools: WebSocketPoolShape[] = []
const observedConnections: WebSocketConnection[] = []
const opened = { count: 0 }
const closed = { count: 0 }

const executor = WebSocketExecutor.Service.of({
  open: () =>
    Effect.sync(() => {
      opened.count++
      return {
        sendText: () => Effect.void,
        messages: Stream.empty,
        close: Effect.sync(() => {
          closed.count++
        }),
      }
    }),
})

const poolKey: WebSocketPoolKey = { url: "ws://mock/responses", headers: Headers.empty, headersKey: "" }

// Mirrors the pooled WebSocket transport: reads the turn-scoped pool from the
// environment, acquires a connection through the counting executor, and serves
// the scripted provider events.
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) =>
      Stream.unwrap(
        Effect.gen(function* () {
          requests.push(request)
          const pool = Option.getOrUndefined(yield* Effect.serviceOption(WebSocketPool.Service))
          if (pool) {
            observedPools.push(pool)
            const connection = yield* pool.acquire(poolKey).pipe(
              Effect.provideService(WebSocketExecutor.Service, executor),
            )
            observedConnections.push(connection)
          }
          return streamFailure
            ? Stream.fail(streamFailure)
            : Stream.fromIterable(responses?.shift() ?? [])
        }),
      )) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const resolveModel: SessionRunnerModel.Interface["resolve"] = (session, selected) => {
  const effective = selected ?? session.model
  return Effect.succeed(model)
}
const models = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({
    resolve: resolveModel,
    resolveWithInfo: (session, selected) =>
      resolveModel(session, selected).pipe(
        Effect.map((llm) => {
          const providerID = ProviderV2.ID.make(llm.provider)
          const modelID = ModelV2.ID.make(llm.id)
          return {
            llm,
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(providerID, modelID),
              api: { id: modelID, type: "aisdk", package: "@ai-sdk/openai" },
            }),
            provider: ProviderV2.Info.empty(providerID),
            source: "custom" as const,
          }
        }),
      ),
  }),
)

const systemContextKey = SystemContext.Key.make("test/context")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.sync(() =>
          SystemContext.combine([
            SystemContext.make({
              key: systemContextKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("Initial context"),
              baseline: String,
              update: (_previous, current) => current,
              removed: () => "System context source removed: test/context",
            }),
          ]),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const nestedInstructionContext = Layer.mock(InstructionContext.NestedService, {
  load: () => Effect.succeed(SystemContext.empty),
})
const mcp = Layer.mock(MCP.Service, { instructions: () => Effect.succeed([]) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)
const pluginBase = PluginRuntime.make()
const pluginRuntime: PluginRuntime.Interface = {
  hook: pluginBase.hook,
  run: (name, event) => pluginBase.run(name, event),
}
const attachment: SessionAttachment.Interface = {
  materializeFile: (file) => Effect.succeed(file),
  materialize: (prompt) => Effect.succeed(prompt),
}
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const executions: string[] = []
const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) =>
          Effect.sync(() => {
            executions.push(text)
            return { text }
          }),
      }),
    }),
  ),
)
const echoNode = makeLocationNode({ name: "test/session-runner-websocket-tools", layer: echo, deps: [ToolRegistry.node] })
const pluginLocation = pluginLocationMap(pluginRuntime, attachment)
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [MCP.node, mcp],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [InstructionContext.nestedNode, nestedInstructionContext],
  [PermissionV2.node, permission],
  [PluginRuntime.node, Layer.succeed(PluginRuntime.Service, pluginRuntime)],
  [SessionAttachment.node, Layer.succeed(SessionAttachment.Service, SessionAttachment.Service.of(attachment))],
  [Config.node, config],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      exclusive: (sessionID, work) =>
        coordinator
          .exclusive(sessionID, work)
          .pipe(
            Effect.catchTag("SessionRunCoordinator.Busy", () =>
              Effect.fail(new SessionExecution.BusyError({ sessionID })),
            ),
          ),
      wake: coordinator.wake,
      wait: coordinator.wait,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      QuestionV2.node,
      SessionProjector.node,
      SessionStore.node,
      ApplicationTools.node,
      AgentV2.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      echoNode,
      SessionRunnerModel.node,
      SystemContextRegistry.node,
      SkillGuidance.node,
      ReferenceGuidance.node,
      Config.node,
      Snapshot.node,
      SessionRunnerLLM.node,
      SessionExecution.node,
      SessionV2.node,
    ]),
    [
      [LayerNodePlatform.llmClient, client],
      [PermissionV2.node, permission],
      [PluginRuntime.node, Layer.succeed(PluginRuntime.Service, pluginRuntime)],
      pluginLocation.replacement,
      [SessionRunnerModel.node, models],
      [SystemContextRegistry.node, systemContext],
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
      [MCP.node, mcp],
      [SkillGuidance.node, skillGuidance],
      [ReferenceGuidance.node, referenceGuidance],
      [InstructionContext.nestedNode, nestedInstructionContext],
      [Snapshot.node, Snapshot.noopLayer],
      [SessionRunnerLLM.node, runnerLayer],
      [SessionExecution.node, execution],
      [Config.node, config],
    ],
  ),
)

const sessionID = SessionV2.ID.make("ses_runner_ws_pool")

const providerUnavailable = () =>
  new LLMError({
    module: "test",
    method: "stream",
    reason: new TransportReason({ message: "Provider unavailable" }),
  })

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  responses = undefined
  streamFailure = undefined
  requests.length = 0
  observedPools.length = 0
  observedConnections.length = 0
  opened.count = 0
  closed.count = 0
  executions.length = 0
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  // The runner resolves the default "build" agent; register it so the catalog
  // side (effectivePermissions) sees a real agent and exposes tools, consistent
  // with the assert side's missing-agent deny-all early return.
  const agents = yield* AgentV2.Service
  yield* agents.transform((editor) => editor.update(AgentV2.ID.make("build"), (agent) => agent))
})

describe("SessionRunnerLLM WebSocket pool", () => {
  it.effect("reuses one pooled WebSocket connection across continuation iterations and closes it at turn end", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Echo this" }), resume: false })
      responses = [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-echo", name: "echo", input: { text: "hello" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.textStart({ id: "text-final" }),
          LLMEvent.textDelta({ id: "text-final", text: "Done" }),
          LLMEvent.textEnd({ id: "text-final" }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ],
      ]

      yield* session.resume(sessionID)

      expect(requests).toHaveLength(2)
      expect(executions).toEqual(["hello"])
      // The same turn-scoped pool was provided to both continuation iterations.
      expect(observedPools).toHaveLength(2)
      expect(observedPools[0]).toBe(observedPools[1])
      // The pool reused one connection instead of opening a second socket.
      expect(opened.count).toBe(1)
      expect(observedConnections).toHaveLength(2)
      expect(observedConnections[0]).toBe(observedConnections[1])
      // closeAll ran when the turn region ended.
      expect(closed.count).toBe(1)
    }),
  )

  it.effect("closes the pooled connection when the provider turn fails", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Fail" }), resume: false })
      streamFailure = providerUnavailable()

      yield* session.resume(sessionID).pipe(Effect.catchCause(() => Effect.void))

      expect(observedPools).toHaveLength(1)
      expect(opened.count).toBe(1)
      // closeAll runs even though the provider turn failed.
      expect(closed.count).toBe(1)
    }),
  )
})
