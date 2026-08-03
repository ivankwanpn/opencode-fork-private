import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { TaskNotification } from "@opencode-ai/core/session/task-notification"
import { TaskCancellation } from "@opencode-ai/core/session/task-cancellation"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { TaskTool } from "@opencode-ai/core/tool/task"
import { ToolProgress } from "@opencode-ai/core/tool/progress"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const parentID = SessionSchema.ID.make("ses_task_parent")
const rootID = SessionSchema.ID.make("ses_task_root")
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = ModelV2.Ref.make({ id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") })
const sessions = new Map<SessionSchema.ID, SessionSchema.Info>()
const contexts = new Map<SessionSchema.ID, SessionMessage.Message[]>()
const agents = new Map<AgentV2.ID, AgentV2.Info>()
const assertions: PermissionV2.AssertInput[] = []
const admissions: Parameters<SessionCommand.Interface["admit"]>[0][] = []
const syntheticAdmissions: Parameters<SessionCommand.Interface["admitSynthetic"]>[0][] = []
const progressUpdates: ToolProgress.Update[] = []
const resumed: SessionSchema.ID[] = []
const interrupted: SessionSchema.ID[] = []
const woken: SessionSchema.ID[] = []
const taskSubmissions = new Map<string, TaskSubmission.Info>()
const taskInputIDs = new Map<SessionSchema.ID, SessionMessage.ID>()
const taskInputHistory = new Map<SessionSchema.ID, SessionMessage.ID[]>()
const deliveredTaskSubmissions = new Set<string>()
let depth = 1
let childSequence = 0
let createCount = 0
let notificationSignal: Deferred.Deferred<void> | undefined
let interruptedSignal: Deferred.Deferred<void> | undefined
let resumeHandler: SessionExecution.Interface["resume"]

const info = (input: {
  id: SessionSchema.ID
  parentID?: SessionSchema.ID
  agent?: AgentV2.ID
  model?: ModelV2.Ref
  title?: string
}) =>
  SessionSchema.Info.make({
    id: input.id,
    parentID: input.parentID,
    projectID: ProjectV2.ID.global,
    title: input.title ?? "test",
    agent: input.agent,
    model: input.model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location,
  })

const assistant = (text: string) =>
  SessionMessage.Assistant.make({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "general",
    model,
    content: [{ type: "text", id: "text_task", text }],
    time: { created: DateTime.makeUnsafe(1), completed: DateTime.makeUnsafe(2) },
  })

const childContext = (sessionID: SessionSchema.ID, text: string) => [
  ...(taskInputHistory.get(sessionID) ?? [taskInputIDs.get(sessionID) ?? SessionMessage.ID.create()]).map((id) =>
    SessionMessage.User.make({
      id,
      type: "user",
      text: "task input",
      time: { created: DateTime.makeUnsafe(1) },
    }),
  ),
  assistant(text),
]

const renderTaskResult = (input: {
  sessionID: SessionSchema.ID
  state: "completed" | "error"
  summary: string
  text: string
}) =>
  [
    `<task id="${input.sessionID}" state="${input.state}">`,
    `<summary>${input.summary}</summary>`,
    `<${input.state === "error" ? "task_error" : "task_result"}>`,
    input.text,
    `</${input.state === "error" ? "task_error" : "task_result"}>`,
    "</task>",
  ].join("\n")

const reset = () => {
  sessions.clear()
  contexts.clear()
  agents.clear()
  assertions.length = 0
  admissions.length = 0
  syntheticAdmissions.length = 0
  progressUpdates.length = 0
  resumed.length = 0
  interrupted.length = 0
  woken.length = 0
  taskSubmissions.clear()
  taskInputIDs.clear()
  taskInputHistory.clear()
  deliveredTaskSubmissions.clear()
  depth = 1
  childSequence = 0
  createCount = 0
  notificationSignal = undefined
  interruptedSignal = undefined
  sessions.set(rootID, info({ id: rootID, agent: AgentV2.ID.make("build"), model }))
  sessions.set(parentID, info({ id: parentID, agent: AgentV2.ID.make("build"), model }))
  agents.set(
    AgentV2.ID.make("build"),
    AgentV2.Info.make({
      id: AgentV2.ID.make("build"),
      request: { headers: {}, body: {} },
      mode: "primary",
      hidden: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  )
  agents.set(
    AgentV2.ID.make("general"),
    AgentV2.Info.make({
      id: AgentV2.ID.make("general"),
      request: { headers: {}, body: {} },
      mode: "subagent",
      hidden: false,
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  )
  resumeHandler = (sessionID) =>
    Effect.sync(() => {
      resumed.push(sessionID)
      contexts.set(sessionID, childContext(sessionID, "subagent result"))
    })
}

const agentLayer = Layer.succeed(
  AgentV2.Service,
  AgentV2.Service.of({
    get: (id: AgentV2.ID) => Effect.succeed(agents.get(id)),
    default: () => Effect.succeed(agents.get(AgentV2.ID.make("build"))),
    resolve: (id?: AgentV2.ID | string) =>
      Effect.succeed(id ? agents.get(AgentV2.ID.make(id)) : agents.get(AgentV2.ID.make("build"))),
    select: (id?: AgentV2.ID | string) => {
      const selected = AgentV2.ID.make(id ?? "build")
      return Effect.succeed({ id: selected, info: agents.get(selected) })
    },
    all: () => Effect.succeed(Array.from(agents.values())),
  } as unknown as AgentV2.Interface),
)

const makeConfigLayer = (maxConcurrency?: number) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () =>
        Effect.succeed([
          new Config.Document({
            type: "document",
            info: new Config.Info({
              subagent_depth: depth,
              ...(maxConcurrency === undefined ? {} : { subagent_max_concurrency: maxConcurrency }),
            }),
          }),
        ]),
    }),
  )

const configLayer = makeConfigLayer()

const permissionLayer = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const storeLayer = Layer.succeed(
  SessionStore.Service,
  SessionStore.Service.of({
    get: (sessionID) => Effect.succeed(sessions.get(sessionID)),
    context: (sessionID) => Effect.succeed(contexts.get(sessionID) ?? []),
    runnerContext: (sessionID) => Effect.succeed(contexts.get(sessionID) ?? []),
    latestPrompt: () => Effect.succeed(undefined),
    message: () => Effect.succeed(undefined),
  }),
)

const commandLayer = Layer.succeed(
  SessionCommand.Service,
  SessionCommand.Service.of({
    create: (input) =>
      Effect.gen(function* () {
        createCount++
        const id = input.id ?? SessionSchema.ID.make(`ses_task_child_${++childSequence}`)
        const created = info({
          id,
          parentID: input.parentID,
          agent: input.agent,
          model: input.model,
          title: input.title,
        })
        sessions.set(id, created)
        return created
      }),
    plan: () => Effect.die("unused"),
    synthetic: () => Effect.die("unused"),
    switchAgent: (input) =>
      Effect.sync(() => {
        const current = sessions.get(input.sessionID)
        if (current) sessions.set(input.sessionID, { ...current, agent: AgentV2.ID.make(input.agent) })
      }),
    switchModel: (input) =>
      Effect.sync(() => {
        const current = sessions.get(input.sessionID)
        if (current) sessions.set(input.sessionID, { ...current, model: input.model })
      }),
    admitSynthetic: (input) =>
      Effect.gen(function* () {
        syntheticAdmissions.push(input)
        if (notificationSignal) yield* Deferred.succeed(notificationSignal, undefined)
        return SessionInput.Admitted.make({
          admittedSeq: admissions.length + syntheticAdmissions.length,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          prompt: { text: input.text },
          synthetic: { description: input.description },
          delivery: input.delivery ?? "steer",
          timeCreated: yield* DateTime.now,
        })
      }),
    admit: (input) =>
      Effect.gen(function* () {
        admissions.push(input)
        return SessionInput.Admitted.make({
          admittedSeq: admissions.length,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          prompt: { text: input.prompt.text },
          delivery: input.delivery ?? "steer",
          timeCreated: yield* DateTime.now,
        })
      }),
  }),
)

const executionLayer = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: (sessionID) => resumeHandler(sessionID),
    exclusive: (_sessionID, work) => work,
    wake: (sessionID) => Effect.sync(() => woken.push(sessionID)),
    wait: () => Effect.void,
    interrupt: (sessionID) =>
      Effect.gen(function* () {
        interrupted.push(sessionID)
        if (interruptedSignal) yield* Deferred.succeed(interruptedSignal, undefined)
      }),
  }),
)

