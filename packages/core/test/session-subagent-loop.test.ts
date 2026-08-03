import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { and, asc, eq } from "drizzle-orm"
import { Deferred, Effect, Layer, LayerMap, Stream } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Database } from "@opencode-ai/core/database/database"
import { makeGlobalNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { InstructionContext } from "@opencode-ai/core/instruction-context"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { MCP } from "@opencode-ai/core/mcp/runtime"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionInputTable, TaskNotificationOutboxTable, TaskSubmissionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { TaskCancellation } from "@opencode-ai/core/session/task-cancellation"
import { TaskNotification } from "@opencode-ai/core/session/task-notification"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { TaskTool } from "@opencode-ai/core/tool/task"
import { ToolProgress } from "@opencode-ai/core/tool/progress"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { location } from "./fixture/location"

type Child = {
  readonly prompt: string
  readonly result: string
  readonly started: Deferred.Deferred<void>
  readonly release: Deferred.Deferred<void>
}

type Scenario = {
  readonly parentPrompt: string
  readonly parentRequests: LLMRequest[]
  readonly parentStarted: Deferred.Deferred<void>[]
  readonly parentGate?: Deferred.Deferred<void>
  readonly children: Readonly<Record<"A" | "B", Child>>
}

const locationRef = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = Model.make({ id: "subagent-loop", provider: "fake", route: OpenAIChat.route })
const modelRef = ModelV2.Ref.make({
  id: ModelV2.ID.make(model.id),
  providerID: ProviderV2.ID.make(model.provider),
})
let scenario: Scenario | undefined

const userTexts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "user" ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])) : [],
  )

const toolResultParts = (request: LLMRequest) =>
  request.messages.flatMap((message) =>
    message.role === "tool" ? message.content.flatMap((part) => (part.type === "tool-result" ? [part] : [])) : [],
  )

const completed = (id: string, text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id }),
  LLMEvent.textDelta({ id, text }),
  LLMEvent.textEnd({ id }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const taskCalls: LLMEvent[] = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.toolCall({
    id: "call-child-a",
    name: "task",
    input: { description: "Run child A", prompt: "child A", subagent_type: "general" },
  }),
  LLMEvent.toolCall({
    id: "call-child-b",
    name: "task",
    input: { description: "Run child B", prompt: "child B", subagent_type: "general" },
  }),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      const current = scenario
      if (!current) return Stream.die("Scenario not initialized")
      const texts = userTexts(request)
      const child = Object.values(current.children).find((item) => texts.includes(item.prompt))
      if (child)
        return Stream.unwrap(
          Deferred.succeed(child.started, undefined).pipe(
            Effect.andThen(Deferred.await(child.release)),
            Effect.as(Stream.fromIterable(completed(`text-${child.prompt}`, child.result))),
          ),
        )

      const index = current.parentRequests.push(request) - 1
      const signal = current.parentStarted[index]
        ? Deferred.succeed(current.parentStarted[index], undefined)
        : Effect.void
      const gate = index === 1 && current.parentGate ? Deferred.await(current.parentGate) : Effect.void
      const events =
        index === 0
          ? taskCalls.map((event) => {
              if (!LLMEvent.is.toolCall(event)) return event
              return LLMEvent.toolCall({
                id: event.id,
                name: event.name,
                input: {
                  ...(event.input as Record<string, unknown>),
                  prompt: event.id === "call-child-a" ? current.children.A.prompt : current.children.B.prompt,
                },
              })
            })
          : completed(`text-parent-${index}`, `parent response ${index}`)
      return Stream.unwrap(signal.pipe(Effect.andThen(gate), Effect.as(Stream.fromIterable(events))))
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const agents = [
  AgentV2.Info.make({
    id: AgentV2.ID.make("build"),
    request: { headers: {}, body: {} },
    mode: "primary",
    hidden: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  }),
  AgentV2.Info.make({
    id: AgentV2.ID.make("general"),
    request: { headers: {}, body: {} },
    mode: "subagent",
    hidden: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  }),
]

const agentLayer = Layer.succeed(
  AgentV2.Service,
  AgentV2.Service.of({
    get: (id: AgentV2.ID) => Effect.succeed(agents.find((agent) => agent.id === id)),
    default: () => Effect.succeed(agents[0]),
    resolve: (id?: AgentV2.ID | string) => Effect.succeed(agents.find((agent) => agent.id === (id ?? "build"))),
    select: (id?: AgentV2.ID | string) => {
      const selected = AgentV2.ID.make(id ?? "build")
      return Effect.succeed({ id: selected, info: agents.find((agent) => agent.id === selected) })
    },
    all: () => Effect.succeed(agents),
  } as unknown as AgentV2.Interface),
)

const configLayer = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            subagent_depth: 1,
            subagent_max_concurrency: 2,
            compaction: new ConfigCompaction.Info({ buffer: 3_000 }),
          }),
        }),
      ]),
  }),
)

