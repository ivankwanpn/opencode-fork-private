import { Model, LLMClient, LLMEvent, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import { Auth } from "@opencode-ai/llm/route"
import { route, type OpenAIResponsesBody } from "@opencode-ai/llm/protocols/openai-responses"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { node } from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Effect, Layer, Schema, Stream } from "effect"
import { pluginLocationMap } from "../lib/location-service-map"

type Mode = "discover" | "resume"

interface WorkerResult {
  readonly mode: Mode
  readonly pid: number
  readonly semanticDiscoveryCount: number
  readonly selectedToolNames: ReadonlyArray<string>
  readonly nativeSearchCallIDs: ReadonlyArray<string>
  readonly nativeSearchOutputIDs: ReadonlyArray<string>
  readonly nativeSearchOutputNames: ReadonlyArray<string>
  readonly advertisedFunctionNames: ReadonlyArray<string>
}

const mode = process.argv[2]
const database = process.argv[3]
const output = process.argv[4]
if ((mode !== "discover" && mode !== "resume") || !database || !output)
  throw new Error("usage: native-tool-search-process.ts <discover|resume> <database> <output>")

const finalEvents = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const responses: LLMEvent[][] =
  mode === "discover"
    ? [
        [
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({
            id: "process-search",
            name: "tool_search",
            input: { query: "select:deferred_echo" },
          }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ],
        finalEvents("discover-complete", "Discovery complete"),
      ]
    : [finalEvents("resume-complete", "Recovery complete")]
const requests: LLMRequest[] = []
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: LLMClient.prepare,
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
    }) as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.update(
  route
    .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
    .model({ id: "native-tool-search-process" }),
  { compatibility: { toolSearch: "openai-responses" } },
)
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
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
const systemContext = AppNodeBuilder.build(SystemContextRegistry.node)
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))
const pluginRuntime = PluginRuntime.make()
const pluginLocation = pluginLocationMap(pluginRuntime)
const runnerLayer = AppNodeBuilder.build(node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [Config.node, config],
  [PermissionV2.node, permission],
  [PluginRuntime.node, Layer.succeed(PluginRuntime.Service, pluginRuntime)],
  [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const runner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => runner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      exclusive: (sessionID, work) =>
        coordinator.exclusive(sessionID, work).pipe(
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
const runtime = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    EventV2.node,
    SessionProjector.node,
    SessionStore.node,
    AgentV2.node,
    ApplicationTools.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    node,
    SessionV2.node,
  ]),
  [
    [Database.node, Database.layerFromPath(database)],
    [LayerNodePlatform.llmClient, client],
    [PermissionV2.node, permission],
    [PluginRuntime.node, Layer.succeed(PluginRuntime.Service, pluginRuntime)],
    pluginLocation.replacement,
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    [SessionRunnerModel.node, models],
    [SystemContextRegistry.node, systemContext],
    [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    [SkillGuidance.node, skillGuidance],
    [ReferenceGuidance.node, referenceGuidance],
    [Config.node, config],
    [Snapshot.node, Snapshot.noopLayer],
    [node, runnerLayer],
    [SessionExecution.node, execution],
  ],
)
const sessionID = SessionV2.ID.make("ses_native_tool_search_process")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const loadableNames = (value: unknown): ReadonlyArray<string> => {
  if (!isRecord(value)) return []
  if (value.type === "function" && typeof value.name === "string") return [value.name]
  if (value.type !== "namespace" || !Array.isArray(value.tools)) return []
  return value.tools.flatMap(loadableNames)
}

const result = await Effect.runPromise(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
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
        slug: "native-tool-search-process",
        directory: "/project",
        title: "Native Tool Search process restart",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("build"), (agent) => {
        agent.mode = "primary"
        agent.system = "Process restart test system"
      }),
    )
    const applications = yield* ApplicationTools.Service
    yield* applications.register({
      deferred_echo: Tool.withExposure(
        Tool.make({
          description: "Echo text after native tool search",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.Struct({ text: Schema.String }),
          execute: ({ text }) => Effect.succeed({ text }),
        }),
        "deferred",
      ),
    })
    const session = yield* SessionV2.Service
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: mode === "discover" ? "Find the deferred echo tool" : "Continue after restart" }),
      resume: false,
    })
    yield* session.resume(sessionID)

    const request = requests.at(-1)
    if (!request) return yield* Effect.die(new Error("runner did not make a provider request"))
    const prepared = yield* LLMClient.prepare<OpenAIResponsesBody>(request)
    const nativeSearchCallIDs = prepared.body.input.flatMap((item) =>
      "type" in item && item.type === "tool_search_call" ? [item.call_id] : [],
    )
    const nativeSearchOutputIDs = prepared.body.input.flatMap((item) =>
      "type" in item && item.type === "tool_search_output" ? [item.call_id] : [],
    )
    const nativeSearchOutputNames = prepared.body.input.flatMap((item) => {
      if (!("type" in item) || item.type !== "tool_search_output") return []
      return item.tools.flatMap(loadableNames)
    })
    return {
      mode,
      pid: process.pid,
      semanticDiscoveryCount: request.toolDiscoveries?.length ?? 0,
      selectedToolNames: request.tools.flatMap((tool) => (tool.deferLoading === true ? [tool.name] : [])),
      nativeSearchCallIDs,
      nativeSearchOutputIDs,
      nativeSearchOutputNames,
      advertisedFunctionNames:
        prepared.body.tools?.flatMap((tool) => (tool.type === "function" ? [tool.name] : [])) ?? [],
    } satisfies WorkerResult
  }).pipe(Effect.provide(Layer.fresh(runtime)), Effect.scoped),
)

await Bun.write(output, JSON.stringify(result))
