import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber, Layer, LayerMap, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import {
  AuthenticationReason,
  LLMClient,
  LLMError,
  LLMEvent,
  InvalidRequestReason,
  Model,
  RateLimitReason,
  ToolDefinition,
  TransportReason,
  type LLMClientShape,
  type LLMRequest,
} from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Node } from "@opencode-ai/core/effect/app-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionRouter } from "@opencode-ai/core/session/execution/router"
import { SessionInput } from "@opencode-ai/core/session/input"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { KernelPluginHost } from "@opencode-ai/core/session/kernel/plugin-host"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { eq } from "drizzle-orm"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const modelRef = ModelV2.Ref.make({ id: ModelV2.ID.make("fake-model"), providerID: ProviderV2.ID.make("fake") })

const textEvents = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-0" }),
  LLMEvent.textDelta({ id: "text-0", text: "Hello" }),
  LLMEvent.textDelta({ id: "text-0", text: "!" }),
  LLMEvent.textEnd({ id: "text-0" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const makeClient = () => {
  const responses: Array<() => Stream.Stream<LLMEvent, LLMError>> = []
  let streamGate: Deferred.Deferred<void> | undefined
  let streamStarted: Deferred.Deferred<void> | undefined
  const requests: LLMRequest[] = []
  const client = Layer.succeed(
    LLMClient.Service,
    LLMClient.Service.of({
      prepare: () => Effect.die("unused"),
      stream: ((request: LLMRequest) => {
        requests.push(request)
        const events = responses.shift()?.() ?? Stream.empty
        if (!streamGate) return events
        return Stream.unwrap(
          (streamStarted ? Deferred.succeed(streamStarted, undefined) : Effect.void).pipe(
            Effect.andThen(Deferred.await(streamGate)),
            Effect.as(events),
          ),
        )
      }) as unknown as LLMClientShape["stream"],
      generate: () => Effect.die("unused"),
    }),
  )
  return {
    client,
    responses,
    requests,
    setGate: (gate: Deferred.Deferred<void> | undefined) => {
      streamGate = gate
    },
    setStarted: (started: Deferred.Deferred<void> | undefined) => {
      streamStarted = started
    },
  }
}

// The mock client wraps mutable per-test state; the layer itself is stable so
// the graph can be built once.
const mock = makeClient()
const client = mock.client

const toolExecutions: string[] = []
const toolGenerations: Array<number | undefined> = []
let toolGate: Deferred.Deferred<void> | undefined
let toolStarted: Deferred.Deferred<void> | undefined
const tools = Layer.succeed(
  ToolRegistry.Service,
  ToolRegistry.Service.of({
    register: () => Effect.die("unused"),
    contribute: () => Effect.die("unused"),
    sources: () => Effect.succeed([]),
    materialize: () =>
      Effect.succeed({
        definitions: [
          new ToolDefinition({
            kind: "function",
            name: "echo",
            description: "Echo one text value",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          }),
        ],
        deferred: [],
        catalog: { revision: "test", tools: [], sources: [] },
        selected: new Map(),
        concurrency: new Map([["echo", "parallel" as const]]),
        settle: (input) =>
          Effect.gen(function* () {
            const value = String((input.call.input as { text?: unknown }).text ?? "")
            toolExecutions.push(value)
            toolGenerations.push(input.generation)
            if (value === "noncooperative") {
              const gate = toolGate
              yield* Effect.gen(function* () {
                if (toolStarted) yield* Deferred.succeed(toolStarted, undefined)
                yield* Effect.never
              }).pipe(Effect.onInterrupt(() => (gate ? Effect.uninterruptible(Deferred.await(gate)) : Effect.void)))
            }
            if (value === "blocked") {
              if (toolStarted) yield* Deferred.succeed(toolStarted, undefined)
              if (toolGate) yield* Deferred.await(toolGate)
            }
            return {
              result: { type: "text" as const, value: `echo:${value}` },
              output: { structured: { value }, content: [{ type: "text" as const, text: `echo:${value}` }] },
            }
          }),
      }),
  }),
)

const models = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({
    resolve: () => Effect.succeed(model),
  }),
)
const compactionInvocations: Array<Parameters<SessionCompaction.Interface["compact"]>[0]> = []
let compactionResult: SessionCompaction.Result = { compacted: true, shouldContinue: true }
const compaction = Layer.succeed(
  SessionCompaction.Service,
  SessionCompaction.Service.of({
    compact: (input) =>
      Effect.sync(() => {
        compactionInvocations.push(input)
        return compactionResult
      }),
  }),
)
const seamCalls: KernelPluginHost.SeamName[] = []
const seamEvents: Array<{ readonly name: KernelPluginHost.SeamName; readonly event: unknown }> = []
const pluginHost = Layer.succeed(
  KernelPluginHost.Service,
  KernelPluginHost.Service.of({
    install: () => Effect.die("unused"),
    disable: () => Effect.void,
    dispose: () => Effect.void,
    has: () => Effect.succeed(false),
    snapshot: () => Effect.succeed([]),
    ownedContributions: () => Effect.succeed([]),
    ui: { list: () => Effect.succeed([]) },
    services: {
      provide: () => Effect.void,
      retract: () => Effect.void,
      has: () => Effect.succeed(false),
      get: () => Effect.die("unused"),
      list: () => Effect.succeed([]),
    },
    seams: {
      register: () => Effect.succeed(Effect.void),
      active: () => Effect.succeed(0),
      run: (name, event, next?: () => Effect.Effect<unknown, KernelPluginHost.NextCalledError>) =>
        Effect.sync(() => {
          seamCalls.push(name)
          seamEvents.push({ name, event })
        }).pipe(
          Effect.andThen(
            name === KernelPluginHost.SeamName.toolDispatchAround && next ? next() : Effect.succeed(event),
          ),
        ),
    },
  }),
)
const pluginServices = Layer.mergeAll(
  Layer.succeed(PluginRuntime.Service, PluginRuntime.make()),
  pluginHost,
  Layer.succeed(
    SessionAttachment.Service,
    SessionAttachment.Service.of({
      materializeFile: (file) => Effect.succeed(file),
      materialize: (prompt) => Effect.succeed(prompt),
    }),
  ),
  Layer.succeed(
    SessionPromptExpansion.Service,
    SessionPromptExpansion.Service.of({
      resolve: (prompt) => Effect.succeed(prompt),
      materializeAgents: (prompt) => Effect.succeed(prompt),
      command: () => Effect.die("unused"),
    }),
  ),
)
const locationMap = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () => Layer.mergeAll(models, pluginServices, tools, compaction) as unknown as Layer.Layer<LocationServices>,
  ),
)