const permissionLayer = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const projectLayer = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const attachmentLayer = Layer.succeed(
  SessionAttachment.Service,
  SessionAttachment.Service.of({
    materializeFile: (file) => Effect.succeed(file),
    materialize: (prompt) => Effect.succeed(prompt),
  }),
)

const promptExpansionLayer = Layer.succeed(
  SessionPromptExpansion.Service,
  SessionPromptExpansion.Service.of({
    resolve: (prompt) => Effect.succeed(prompt),
    materializeAgents: (prompt) => Effect.succeed(prompt),
    command: () => Effect.die("unused"),
  }),
)

const locationLayer = Layer.succeed(Location.Service, Location.Service.of(location(locationRef)))
const modelLayer = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const skillGuidanceLayer = Layer.succeed(
  SkillGuidance.Service,
  SkillGuidance.Service.of({ load: () => Effect.succeed(SystemContext.empty) }),
)
const referenceGuidanceLayer = Layer.succeed(
  ReferenceGuidance.Service,
  ReferenceGuidance.Service.of({ load: () => Effect.succeed(SystemContext.empty) }),
)
const nestedInstructionLayer = Layer.succeed(
  InstructionContext.NestedService,
  InstructionContext.NestedService.of({ load: () => Effect.succeed(SystemContext.empty) }),
)

const locationRoot = LayerNode.group([
  PluginRuntime.node,
  SessionAttachment.node,
  SessionPromptExpansion.node,
  ToolRegistry.node,
  ToolRegistry.toolsNode,
  TaskTool.node,
  SessionRunnerLLM.node,
])

const locationMapLayer = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const commands = yield* SessionCommand.Service
    const sessions = yield* SessionStore.Service
    const jobs = yield* BackgroundJob.Service
    const applications = yield* ApplicationTools.Service
    const cancellation = yield* TaskCancellation.Service
    const notifications = yield* TaskNotification.Service
    const submissions = yield* TaskSubmission.Service
    const progress = yield* ToolProgress.Service
    const layer = AppNodeBuilder.build(locationRoot, [
      [Database.node, Layer.succeed(Database.Service, database)],
      [EventV2.node, Layer.succeed(EventV2.Service, events)],
      [SessionCommand.node, Layer.succeed(SessionCommand.Service, commands)],
      [SessionStore.node, Layer.succeed(SessionStore.Service, sessions)],
      [BackgroundJob.node, Layer.succeed(BackgroundJob.Service, jobs)],
      [ApplicationTools.node, Layer.succeed(ApplicationTools.Service, applications)],
      [TaskCancellation.node, Layer.succeed(TaskCancellation.Service, cancellation)],
      [TaskNotification.node, Layer.succeed(TaskNotification.Service, notifications)],
      [TaskSubmission.node, Layer.succeed(TaskSubmission.Service, submissions)],
      [ToolProgress.node, Layer.succeed(ToolProgress.Service, progress)],
      [SessionExecution.node, SessionExecution.forwardingLayer],
      [LayerNodePlatform.llmClient, client],
      [AgentV2.node, agentLayer],
      [Config.node, configLayer],
      [Location.node, locationLayer],
      [MCP.node, MCP.emptyLayer],
      [PermissionV2.node, permissionLayer],
      [SessionAttachment.node, attachmentLayer],
      [SessionPromptExpansion.node, promptExpansionLayer],
      [SessionRunnerModel.node, modelLayer],
      [SkillGuidance.node, skillGuidanceLayer],
      [ReferenceGuidance.node, referenceGuidanceLayer],
      [InstructionContext.nestedNode, nestedInstructionLayer],
      [Snapshot.node, Snapshot.noopLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ])
    return LocationServiceMap.Service.of(
      yield* LayerMap.make((_ref: Location.Ref) => layer as unknown as Layer.Layer<LocationServices>, {
        idleTimeToLive: "1 minute",
      }),
    )
  }),
)

const locationMapNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: locationMapLayer,
  deps: [
    Database.node,
    EventV2.node,
    SessionCommand.node,
    SessionStore.node,
    BackgroundJob.node,
    ApplicationTools.node,
    TaskCancellation.node,
    TaskNotification.node,
    TaskSubmission.node,
    ToolProgress.node,
  ],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionCommand.node,
      SessionV2.node,
      SessionExecution.node,
      LocationServiceMap.node,
      BackgroundJob.node,
      ApplicationTools.node,
      TaskCancellation.node,
      TaskNotification.node,
      TaskSubmission.node,
      ToolProgress.node,
    ]),
    [
      [ProjectV2.node, projectLayer],
      [LocationServiceMap.node, locationMapNode],
      [SessionExecution.node, SessionExecutionLocal.node],
    ],
  ),
)

const makeScenario = (name: string, gateParent = false) =>
  Effect.gen(function* () {
    return {
      parentPrompt: `parent ${name}`,
      parentRequests: [],
      parentStarted: yield* Effect.forEach(Array.from({ length: 6 }), () => Deferred.make<void>()),
      parentGate: gateParent ? yield* Deferred.make<void>() : undefined,
      children: {
        A: {
          prompt: `child A ${name}`,
          result: `result A ${name}`,
          started: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        },
        B: {
          prompt: `child B ${name}`,
          result: `result B ${name}`,
          started: yield* Deferred.make<void>(),
          release: yield* Deferred.make<void>(),
        },
      },
    } satisfies Scenario
  })

const awaitSignal = (label: string, deferred: Deferred.Deferred<void>) =>
  Effect.raceFirst(
    Deferred.await(deferred),
    Effect.promise(() => Bun.sleep(5_000)).pipe(
      Effect.andThen(Effect.fail(new Error(`Timed out waiting for ${label}`))),
    ),
  )

const createParent = (session: SessionV2.Interface, id: SessionSchema.ID, prompt: string) =>
  Effect.gen(function* () {
    yield* session.create({
      id,
      location: locationRef,
      title: prompt,
      agent: AgentV2.ID.make("build"),
      model: modelRef,
    })
    yield* session.prompt({ sessionID: id, prompt: Prompt.make({ text: prompt }) })
  })

const submissionsFor = (db: Database.Interface["db"], parentSessionID: SessionSchema.ID) =>
  db
    .select()
    .from(TaskSubmissionTable)
    .where(eq(TaskSubmissionTable.parent_session_id, parentSessionID))
    .orderBy(asc(TaskSubmissionTable.tool_call_id))
    .all()
    .pipe(Effect.orDie)

const rebuildExecution = (parentSessionID: SessionSchema.ID, started: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const events = yield* EventV2.Service
    const locations = yield* LocationServiceMap.Service
    const commands = yield* SessionCommand.Service
    const sessions = yield* SessionStore.Service
    const notifications = yield* TaskNotification.Service
    const submissions = yield* TaskSubmission.Service
    const layer = LayerNode.compile(SessionExecutionLocal.node, [
      [Database.node, Layer.succeed(Database.Service, database)],
      [EventV2.node, Layer.succeed(EventV2.Service, events)],
      [LocationServiceMap.node, Layer.succeed(LocationServiceMap.Service, locations)],
      [SessionCommand.node, Layer.succeed(SessionCommand.Service, commands)],
      [SessionStore.node, Layer.succeed(SessionStore.Service, sessions)],
      [TaskNotification.node, Layer.succeed(TaskNotification.Service, notifications)],
      [TaskSubmission.node, Layer.succeed(TaskSubmission.Service, submissions)],
    ])
    yield* Effect.gen(function* () {
      const execution = yield* SessionExecution.Service
      yield* Deferred.await(started)
      yield* execution.wait(parentSessionID)
    }).pipe(Effect.provide(layer))
  })