const taskSubmissionLayer = Layer.succeed(
  TaskSubmission.Service,
  TaskSubmission.Service.of({
    submit: (input) =>
      Effect.sync(() => {
        const key = `${input.parentSessionID}:${input.assistantMessageID}:${input.toolCallID}`
        const existing = Array.from(taskSubmissions.values()).find(
          (submission) =>
            `${submission.parentSessionID}:${submission.assistantMessageID}:${submission.toolCallID}` === key,
        )
        if (existing) return existing
        const id = `sub_task_test_${taskSubmissions.size}`
        const childInputID = TaskSubmission.inputID(input)
        const info: TaskSubmission.Info = {
          id,
          parentSessionID: input.parentSessionID,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.toolCallID,
          childSessionID: input.childSessionID,
          childInputID,
          description: input.description,
          prompt: input.prompt,
          agent: input.agent,
          model: input.model,
          status: "accepted",
          timeCreated: 0,
        }
        taskSubmissions.set(id, info)
        taskInputIDs.set(input.childSessionID, childInputID)
        taskInputHistory.set(input.childSessionID, [
          ...(taskInputHistory.get(input.childSessionID) ?? []),
          childInputID,
        ])
        admissions.push({
          sessionID: input.childSessionID,
          prompt: { text: input.prompt.text },
          delivery: "steer",
        })
        return info
      }),
    get: (id) => Effect.succeed(taskSubmissions.get(id)),
    claim: (id) =>
      Effect.gen(function* () {
        const info = taskSubmissions.get(id)
        if (!info) return yield* new TaskSubmission.Missing({ id })
        if (info.status !== "accepted") return { acquired: false, info }
        const claimed = { ...info, status: "running" as const }
        taskSubmissions.set(id, claimed)
        return { acquired: true, info: claimed }
      }),
    terminalize: (input) =>
      Effect.sync(() => {
        const info = taskSubmissions.get(input.submissionID)
        if (!info) return undefined
        if (info.outcome) return info
        const settled: TaskSubmission.Info = {
          ...info,
          status: input.outcome === "completed" ? "completed" : input.outcome,
          outcome: input.outcome,
          resultMessageID: input.resultMessageID,
          resultText: input.resultText,
          error: input.error,
          timeCompleted: 1,
        }
        taskSubmissions.set(input.submissionID, settled)
        return settled
      }),
    recoverSession: () => Effect.succeed(0),
    recoverCompleted: () => Effect.succeed(0),
    markRecoveryRequired: () => Effect.succeed(0),
  }),
)