// The routing facade over the test graph's own Kernel (mock client + location
// services); keeping it a node preserves its dependencies for the graph.
const executionNode = LayerNode.make({
  service: SessionExecution.Service,
  tag: Node.tags.values.global,
  layer: Layer.effect(
    SessionExecution.Service,
    Effect.gen(function* () {
      const kernel = yield* Kernel.Service
      const { db } = yield* Database.Service
      return SessionExecution.routingFacade(SessionExecutionRouter.make({ kernel: kernel.execution }, db))
    }),
  ),
  deps: [Kernel.node, Database.node],
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      Kernel.node,
      LifecycleStore.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, executionNode],
      [LayerNodePlatform.llmClient, client],
      [LocationServiceMap.node, locationMap],
    ],
  ),
)

describe("Kernel provider turn", () => {
  it.effect("atomically enters responding when the first provider event is durably recorded", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      mock.responses.length = 0
      mock.requests.length = 0
      const responseObserved = yield* Deferred.make<void>()
      const finishGate = yield* Deferred.make<void>()
      mock.responses.push(() =>
        Stream.concat(
          Stream.fromIterable([LLMEvent.stepStart({ index: 0 })]),
          Stream.unwrap(
            Deferred.succeed(responseObserved, undefined).pipe(
              Effect.andThen(Deferred.await(finishGate)),
              Effect.as(
                Stream.fromIterable([
                  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
                  LLMEvent.finish({ reason: "stop" }),
                ]),
              ),
            ),
          ),
        ),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Wait after the first provider event" }),
        resume: false,
      })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Deferred.await(responseObserved)
      for (let index = 0; index < 50; index++) {
        if ((yield* lifecycle.get(session.id)).phase === "responding") break
        yield* Effect.yieldNow
      }

      const phase = (yield* lifecycle.get(session.id)).phase
      yield* Deferred.succeed(finishGate, undefined)
      yield* Fiber.join(resume)

      expect(phase).toBe("responding")
    }),
  )
  it.effect("runs one no-tool kernel turn and atomically settles every identity", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      mock.responses.push(() => Stream.fromIterable(textEvents))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Say hello" }),
        resume: false,
      })
      yield* sessions.resume(session.id)
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot.state).toBe("idle")
      expect(snapshot.lease).toBeUndefined()
      expect(snapshot.generation).toBe(1)
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("completed")
      expect(row?.terminal_seq).not.toBeNull()
      const context = yield* (yield* SessionStore.Service).context(session.id)
      const assistant = context.find((message) => message.type === "assistant")
      expect(assistant?.type === "assistant" && assistant.content.find((part) => part.type === "text")?.text).toBe(
        "Hello!",
      )
      expect(mock.requests.map((request) => String(request.model.id))).toEqual(["fake-model"])
      const responseStartedType = EventV2.versionedType(SessionEvent.ProviderAttempt.ResponseStarted.type, 1)
      const responseStarted = (yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .all()
        .pipe(Effect.orDie))
        .filter((event) => (event.data as { sessionID?: unknown }).sessionID === session.id)
        .filter((event) => event.type === responseStartedType)
      expect(responseStarted).toHaveLength(1)
      expect((yield* SessionInput.find(db, input.id))?.promotedSeq).not.toBeUndefined()
    }),
  )

  it.effect("executes local tool calls once and continues with their durable results", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      seamCalls.length = 0
      seamEvents.length = 0
      toolExecutions.length = 0
      toolGenerations.length = 0
      mock.responses.push(() =>
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-echo", name: "echo", input: { text: "hello" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ]),
      )
      mock.responses.push(() => Stream.fromIterable(textEvents))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Echo hello" }),
        resume: false,
      })

      yield* sessions.resume(session.id)

      expect(toolExecutions).toEqual(["hello"])
      expect(toolGenerations).toEqual([1])
      expect(mock.requests).toHaveLength(2)
      expect(mock.requests[0]?.tools.map((tool) => tool.name)).toContain("echo")
      const toolResults = mock.requests[1]?.messages.flatMap((message) =>
        message.role === "tool" ? message.content.flatMap((part) => (part.type === "tool-result" ? [part] : [])) : [],
      )
      expect(toolResults).toMatchObject([
        {
          id: "call-echo",
          name: "echo",
          providerExecuted: false,
          result: { type: "text", value: "echo:hello" },
        },
      ])
      const context = yield* (yield* SessionStore.Service).context(session.id)
      const tool = context
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "call-echo")
      expect(tool).toMatchObject({
        provider: { executed: false },
        state: {
          status: "completed",
          structured: { value: "hello" },
          content: [{ type: "text", text: "echo:hello" }],
        },
      })
      const attemptRows = (yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .all()
        .pipe(Effect.orDie)).filter((row) => (row.data as { sessionID?: unknown }).sessionID === session.id)
      expect(attemptRows.filter((row) => String(row.type).includes("attempt.started"))).toHaveLength(2)
      expect(attemptRows.filter((row) => String(row.type).includes("attempt.ended"))).toHaveLength(2)
      expect(new Set(seamCalls)).toEqual(
        new Set([
          KernelPluginHost.SeamName.requestTransform,
          KernelPluginHost.SeamName.responseObserve,
          KernelPluginHost.SeamName.turnObserve,
          KernelPluginHost.SeamName.toolExposureTransform,
          KernelPluginHost.SeamName.toolPrepareDecide,
          KernelPluginHost.SeamName.toolDispatchAround,
          KernelPluginHost.SeamName.toolFinalizeTransform,
        ]),
      )
      expect(
        seamEvents.find((entry) => entry.name === KernelPluginHost.SeamName.toolPrepareDecide)?.event,
      ).toMatchObject({
        permitted: true,
        concurrency: "parallel",
        call: { id: "call-echo", name: "echo" },
      })
    }),
  )

  it.effect("persists provider-executed tool calls and results without local execution", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      mock.responses.length = 0
      mock.requests.length = 0
      toolExecutions.length = 0
      mock.responses.push(() =>
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({
            id: "hosted-search",
            name: "web_search",
            input: { query: "Effect" },
            providerExecuted: true,
            providerMetadata: { openai: { itemId: "hosted-search" } },
          }),
          LLMEvent.toolResult({
            id: "hosted-search",
            name: "web_search",
            result: { type: "json", value: [{ title: "Effect" }] },
            providerExecuted: true,
            providerMetadata: { openai: { itemId: "hosted-search-result" } },
          }),
          LLMEvent.stepFinish({ index: 0, reason: "stop" }),
          LLMEvent.finish({ reason: "stop" }),
        ]),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Search for Effect" }),
        resume: false,
      })

      yield* sessions.resume(session.id)

      expect(mock.requests).toHaveLength(1)
      expect(toolExecutions).toEqual([])
      const context = yield* (yield* SessionStore.Service).context(session.id)
      const tool = context
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "hosted-search")
      expect(tool).toMatchObject({
        provider: { executed: true, metadata: { openai: { itemId: "hosted-search" } } },
        state: { status: "completed", result: { type: "json", value: [{ title: "Effect" }] } },
      })
    }),
  )
  it.effect("terminalizes an active local tool when the turn is interrupted", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      mock.responses.length = 0
      mock.requests.length = 0
      toolExecutions.length = 0
      toolGate = yield* Deferred.make<void>()
      toolStarted = yield* Deferred.make<void>()
      mock.responses.push(() =>
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-blocked", name: "echo", input: { text: "blocked" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ]),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Run the blocking tool" }),
        resume: false,
      })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Deferred.await(toolStarted)

      yield* sessions.interrupt(session.id)
      yield* Fiber.join(resume)

      expect(toolExecutions).toEqual(["blocked"])
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      const context = yield* (yield* SessionStore.Service).context(session.id)
      const tool = context
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "call-blocked")
      expect(tool).toMatchObject({
        provider: { executed: false },
        state: {
          status: "error",
          result: { type: "error", value: "Tool execution cancelled" },
        },
      })
      toolGate = undefined
      toolStarted = undefined
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          toolGate = undefined
          toolStarted = undefined
        }),
      ),
    ),
  )

  it.effect("abandons a non-cooperative local tool within the interrupt settlement budget", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      mock.responses.length = 0
      mock.requests.length = 0
      toolExecutions.length = 0
      toolGate = yield* Deferred.make<void>()
      toolStarted = yield* Deferred.make<void>()
      mock.responses.push(() =>
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.toolCall({ id: "call-noncooperative", name: "echo", input: { text: "noncooperative" } }),
          LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
          LLMEvent.finish({ reason: "tool-calls" }),
        ]),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Run the non-cooperative tool" }),
        resume: false,
      })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Deferred.await(toolStarted)

      const interrupt = yield* sessions.interrupt(session.id).pipe(Effect.forkScoped)
      yield* TestClock.adjust(Duration.seconds(3).pipe(Duration.sum(Duration.millis(1))))
      yield* Fiber.join(interrupt)
      for (let index = 0; index < 50; index++) yield* Effect.yieldNow

      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      const beforeLateCompletion = yield* (yield* SessionStore.Service).context(session.id)
      const tool = beforeLateCompletion
        .flatMap((message) => (message.type === "assistant" ? message.content : []))
        .find((part) => part.type === "tool" && part.id === "call-noncooperative")
      expect(tool).toMatchObject({
        provider: { executed: false },
        state: {
          status: "error",
          result: { type: "error", value: "Tool execution abandoned" },
        },
      })

      yield* Deferred.succeed(toolGate, undefined)
      yield* Fiber.join(resume)
      for (let index = 0; index < 10; index++) yield* Effect.yieldNow
      expect(yield* (yield* SessionStore.Service).context(session.id)).toEqual(beforeLateCompletion)
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (toolGate) yield* Deferred.succeed(toolGate, undefined)
          toolGate = undefined
          toolStarted = undefined
        }),
      ),
    ),
  )

  it.effect("compacts once after a context overflow and rebuilds the provider request", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      compactionInvocations.length = 0
      compactionResult = { compacted: true, shouldContinue: true }
      mock.responses.push(() =>
        Stream.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new InvalidRequestReason({ message: "prompt too long", classification: "context-overflow" }),
          }),
        ),
      )
      mock.responses.push(() => Stream.fromIterable(textEvents))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Compact and continue" }),
        resume: false,
      })

      yield* sessions.resume(session.id)

      expect(compactionInvocations).toHaveLength(1)
      expect(compactionInvocations[0]).toMatchObject({ session, reason: "auto" })
      expect(mock.requests).toHaveLength(2)
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("completed")
    }),
  )

  it.effect("compacts a provider-error event classified as context overflow", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      compactionInvocations.length = 0
      compactionResult = { compacted: true, shouldContinue: true }
      mock.responses.push(() =>
        Stream.fromIterable([
          LLMEvent.providerError({ message: "prompt too long", classification: "context-overflow" }),
        ]),
      )
      mock.responses.push(() => Stream.fromIterable(textEvents))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Compact provider error event" }),
        resume: false,
      })

      yield* sessions.resume(session.id)

      expect(compactionInvocations).toHaveLength(1)
      expect(mock.requests).toHaveLength(2)
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("completed")
    }),
  )

  it.effect("does not compact overflow after assistant output starts and fails the open step", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      compactionInvocations.length = 0
      compactionResult = { compacted: true, shouldContinue: true }
      mock.responses.push(() =>
        Stream.fromIterable([
          LLMEvent.stepStart({ index: 0 }),
          LLMEvent.providerError({ message: "late overflow", classification: "context-overflow" }),
        ]),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Do not compact partial output" }),
        resume: false,
      })

      yield* sessions.resume(session.id)

      expect(compactionInvocations).toHaveLength(0)
      expect(mock.requests).toHaveLength(1)
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("error")
      const stepFailedType = EventV2.versionedType(SessionEvent.Step.Failed.type, 2)
      const stepFailures = (yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .all()
        .pipe(Effect.orDie))
        .filter((event) => (event.data as { sessionID?: unknown }).sessionID === session.id)
        .filter((event) => event.type === stepFailedType)
      expect(stepFailures).toHaveLength(1)
    }),
  )
  it.effect("persists the original error after a second context overflow without compacting again", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      compactionInvocations.length = 0
      compactionResult = { compacted: true, shouldContinue: true }
      const overflow = () =>
        Stream.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new InvalidRequestReason({ message: "prompt too long", classification: "context-overflow" }),
          }),
        )
      mock.responses.push(overflow, overflow)
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Overflow twice" }),
        resume: false,
      })

      yield* sessions.resume(session.id)

      expect(compactionInvocations).toHaveLength(1)
      expect(mock.requests).toHaveLength(2)
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("error")
      expect((row?.terminal_error as { name?: string })?.name).toBe("InvalidRequest")
    }),
  )
  it.effect("retries a retryable provider error once with a fresh attempt identity", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      mock.responses.push(() =>
        Stream.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new RateLimitReason({ message: "temporary" }),
          }),
        ),
      )
      mock.responses.push(() => Stream.fromIterable(textEvents))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Retry me" }),
        resume: false,
      })
      const fiber = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* TestClock.adjust(Duration.millis(501))
      yield* Fiber.join(fiber)
      expect(mock.requests).toHaveLength(2)
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot.state).toBe("idle")
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("completed")
      // Attempt lifecycle invariants read from durable facts: exactly one
      // terminal event per started attempt, and the execution row points at
      // the final attempt when the turn settles.
      const durableRows = yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .all()
        .pipe(Effect.orDie)
      const sessionEvents = durableRows.filter((row) => (row.data as { sessionID?: unknown }).sessionID === session.id)
      const parseID = (row: { data: unknown }) => String((row.data as { attemptID?: unknown }).attemptID)
      const started = sessionEvents.filter((row) => String(row.type).includes("attempt.started")).map(parseID)
      const ended = sessionEvents.filter((row) => String(row.type).includes("attempt.ended")).map(parseID)
      expect(started).toHaveLength(2)
      expect(ended).toHaveLength(2)
      expect(new Set(started).size).toBe(2)
      expect(new Set(ended).size).toBe(2)
      for (const id of started) expect(ended).toContain(id)
      // The row clears attempt_id at idle; the durable pair-set equality above
      // proves each started attempt (including the retried one) received
      // exactly one terminal event and the final terminalize closed attempt-2,
      // not the stale attempt-1.
    }),
  )

  it.effect("terminalizes partial provider output after transport loss without replay", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      mock.responses.push(() =>
        Stream.concat(
          Stream.fromIterable([
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "transport-partial" }),
            LLMEvent.textDelta({ id: "transport-partial", text: "visible before transport loss" }),
          ]),
          Stream.fail(
            new LLMError({
              module: "test",
              method: "stream",
              reason: new TransportReason({ message: "connection reset", kind: "read" }),
            }),
          ),
        ),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Retry after transport loss" }),
        resume: false,
      })
      yield* sessions.resume(session.id)

      expect(mock.requests).toHaveLength(1)
      expect(
        yield* db
          .select({ outcome: SessionInputTable.terminal_outcome, error: SessionInputTable.terminal_error })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.id, input.id))
          .get()
          .pipe(Effect.orDie),
      ).toMatchObject({ outcome: "error", error: { name: "Transport" } })
      const rows = (yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .all()
        .pipe(Effect.orDie)).filter((row) => (row.data as { sessionID?: unknown }).sessionID === session.id)
      const attemptStarted = rows.filter((row) => row.type === EventV2.versionedType(SessionEvent.ProviderAttempt.Started.type, 1))
      const attemptEnded = rows.filter((row) => row.type === EventV2.versionedType(SessionEvent.ProviderAttempt.Ended.type, 1))
      const textEnded = rows.filter(
        (row) =>
          row.type === EventV2.versionedType(SessionEvent.Text.Ended.type, 1) &&
          (row.data as { textID?: unknown }).textID === "transport-partial",
      )
      expect(attemptStarted).toHaveLength(1)
      expect(attemptEnded).toHaveLength(1)
      expect((attemptEnded[0]?.data as { attemptID?: unknown }).attemptID).toBe(
        (attemptStarted[0]?.data as { attemptID?: unknown }).attemptID,
      )
      expect(textEnded).toHaveLength(1)
      expect(textEnded[0]?.data).toMatchObject({ text: "visible before transport loss" })
    }),
  )

  it.effect("interrupts retry backoff without waiting for the retry clock", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      mock.setGate(undefined)
      mock.setStarted(undefined)
      mock.responses.push(() =>
        Stream.concat(
          Stream.fromIterable([
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "retry-partial" }),
            LLMEvent.textDelta({ id: "retry-partial", text: "before retry" }),
          ]),
          Stream.fail(
            new LLMError({
              module: "test",
              method: "stream",
              reason: new RateLimitReason({ message: "temporary" }),
            }),
          ),
        ),
      )
      mock.responses.push(() => Stream.fromIterable(textEvents))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Stop the retry" }),
        resume: false,
      })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      for (let index = 0; index < 50; index++) {
        if ((yield* lifecycle.get(session.id)).state === "retry_wait") break
        yield* Effect.yieldNow
      }
      expect((yield* lifecycle.get(session.id)).state).toBe("retry_wait")

      const interrupt = yield* sessions.interrupt(session.id).pipe(Effect.forkScoped)
      for (let index = 0; index < 50; index++) yield* Effect.yieldNow
      const completedBeforeBackoff = (yield* lifecycle.get(session.id)).state === "idle"

      // Always release the TestClock so a failing assertion cannot leave the
      // scoped drain suspended during test cleanup.
      yield* TestClock.adjust(Duration.millis(501))
      yield* Fiber.join(interrupt)
      yield* Fiber.join(resume)
      expect(completedBeforeBackoff).toBe(true)
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      const endedType = EventV2.versionedType(SessionEvent.Text.Ended.type, 1)
      const ended = (yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .all()
        .pipe(Effect.orDie))
        .filter((event) => (event.data as { sessionID?: unknown; textID?: unknown }).sessionID === session.id)
        .filter((event) => event.type === endedType && (event.data as { textID?: unknown }).textID === "retry-partial")
      expect(ended).toHaveLength(1)
    }),
  )

  it.effect("terminalizes with the typed provider error when retry is exhausted", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.responses.length = 0
      mock.requests.length = 0
      mock.responses.push(() =>
        Stream.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new AuthenticationReason({ message: "invalid key", kind: "invalid" }),
          }),
        ),
      )
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Fail me" }),
        resume: false,
      })
      yield* sessions.resume(session.id)
      expect(mock.requests).toHaveLength(1)
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot.state).toBe("idle")
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("error")
      expect((row?.terminal_error as { name?: string })?.name).toBe("Authentication")
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
    }),
  )
})