describe("event-driven subagent loop", () => {
  it.effect("resumes the parent independently after each child completes", () =>
    Effect.gen(function* () {
      scenario = yield* makeScenario("independent")
      const parentSessionID = SessionSchema.ID.make("ses_subagent_parent_independent")
      const session = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      const background = yield* BackgroundJob.Service
      const { db } = yield* Database.Service

      yield* createParent(session, parentSessionID, scenario.parentPrompt)
      yield* awaitSignal("parent continuation", scenario.parentStarted[1]!)
      const settled = toolResultParts(scenario.parentRequests[1]!)
      if (settled.length === 0)
        return yield* Effect.fail(
          new Error(`Parent continuation messages: ${JSON.stringify(scenario.parentRequests[1]!.messages)}`),
        )
      yield* Effect.all(
        Object.entries(scenario.children).map(([name, child]) => awaitSignal(`child ${name}`, child.started)),
        {
          discard: true,
        },
      )
      yield* execution.wait(parentSessionID)

      const submissions = yield* submissionsFor(db, parentSessionID)
      expect(submissions).toHaveLength(2)
      const first = submissions.find((item) => item.tool_call_id === "call-child-a")!
      const second = submissions.find((item) => item.tool_call_id === "call-child-b")!
      const running = settled.filter(
        (part) =>
          part.result.type === "text" &&
          typeof part.result.value === "string" &&
          part.result.value.includes('state="running"'),
      )
      expect(running).toHaveLength(2)
      expect(running).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: first.tool_call_id,
            name: "task",
            result: expect.objectContaining({
              type: "text",
              value: expect.stringContaining(`<task id="${first.child_session_id}" state="running">`),
            }),
          }),
          expect.objectContaining({
            id: second.tool_call_id,
            name: "task",
            result: expect.objectContaining({
              type: "text",
              value: expect.stringContaining(`<task id="${second.child_session_id}" state="running">`),
            }),
          }),
        ]),
      )
      expect((yield* background.get(first.child_session_id))?.status).toBe("running")
      expect((yield* background.get(second.child_session_id))?.status).toBe("running")
      const active = yield* execution.active
      expect(active.has(first.child_session_id)).toBe(true)
      expect(active.has(second.child_session_id)).toBe(true)

      yield* Deferred.succeed(scenario.children.A.release, undefined)
      expect((yield* background.wait({ id: first.child_session_id })).outcome).toBe("completed")
      yield* Deferred.await(scenario.parentStarted[2]!)
      yield* execution.wait(parentSessionID)

      const firstOutbox = yield* db
        .select()
        .from(TaskNotificationOutboxTable)
        .where(eq(TaskNotificationOutboxTable.submission_id, first.id))
        .all()
        .pipe(Effect.orDie)
      expect(firstOutbox).toHaveLength(1)
      expect(userTexts(scenario.parentRequests[2]!).join("\n")).toContain(`<task id="${first.child_session_id}"`)
      expect(userTexts(scenario.parentRequests[2]!).join("\n")).toContain(scenario.children.A.result)
      expect((yield* background.get(second.child_session_id))?.status).toBe("running")
      const activeAfterFirst = yield* execution.active
      expect(activeAfterFirst.has(second.child_session_id)).toBe(true)

      yield* Deferred.succeed(scenario.children.B.release, undefined)
      expect((yield* background.wait({ id: second.child_session_id })).outcome).toBe("completed")
      yield* Deferred.await(scenario.parentStarted[3]!)
      yield* execution.wait(parentSessionID)

      expect(userTexts(scenario.parentRequests[3]!).join("\n")).toContain(`<task id="${second.child_session_id}"`)
      expect(userTexts(scenario.parentRequests[3]!).join("\n")).toContain(scenario.children.B.result)
    }),
  )

  it.effect("coalesces two child completions without losing or duplicating either result", () =>
    Effect.gen(function* () {
      scenario = yield* makeScenario("coalesced", true)
      const parentSessionID = SessionSchema.ID.make("ses_subagent_parent_coalesced")
      const session = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      const background = yield* BackgroundJob.Service
      const { db } = yield* Database.Service

      yield* createParent(session, parentSessionID, scenario.parentPrompt)
      yield* Deferred.await(scenario.parentStarted[1]!)
      yield* Effect.all(
        Object.values(scenario.children).map((child) => Deferred.await(child.started)),
        {
          discard: true,
        },
      )
      const submissions = yield* submissionsFor(db, parentSessionID)
      const first = submissions.find((item) => item.tool_call_id === "call-child-a")!
      const second = submissions.find((item) => item.tool_call_id === "call-child-b")!

      yield* Effect.all(
        [
          Deferred.succeed(scenario.children.A.release, undefined),
          Deferred.succeed(scenario.children.B.release, undefined),
        ],
        { discard: true },
      )
      yield* Effect.all(
        [background.wait({ id: first.child_session_id }), background.wait({ id: second.child_session_id })],
        { concurrency: "unbounded", discard: true },
      )

      const expectedIDs = [TaskSubmission.notificationID(first.id), TaskSubmission.notificationID(second.id)].toSorted()
      const inputs = yield* db
        .select({ id: SessionInputTable.id })
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, parentSessionID))
        .all()
        .pipe(Effect.orDie)
      expect(
        inputs
          .map((input) => input.id)
          .filter((id) => expectedIDs.includes(id))
          .toSorted(),
      ).toEqual(expectedIDs)
      expect(
        yield* db
          .select()
          .from(TaskNotificationOutboxTable)
          .where(eq(TaskNotificationOutboxTable.parent_session_id, parentSessionID))
          .all()
          .pipe(Effect.orDie),
      ).toHaveLength(2)

      expect(scenario.parentRequests).toHaveLength(2)
      expect((yield* Deferred.poll(scenario.parentStarted[2]!))._tag).toBe("None")
      yield* Deferred.succeed(scenario.parentGate!, undefined)
      yield* Deferred.await(scenario.parentStarted[2]!)
      yield* execution.wait(parentSessionID)

      const texts = userTexts(scenario.parentRequests[2]!)
      expect(texts.filter((text) => text.includes(`<task id="${first.child_session_id}"`))).toHaveLength(1)
      expect(texts.filter((text) => text.includes(`<task id="${second.child_session_id}"`))).toHaveLength(1)
      expect(texts.join("\n")).toContain(scenario.children.A.result)
      expect(texts.join("\n")).toContain(scenario.children.B.result)
    }),
  )

  it.effect("replays a delivered notification after restart without re-admitting its synthetic input", () =>
    Effect.gen(function* () {
      scenario = yield* makeScenario("restart")
      const parentSessionID = SessionSchema.ID.make("ses_subagent_parent_restart")
      const childSessionID = SessionSchema.ID.make("ses_subagent_child_restart")
      const session = yield* SessionV2.Service
      const commands = yield* SessionCommand.Service
      const notifications = yield* TaskNotification.Service
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service

      yield* session.create({
        id: parentSessionID,
        location: locationRef,
        agent: AgentV2.ID.make("build"),
        model: modelRef,
      })
      yield* session.create({
        id: childSessionID,
        parentID: parentSessionID,
        location: locationRef,
        agent: AgentV2.ID.make("general"),
        model: modelRef,
      })
      const submission = yield* submissions.submit({
        parentSessionID,
        assistantMessageID: SessionMessage.ID.make("msg_subagent_restart_assistant"),
        toolCallID: "call-subagent-restart",
        childSessionID,
        description: "Restart child",
        prompt: Prompt.make({ text: "restart child" }),
        agent: "general",
        completionDelivery: "parent",
      })
      yield* submissions.terminalize({
        submissionID: submission.id,
        outcome: "completed",
        resultText: "restart result",
      })
      expect(
        yield* notifications.drain({
          admit: (notification) => commands.admitSynthetic(notification).pipe(Effect.asVoid),
          wake: () => Effect.void,
        }),
      ).toBe(1)

      const outbox = (yield* db.select().from(TaskNotificationOutboxTable).all().pipe(Effect.orDie)).find(
        (row) => row.submission_id === submission.id,
      )!
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({ status: "delivered", time_woken: null })
        .where(eq(TaskNotificationOutboxTable.id, outbox.id))
        .run()
        .pipe(Effect.orDie)
      const before = yield* db
        .select()
        .from(SessionInputTable)
        .where(and(eq(SessionInputTable.session_id, parentSessionID), eq(SessionInputTable.id, outbox.message_id)))
        .all()
        .pipe(Effect.orDie)
      expect(before).toHaveLength(1)

      yield* rebuildExecution(parentSessionID, scenario.parentStarted[0]!)

      const after = yield* db
        .select()
        .from(SessionInputTable)
        .where(and(eq(SessionInputTable.session_id, parentSessionID), eq(SessionInputTable.id, outbox.message_id)))
        .all()
        .pipe(Effect.orDie)
      expect(after).toHaveLength(1)
      expect(userTexts(scenario.parentRequests[0]!).join("\n")).toContain(`<task id="${childSessionID}"`)
      const replayed = yield* db
        .select()
        .from(TaskNotificationOutboxTable)
        .where(eq(TaskNotificationOutboxTable.id, outbox.id))
        .get()
        .pipe(Effect.orDie)
      expect(replayed).toMatchObject({ status: "woken", attempts: outbox.attempts + 1 })
      expect(replayed?.time_woken).not.toBeNull()
      expect(
        yield* notifications.drain({
          admit: () => Effect.die("duplicate admission"),
          wake: () => Effect.die("duplicate wake"),
        }),
      ).toBe(0)
    }),
  )
})
