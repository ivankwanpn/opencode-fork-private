import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber, Layer, LayerMap, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import {
  AuthenticationReason,
  LLMClient,
  LLMError,
  LLMEvent,
  Model,
  RateLimitReason,
  type LLMClientShape,
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
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionRouter } from "@opencode-ai/core/session/execution/router"
import { SessionInput } from "@opencode-ai/core/session/input"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { eq } from "drizzle-orm"
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
  const requests: Array<{ readonly model: string }> = []
  const client = Layer.succeed(
    LLMClient.Service,
    LLMClient.Service.of({
      prepare: () => Effect.die("unused"),
      stream: ((request: any) => {
        requests.push({ model: request.model?.id ?? "" })
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
  return { client, responses, requests, setGate: (gate: Deferred.Deferred<void> | undefined) => { streamGate = gate }, setStarted: (started: Deferred.Deferred<void> | undefined) => { streamStarted = started } }
}

// The mock client wraps mutable per-test state; the layer itself is stable so
// the graph can be built once.
const mock = makeClient()
const client = mock.client

const models = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({
    resolve: () => Effect.succeed(model),
  }),
)
const pluginServices = Layer.mergeAll(
  Layer.succeed(PluginRuntime.Service, PluginRuntime.make()),
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
  LayerMap.make(() => Layer.mergeAll(models, pluginServices) as unknown as Layer.Layer<LocationServices>),
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
      expect(mock.requests.map((request) => request.model)).toEqual(["fake-model"])
      expect((yield* SessionInput.find(db, input.id))?.promotedSeq).not.toBeUndefined()
    }),
  )

  it.effect("retries a retryable provider error once with a fresh attempt identity", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const events = yield* EventV2.Service
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
      const durableRows = yield* db.select({ type: EventTable.type, data: EventTable.data }).from(EventTable).all().pipe(Effect.orDie)
      const sessionEvents = durableRows.filter((row) => (row.data as { sessionID?: unknown }).sessionID === session.id)
      const parseID = (row: { data: unknown }) => String((row.data as { attemptID?: unknown }).attemptID)
      const started = sessionEvents
        .filter((row) => String(row.type).includes("attempt.started"))
        .map(parseID)
      const ended = sessionEvents
        .filter((row) => String(row.type).includes("attempt.ended"))
        .map(parseID)
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