const taskNotificationLayer = Layer.succeed(
  TaskNotification.Service,
  TaskNotification.Service.of({
    drain: (_input) =>
      Effect.gen(function* () {
        const completed = Array.from(taskSubmissions.values()).filter(
          (submission) => submission.outcome && !deliveredTaskSubmissions.has(submission.id),
        )
        completed.forEach((submission) => {
          deliveredTaskSubmissions.add(submission.id)
          const state = submission.outcome === "error" ? "error" : "completed"
          const text = submission.resultText ?? String(submission.error ?? "")
          syntheticAdmissions.push({
            id: TaskSubmission.notificationID(submission.id),
            sessionID: submission.parentSessionID,
            text: renderTaskResult({
              sessionID: submission.childSessionID,
              state,
              summary: `${state === "completed" ? "Background task completed" : "Background task failed"}: ${submission.description}`,
              text,
            }),
            description: `${state === "completed" ? "Background task completed" : "Background task failed"}: ${submission.description}`,
            delivery: "steer",
          })
          woken.push(submission.parentSessionID)
        })
        if (completed.length > 0 && notificationSignal)
          yield* Deferred.succeed(notificationSignal, undefined).pipe(Effect.ignore)
        return completed.length
      }),
  }),
)

const taskCancellationLayer = Layer.succeed(
  TaskCancellation.Service,
  TaskCancellation.Service.of({
    cancelTree: (input) =>
      Effect.gen(function* () {
        yield* input.interrupt(input.rootSessionID)
        yield* input.wait(input.rootSessionID)
        return { sessionIDs: [input.rootSessionID], submissionIDs: [] }
      }),
  }),
)

