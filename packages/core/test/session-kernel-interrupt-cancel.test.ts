import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, LayerMap, Option, Stream } from "effect"
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
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionAttachment } from "@opencode-ai/core/session/attachment"
import { SessionPromptExpansion } from "@opencode-ai/core/session/prompt-expansion"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionStore } from "@opencode-ai/core/session/store"
import { and, eq, gt } from "drizzle-orm"
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

const textEvents = (text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-0" }),
  LLMEvent.textDelta({ id: "text-0", text }),
  LLMEvent.textEnd({ id: "text-0" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const gates = new Map<string, Deferred.Deferred<void>>()
const mock = { requests: 0, queue: [] as string[] }
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => {
      mock.requests += 1
      const text = mock.queue.shift() ?? "hello"
      const gate = gates.get(text)
      if (gate === undefined) return Stream.fromIterable(textEvents(text))
      if (text === "partial")
        return Stream.concat(
          Stream.fromIterable([
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "partial-text" }),
            LLMEvent.textDelta({ id: "partial-text", text: "visible before stop" }),
          ]),
          Stream.fromEffect(Deferred.await(gate)).pipe(
            Stream.flatMap(() =>
              Stream.fromIterable([
                LLMEvent.textDelta({ id: "partial-text", text: " after fence" }),
                LLMEvent.textEnd({ id: "partial-text" }),
                LLMEvent.stepFinish({ index: 0, reason: "stop" }),
                LLMEvent.finish({ reason: "stop" }),
              ]),
            ),
          ),
        )
      // Blocked provider: emission waits on a gate that the test never
      // releases. Cancellation must tear the reader down anyway.
      return Stream.fromEffect(Deferred.await(gate)).pipe(
        Stream.flatMap(() => Stream.fromIterable(textEvents("released"))),
      )
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

describe("Kernel interrupt cancellation", () => {
  it.effect("terminalizes an open text part before an interrupted turn becomes idle", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const gate = yield* Deferred.make<void>()
      gates.set("partial", gate)
      mock.requests = 0
      mock.queue = ["partial"]
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: session.id, prompt: Prompt.make({ text: "partial" }), resume: false })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      const startedType = EventV2.versionedType(SessionEvent.Text.Started.type, 1)
      for (let index = 0; index < 50; index++) {
        const started = yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, session.id), eq(EventTable.type, startedType)))
          .get()
          .pipe(Effect.orDie)
        if (started) break
        yield* Effect.yieldNow
      }

      yield* sessions.interrupt(session.id)
      yield* Fiber.join(resume)
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      const rows = yield* db
        .select({ type: EventTable.type, data: EventTable.data })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, session.id))
        .all()
        .pipe(Effect.orDie)
      const ended = rows.filter((row) => row.type === EventV2.versionedType(SessionEvent.Text.Ended.type, 1))
      expect(ended).toHaveLength(1)
      expect(ended[0]?.data).toMatchObject({ textID: "partial-text", text: "visible before stop" })
      expect(Option.isNone(yield* Deferred.poll(gate))).toBe(true)
    }),
  )

  it.effect("stops ordinary provider publication after fencing and emits only terminal settlement", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const gate = yield* Deferred.make<void>()
      gates.set("partial", gate)
      mock.requests = 0
      mock.queue = ["partial"]
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: session.id, prompt: Prompt.make({ text: "fence" }), resume: false })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      const startedType = EventV2.versionedType(SessionEvent.Text.Started.type, 1)
      for (let index = 0; index < 50; index++) {
        const started = yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, session.id), eq(EventTable.type, startedType)))
          .get()
          .pipe(Effect.orDie)
        if (started) break
        yield* Effect.yieldNow
      }
      const before = yield* lifecycle.get(session.id)
      const accepted = yield* lifecycle.acceptInterrupt({
        sessionID: session.id,
        expectedGeneration: before.generation,
        reason: "user",
      })

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(resume)
      const late = yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, session.id), gt(EventTable.seq, accepted.updatedSeq ?? -1)))
        .all()
        .pipe(Effect.orDie)
      expect(late.map((row) => row.type)).toEqual([
        EventV2.versionedType(SessionEvent.Step.Failed.type, 2),
        EventV2.versionedType(SessionEvent.Text.Ended.type, 1),
        EventV2.versionedType(SessionEvent.ProviderAttempt.Ended.type, 1),
        EventV2.versionedType(SessionEvent.Turn.Ended.type, 1),
        EventV2.versionedType(SessionEvent.Input.Terminalized.type, 1),
      ])
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
    }),
  )

  it.effect("admits a prompt during cancellation and runs it after the fenced turn settles", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const gate = yield* Deferred.make<void>()
      gates.set("partial", gate)
      mock.requests = 0
      mock.queue = ["partial", "after-cancellation"]
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const interrupted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "interrupt this turn" }),
        resume: false,
      })
      const resume = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      const startedType = EventV2.versionedType(SessionEvent.Text.Started.type, 1)
      for (let index = 0; index < 50; index++) {
        const started = yield* db
          .select({ type: EventTable.type })
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, session.id), eq(EventTable.type, startedType)))
          .get()
          .pipe(Effect.orDie)
        if (started) break
        yield* Effect.yieldNow
      }
      const before = yield* lifecycle.get(session.id)
      const accepted = yield* lifecycle.acceptInterrupt({
        sessionID: session.id,
        expectedGeneration: before.generation,
        reason: "user",
      })
      expect(accepted.state).toBe("cancelling")

      const admitted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "run after cancellation" }),
        resume: false,
      })
      expect(
        yield* db
          .select({ outcome: SessionInputTable.terminal_outcome })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.id, admitted.id))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ outcome: null })

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.join(resume)
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      expect(
        yield* db
          .select({ id: SessionInputTable.id, outcome: SessionInputTable.terminal_outcome })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, session.id))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([
        { id: interrupted.id, outcome: "cancelled" },
        { id: admitted.id, outcome: "completed" },
      ])

      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      expect(mock.requests).toBe(2)
      expect(
        yield* db
          .select({ outcome: SessionInputTable.terminal_outcome })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.id, admitted.id))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ outcome: "completed" })
    }),
  )

  it.effect("an interrupt cancels a blocked provider stream without releasing its gate", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const gate = yield* Deferred.make<void>()
      gates.set("blocked", gate)
      mock.requests = 0
      mock.queue = ["blocked"]
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: session.id, prompt: Prompt.make({ text: "blocking" }), resume: false })
      // run() joins the drain: the resume itself blocks on the turn, so it
      // must run in its own fiber while the test interrupts.
      const resumeFiber = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Effect.yieldNow // let the drain reach the stream suspension
      yield* sessions.interrupt(session.id)
      // The fence is durable and the drain settles without the gate ever
      // releasing: the interrupted provider stream exits on its own.
      // The fence returns before settlement; joining the drain observes the
      // background settle of the interrupted turn.
      yield* Fiber.join(resumeFiber)
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot.state).toBe("idle")
      expect(Option.isNone(yield* Deferred.poll(gate))).toBe(true)
    }),
  )

  it.effect("interrupting a blocked session leaves a completed companion intact", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const gateA = yield* Deferred.make<void>()
      gates.set("blocking-A", gateA)
      mock.requests = 0
      mock.queue = ["run-B", "blocking-A"]
      const sessionA = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const sessionB = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: sessionB.id, prompt: Prompt.make({ text: "B" }), resume: false })
      // B completes fully before A blocks, so both dispatches are deterministic.
      yield* sessions.resume(sessionB.id)
      const bSnapshot = yield* lifecycle.get(sessionB.id)
      expect(bSnapshot).toMatchObject({ state: "idle", generation: 1 })
      expect(mock.requests).toBe(1)
      yield* sessions.prompt({ sessionID: sessionA.id, prompt: Prompt.make({ text: "A" }), resume: false })
      const resumeA = yield* sessions.resume(sessionA.id).pipe(Effect.forkScoped)
      yield* Effect.all([Effect.yieldNow, Effect.yieldNow, Effect.yieldNow], { discard: true })
      yield* sessions.interrupt(sessionA.id)
      yield* Fiber.join(resumeA)
      expect((yield* lifecycle.get(sessionA.id)).state).toBe("idle")
      // The interrupt targeted only A: B keeps its completed terminal result.
      expect((yield* lifecycle.get(sessionB.id)).state).toBe("idle")
      expect(yield* lifecycle.get(sessionB.id)).toMatchObject({ generation: 1 })
      expect(mock.requests).toBe(2)
      expect(Option.isNone(yield* Deferred.poll(gateA))).toBe(true)
    }),
  )

  it.effect("interrupting one of two concurrently blocked sessions does not signal its companion", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const gateA = yield* Deferred.make<void>()
      const gateB = yield* Deferred.make<void>()
      gates.set("concurrent-A", gateA)
      gates.set("concurrent-B", gateB)
      mock.requests = 0
      mock.queue = ["concurrent-A", "concurrent-B"]
      const sessionA = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const sessionB = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: sessionA.id, prompt: Prompt.make({ text: "A" }), resume: false })
      yield* sessions.prompt({ sessionID: sessionB.id, prompt: Prompt.make({ text: "B" }), resume: false })
      const resumeA = yield* sessions.resume(sessionA.id).pipe(Effect.forkScoped)
      for (let index = 0; index < 50 && mock.requests < 1; index++) yield* Effect.yieldNow
      const resumeB = yield* sessions.resume(sessionB.id).pipe(Effect.forkScoped)
      for (let index = 0; index < 50 && mock.requests < 2; index++) yield* Effect.yieldNow
      expect(mock.requests).toBe(2)

      yield* sessions.interrupt(sessionA.id)
      yield* Fiber.join(resumeA)
      expect((yield* lifecycle.get(sessionA.id)).state).toBe("idle")
      expect((yield* lifecycle.get(sessionB.id)).state).toBe("active")
      expect(Option.isNone(yield* Deferred.poll(gateA))).toBe(true)
      expect(Option.isNone(yield* Deferred.poll(gateB))).toBe(true)

      yield* Deferred.succeed(gateB, undefined)
      yield* Fiber.join(resumeB)
      expect((yield* lifecycle.get(sessionB.id)).state).toBe("idle")
      expect(mock.requests).toBe(2)
    }),
  )
})
