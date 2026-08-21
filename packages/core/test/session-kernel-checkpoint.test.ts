import { describe, expect } from "bun:test"
import { Deferred, Duration, Effect, Fiber, Layer, LayerMap, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LLMClient, LLMEvent, Model, type LLMClientShape } from "@opencode-ai/llm"
import { OpenAIChat } from "@opencode-ai/llm/protocols"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Node } from "@opencode-ai/core/effect/app-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
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
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { Checkpoint } from "@opencode-ai/core/session/kernel/checkpoint"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { asc, and, eq } from "drizzle-orm"
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

const makeEvents = (
  deltaCount: number,
  deltaText: (index: number) => string,
  tail: string,
) => {
  const events: LLMEvent[] = [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "text-0" }),
  ]
  for (let i = 0; i < deltaCount; i++) events.push(LLMEvent.textDelta({ id: "text-0", text: deltaText(i) }))
  events.push(
    LLMEvent.textDelta({ id: "text-0", text: tail }),
    LLMEvent.textEnd({ id: "text-0" }),
    LLMEvent.stepFinish({ index: 0, reason: "stop" }),
    LLMEvent.finish({ reason: "stop" }),
  )
  return events
}

const mock = {
  started: undefined as Deferred.Deferred<void> | undefined,
  stream: undefined as (() => Stream.Stream<LLMEvent, never>) | undefined,
}
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => {
      const events = Stream.unwrap(
        (mock.started ? Deferred.succeed(mock.started, undefined) : Effect.void).pipe(
          Effect.as(mock.stream?.() ?? Stream.empty),
        ),
      )
      return events
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)

const models = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({ resolve: () => Effect.succeed(model) }),
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

const checkpointRows = Effect.fn("test.checkpointRows")(function* (
  db: Database.Interface["db"],
  sessionID: SessionV2.ID,
) {
  return yield* db
    .select({ type: EventTable.type, data: EventTable.data })
    .from(EventTable)
    .where(
      and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, EventV2.versionedType(SessionEvent.Text.Checkpoint.type, 1))),
    )
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)
})

describe("Kernel streaming checkpoints", () => {
  it.effect("checkpoints at the interval and flushes before terminal close", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const store = yield* SessionStore.Service
      mock.started = yield* Deferred.make<void>()
      // 8000 bytes of deltas (below the 8192 threshold, so the interval fires).
      mock.stream = () => Stream.fromIterable(makeEvents(4, (i) => "a".repeat(2000), "tail"))
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: session.id, prompt: Prompt.make({ text: "Checkpoint me" }), resume: false })
      const fiber = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Deferred.await(mock.started)
      // The stream is synchronous; let the provider finish and the drain settle.
      yield* Fiber.join(fiber)
      const rows = yield* checkpointRows(db, session.id)
      const texts = rows.map((row) => (row.data as { text: string }).text)
      const joined = texts.join("")
      const context = yield* store.context(session.id)
      const assistant = context.find((message) => message.type === "assistant")
      expect(assistant?.type === "assistant" && assistant.content.find((part) => part.type === "text")?.text).toBe(
        "a".repeat(8000) + "tail",
      )
      // The checkpointed chunks reconstruct the full stream in order.
      expect(joined).toBe("a".repeat(8000) + "tail")
    }),
  )

  it.effect("checkpoints at the byte threshold across parts", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      mock.started = yield* Deferred.make<void>()
      // Two parts, each crossing 8192 bytes.
      const events: LLMEvent[] = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.textDelta({ id: "text-0", text: "a".repeat(8192) }),
        LLMEvent.textDelta({ id: "text-0", text: "b".repeat(200) }),
        LLMEvent.textEnd({ id: "text-0" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      mock.stream = () => Stream.fromIterable(events)
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: session.id, prompt: Prompt.make({ text: "Bytes" }), resume: false })
      yield* Fiber.join(yield* sessions.resume(session.id).pipe(Effect.forkScoped))
      const rows = yield* checkpointRows(db, session.id)
      expect(rows).toHaveLength(2)
      const texts = rows.map((row) => (row.data as { text: string }).text)
      expect(texts[0]).toBe("a".repeat(8192))
      expect(texts[1] ?? "").toBe("b".repeat(200))
    }),
  )

  it.effect("rejects a checkpoint emitted by a fenced generation", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const admitted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Fenced" }),
        resume: false,
      })
      const lease = yield* store.start({
        sessionID: session.id,
        inputID: admitted.id,
        turnID: SessionMessage.ID.create(),
        attemptID: EventV2.ID.create(),
        assistantMessageID: SessionMessage.ID.create(),
        processIncarnation: "incarnation-checkpoint",
      })
      yield* store.acceptInterrupt({ sessionID: session.id, expectedGeneration: lease.generation, reason: "user" })
      const error = yield* store.checkpoint({ lease, events: [] }).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "StaleExecutionError" })
    }),
  )

  it.effect("buffer drains incremental content per part and resets", () =>
    Effect.gen(function* () {
      const buffer = yield* Checkpoint.makeBuffer()
      yield* buffer.offer("text", "part-1", "abc")
      yield* buffer.offer("text", "part-1", "def")
      yield* buffer.offer("reasoning", "reason-1", "xyz")
      const first = yield* buffer.drain()
      expect(first).toEqual([
        { kind: "text", key: "part-1", text: "abcdef" },
        { kind: "reasoning", key: "reason-1", text: "xyz" },
      ])
      const second = yield* buffer.drain()
      expect(second).toEqual([])
    }),
  )
})