const progressLayer = Layer.succeed(
  ToolProgress.Service,
  ToolProgress.Service.of({
    publish: (_context, update) => Effect.sync(() => progressUpdates.push(update)),
  }),
)

const makeLayer = (background?: boolean, replacements: LayerNode.Replacements = []) => {
  const taskNode = background === undefined ? TaskTool.node : TaskTool.nodeWithOptions({ background })
  return AppNodeBuilder.build(
    LayerNode.group([BackgroundJob.node, ToolRegistry.node, ToolRegistry.toolsNode, taskNode]),
    [
      [AgentV2.node, agentLayer],
      [Config.node, configLayer],
      [PermissionV2.node, permissionLayer],
      [SessionCommand.node, commandLayer],
      [SessionExecution.node, executionLayer],
      [SessionStore.node, storeLayer],
      [TaskNotification.node, taskNotificationLayer],
      [TaskCancellation.node, taskCancellationLayer],
      [TaskSubmission.node, taskSubmissionLayer],
      [ToolProgress.node, progressLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ...replacements,
    ],
  )
}

const defaultCapability = testEffect(makeLayer())
const foreground = testEffect(makeLayer(false))
const background = testEffect(makeLayer(true))
const foregroundLimited = testEffect(makeLayer(false, [[Config.node, makeConfigLayer(2)]]))
const foregroundFastCompletion = testEffect(
  makeLayer(false, [
    [
      BackgroundJob.node,
      Layer.succeed(
        BackgroundJob.Service,
        BackgroundJob.Service.of({
          list: () => Effect.succeed([]),
          get: () => Effect.succeed(undefined),
          start: (input) =>
            Effect.succeed({
              id: input.id ?? "job_fast_completion",
              type: input.type,
              title: input.title,
              status: "running",
              started_at: 0,
              metadata: input.metadata,
            }),
          extend: () => Effect.succeed(false),
          wait: (input) =>
            Effect.yieldNow.pipe(
              Effect.as({
                timedOut: false,
                outcome: "completed" as const,
                info: {
                  id: input.id,
                  type: TaskTool.name,
                  status: "completed" as const,
                  started_at: 0,
                  completed_at: 1,
                  output: "fast result",
                },
              }),
            ),
          waitForPromotion: () => Effect.succeed(undefined),
          promote: () => Effect.succeed(undefined),
          cancel: () => Effect.succeed(undefined),
        }),
      ),
    ],
  ]),
)
const foregroundStaleObservation = testEffect(
  makeLayer(false, [
    [
      BackgroundJob.node,
      Layer.succeed(
        BackgroundJob.Service,
        BackgroundJob.Service.of({
          list: () => Effect.succeed([]),
          get: (id) =>
            Effect.succeed({
              id,
              type: TaskTool.name,
              status: "running",
              started_at: 0,
              metadata: { background: true },
            }),
          start: (input) =>
            Effect.succeed({
              id: input.id ?? "job_fresh_start",
              type: input.type,
              title: input.title,
              status: "running",
              started_at: 1,
              metadata: input.metadata,
            }),
          extend: () => Effect.succeed(false),
          wait: (input) =>
            Effect.succeed({
              timedOut: false,
              outcome: "completed" as const,
              info: {
                id: input.id,
                type: TaskTool.name,
                status: "completed" as const,
                started_at: 1,
                completed_at: 2,
                output: "fresh result",
              },
            }),
          waitForPromotion: () => Effect.succeed(undefined),
          promote: () => Effect.succeed(undefined),
          cancel: () => Effect.succeed(undefined),
        }),
      ),
    ],
  ]),
)

const call = (input: typeof TaskTool.Input.Type, id = "call-task", agent = toolIdentity.agent) => ({
  sessionID: parentID,
  ...toolIdentity,
  agent,
  call: { type: "tool-call" as const, id, name: TaskTool.name, input },
})

const input = {
  description: "Inspect task flow",
  prompt: "Inspect the implementation and report findings",
  subagent_type: "general",
}

describe("TaskTool", () => {
  defaultCapability.effect("exposes background mode to the model by default", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const definition = (yield* toolDefinitions(registry))[0]

      expect((definition?.inputSchema.properties as Record<string, unknown> | undefined)?.background).toBeDefined()
    }),
  )

  foreground.effect("hides background mode from the model when the experiment is disabled", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const definition = (yield* toolDefinitions(registry))[0]

      expect(definition?.inputSchema).toMatchObject({
        type: "object",
        properties: {
          description: expect.anything(),
          prompt: expect.anything(),
          subagent_type: expect.anything(),
        },
      })
      expect((definition?.inputSchema.properties as Record<string, unknown> | undefined)?.background).toBeUndefined()
    }),
  )

  background.effect("exposes background mode to the model when the experiment is enabled", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service
      const definition = (yield* toolDefinitions(registry))[0]

      expect((definition?.inputSchema.properties as Record<string, unknown> | undefined)?.background).toBeDefined()
    }),
  )

  foreground.effect("creates and executes a durable foreground child session", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([TaskTool.name])
      expect(yield* toolDefinitions(registry, [{ action: TaskTool.name, resource: "*", effect: "deny" }])).toEqual([])
      const settled = yield* settleTool(registry, call(input))
      const child = sessions.get(SessionSchema.ID.make("ses_task_child_1"))
      expect(child).toBeDefined()
      const childID = child!.id

      expect(child).toMatchObject({ parentID, agent: "general", model })
      expect(admissions).toMatchObject([{ sessionID: childID, prompt: { text: input.prompt }, delivery: "steer" }])
      expect(resumed).toEqual([childID])
      expect(assertions).toMatchObject([
        {
          action: "task",
          resources: ["general"],
          metadata: { description: input.description, subagent_type: "general" },
          sessionID: parentID,
        },
      ])
      expect(progressUpdates[0]).toMatchObject({
        structured: { title: input.description, metadata: { parentSessionId: parentID, sessionId: childID } },
      })
      expect(settled).toMatchObject({
        result: { type: "text", value: expect.stringContaining("subagent result") },
        output: {
          structured: {
            title: input.description,
            metadata: { parentSessionId: parentID, sessionId: childID, agent: "general" },
          },
        },
      })
    }),
  )

  foreground.effect("resumes an existing task session without creating another child", () =>
    Effect.gen(function* () {
      reset()
      const childID = SessionSchema.ID.make("ses_existing_task")
      sessions.set(childID, info({ id: childID, parentID, agent: AgentV2.ID.make("general"), model }))
      const registry = yield* ToolRegistry.Service

      const result = yield* executeTool(registry, call({ ...input, task_id: childID }))

      expect(result).toMatchObject({ type: "text", value: expect.stringContaining(`id="${childID}"`) })
      expect(createCount).toBe(0)
      expect(admissions[0]).toMatchObject({ sessionID: childID, prompt: { text: input.prompt } })
      expect(resumed).toEqual([childID])
    }),
  )

  foreground.effect("enforces depth, permission, and agent validation before child creation", () =>
    Effect.gen(function* () {
      reset()
      sessions.set(parentID, info({ id: parentID, parentID: rootID, agent: AgentV2.ID.make("general"), model }))
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call(input, "call-depth"))).toEqual({
        type: "error",
        value: 'Subagent depth limit reached (1). Increase "subagent_depth" to allow nested subagents.',
      })
      expect(assertions).toEqual([])

      depth = 2
      expect(yield* executeTool(registry, call({ ...input, subagent_type: "missing" }, "call-missing"))).toEqual({
        type: "error",
        value: "Unknown agent type: missing is not a valid agent type",
      })
      expect(yield* executeTool(registry, call(input, "call-nested-default-deny", AgentV2.ID.make("general")))).toEqual(
        { type: "error", value: "Permission denied: task general" },
      )
      expect(createCount).toBe(0)
    }),
  )

  foregroundLimited.effect("rejects a third concurrent child when the config limit is exceeded", () =>
    Effect.gen(function* () {
      reset()
      const release = yield* Deferred.make<void>()
      const twoStarted = yield* Deferred.make<void>()
      let startedCount = 0
      resumeHandler = (sessionID) =>
        Effect.gen(function* () {
          startedCount++
          if (startedCount === 2) yield* Deferred.succeed(twoStarted, undefined)
          yield* Deferred.await(release)
          contexts.set(sessionID, childContext(sessionID, "limited result"))
        })
      const registry = yield* ToolRegistry.Service

      const first = yield* executeTool(registry, call(input, "call-limit-1")).pipe(Effect.forkScoped)
      const second = yield* executeTool(registry, call(input, "call-limit-2")).pipe(Effect.forkScoped)
      yield* Deferred.await(twoStarted)

      expect(yield* executeTool(registry, call(input, "call-limit-3"))).toEqual({
        type: "error",
        value: "Subagent concurrency limit reached",
      })

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(second)
    }),
  )

  foreground.effect("rejects background mode when the experiment is disabled", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call({ ...input, background: true }))).toEqual({
        type: "error",
        value: "Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true",
      })
      expect(createCount).toBe(0)
    }),
  )

  background.effect("returns immediately and durably notifies the parent after background completion", () =>
    Effect.gen(function* () {
      reset()
      const release = yield* Deferred.make<void>()
      notificationSignal = yield* Deferred.make<void>()
      resumeHandler = (sessionID) =>
        Effect.sync(() => resumed.push(sessionID)).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(
            Effect.sync(() => {
              contexts.set(sessionID, childContext(sessionID, "background result"))
            }),
          ),
        )
      const registry = yield* ToolRegistry.Service
      const jobs = yield* BackgroundJob.Service

      const result = yield* executeTool(registry, call({ ...input, background: true }))
      const childID = SessionSchema.ID.make("ses_task_child_1")

      expect(result).toMatchObject({
        type: "text",
        value: expect.stringContaining(`id="${childID}" state="running"`),
      })
      expect((yield* jobs.get(childID))?.status).toBe("running")

      yield* Deferred.succeed(release, undefined)
      yield* Deferred.await(notificationSignal)
      yield* Effect.yieldNow

      expect((yield* jobs.wait({ id: childID })).info).toMatchObject({
        status: "completed",
        output: "background result",
      })
      expect(syntheticAdmissions).toEqual([
        expect.objectContaining({
          sessionID: parentID,
          description: "Background task completed: Inspect task flow",
          text: expect.stringContaining("<task_result>\nbackground result\n</task_result>"),
          delivery: "steer",
        }),
      ])
      expect(admissions.some((item) => item.sessionID === parentID)).toBe(false)
      expect(woken).toContain(parentID)
    }),
  )

  foregroundFastCompletion.effect(
    "returns a completed foreground result when promotion observation resolves undefined after fast completion",
    () =>
      Effect.gen(function* () {
        reset()
        const registry = yield* ToolRegistry.Service

        expect(yield* executeTool(registry, call(input, "call-fast-completion"))).toMatchObject({
          type: "text",
          value: expect.stringContaining("<task_result>\nfast result\n</task_result>"),
        })
      }),
  )

  foregroundStaleObservation.effect(
    "does not report background updated from a stale pre-start background snapshot",
    () =>
      Effect.gen(function* () {
        reset()
        const registry = yield* ToolRegistry.Service

        const result = yield* executeTool(registry, call(input, "call-stale-observation"))
        expect(result).toMatchObject({
          type: "text",
          value: expect.stringContaining("<task_result>\nfresh result\n</task_result>"),
        })
        if (result.type === "text") expect(String(result.value)).not.toContain("Background task updated")
      }),
  )

  background.effect("promotes a foreground task to background execution", () =>
    Effect.gen(function* () {
      reset()
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      notificationSignal = yield* Deferred.make<void>()
      resumeHandler = (sessionID) =>
        Effect.gen(function* () {
          resumed.push(sessionID)
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          contexts.set(sessionID, childContext(sessionID, "promoted result"))
        })
      const registry = yield* ToolRegistry.Service
      const jobs = yield* BackgroundJob.Service

      const running = yield* executeTool(registry, call(input, "call-promote")).pipe(Effect.forkScoped)
      const childID = SessionSchema.ID.make("ses_task_child_1")
      yield* Deferred.await(started)
      yield* jobs.promote(childID)

      expect(yield* Fiber.join(running)).toMatchObject({
        type: "text",
        value: expect.stringContaining('state="running"'),
      })
      yield* Deferred.succeed(release, undefined)
      yield* Deferred.await(notificationSignal)
      expect((yield* jobs.wait({ id: childID })).info?.status).toBe("completed")
    }),
  )

  background.effect("does not reuse an assistant after a later child input", () =>
    Effect.gen(function* () {
      reset()
      const release = yield* Deferred.make<void>()
      resumeHandler = (sessionID) =>
        Effect.gen(function* () {
          resumed.push(sessionID)
          yield* Deferred.await(release)
          contexts.set(sessionID, childContext(sessionID, "combined result"))
        })
      const registry = yield* ToolRegistry.Service
      const jobs = yield* BackgroundJob.Service

      yield* executeTool(registry, call({ ...input, background: true }, "call-first"))
      const childID = SessionSchema.ID.make("ses_task_child_1")
      yield* executeTool(registry, call({ ...input, task_id: childID, background: true }, "call-second"))

      yield* Deferred.succeed(release, undefined)
      yield* jobs.wait({ id: childID })

      const submissions = Array.from(taskSubmissions.values())
      expect(submissions.find((submission) => submission.toolCallID === "call-first")).not.toMatchObject({
        outcome: "completed",
        resultText: "combined result",
      })
      expect(submissions.find((submission) => submission.toolCallID === "call-second")).toMatchObject({
        outcome: "completed",
        resultText: "combined result",
      })
    }),
  )

  background.effect("cancels child execution when a foreground task is interrupted", () =>
    Effect.gen(function* () {
      reset()
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const interruptedDone = yield* Deferred.make<void>()
      interruptedSignal = interruptedDone
      resumeHandler = (sessionID) =>
        Effect.gen(function* () {
          resumed.push(sessionID)
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        })
      const registry = yield* ToolRegistry.Service
      const jobs = yield* BackgroundJob.Service

      const running = yield* executeTool(registry, call(input, "call-cancel")).pipe(Effect.forkScoped)
      const childID = SessionSchema.ID.make("ses_task_child_1")
      yield* Deferred.await(started)
      yield* Fiber.interrupt(running).pipe(Effect.forkScoped)

      expect((yield* jobs.wait({ id: childID })).info?.status).toBe("cancelled")
      yield* Deferred.await(interruptedDone)
      expect(interrupted).toContain(childID)
    }),
  )
})
