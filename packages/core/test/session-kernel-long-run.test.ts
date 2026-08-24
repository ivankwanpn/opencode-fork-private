import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, LayerMap, Scope, Stream } from "effect"
import { LLMClient, LLMEvent, Model, type LLMClientShape } from "@opencode-ai/llm"
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
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionRouter } from "@opencode-ai/core/session/execution/router"
import { SessionExecutionTable, SessionInputTable } from "@opencode-ai/core/session/sql"
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

const mock = {
  requests: 0,
  queue: [] as string[],
  active: 0,
  maxActive: 0,
  target: 0,
  allStarted: undefined as Deferred.Deferred<void> | undefined,
  gate: undefined as Deferred.Deferred<void> | undefined,
}
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => {
      mock.requests += 1
      const text = mock.queue.shift() ?? "hello"
      const events: LLMEvent[] = [
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.textDelta({ id: "text-0", text }),
        LLMEvent.textEnd({ id: "text-0" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ]
      const stream = Stream.fromIterable(events)
      const gate = mock.gate
      const allStarted = mock.allStarted
      const target = mock.target
      return Stream.unwrap(
        Effect.sync(() => {
          mock.active += 1
          mock.maxActive = Math.max(mock.maxActive, mock.active)
        }).pipe(
          Effect.tap(() =>
            allStarted && mock.active === target ? Deferred.succeed(allStarted, undefined) : Effect.void,
          ),
          Effect.andThen(gate ? Deferred.await(gate) : Effect.void),
          Effect.as(stream),
          Effect.ensuring(Effect.sync(() => (mock.active -= 1))),
        ),
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

const resetMock = () => {
  mock.requests = 0
  mock.queue = []
  mock.active = 0
  mock.maxActive = 0
  mock.target = 0
  mock.allStarted = undefined
  mock.gate = undefined
}

const makeOwnedKernelHarness = Effect.gen(function* () {
  const sessions = yield* SessionV2.Service
  expect(mock.active).toBe(0)
  const scope = yield* Scope.fork(yield* Scope.Scope)
  const owned = new Set<SessionSchema.ID>()
  let closed = false
  const create = (input: Parameters<typeof sessions.create>[0]) =>
    sessions.create(input).pipe(Effect.tap((session) => Effect.sync(() => owned.add(session.id))))
  const resume = (sessionID: SessionSchema.ID) =>
    sessions.resume(sessionID).pipe(Effect.forkIn(scope, { startImmediately: true }))
  const close = Effect.uninterruptible(
    Effect.gen(function* () {
      if (closed) return
      closed = true
      yield* Effect.forEach(
        Array.from(owned),
        (sessionID) =>
          sessions.interrupt(sessionID).pipe(
            Effect.andThen(sessions.wait(sessionID)),
            Effect.catchCause(() => Effect.void),
          ),
        { concurrency: "unbounded", discard: true },
      )
      yield* Scope.close(scope, Exit.void)
      expect(mock.active).toBe(0)
      yield* Effect.sync(resetMock)
    }),
  )
  yield* Effect.addFinalizer(() => close)
  return { sessions, create, resume, close }
})

describe("Kernel long-run gates", () => {
  it.effect("one thousand scripted queue turns run FIFO without permanent busy", () =>
    Effect.gen(function* () {
      const harness = yield* makeOwnedKernelHarness
      const { sessions } = harness
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      resetMock()
      mock.queue = Array.from({ length: 1_000 }, (_, index) => `turn-${index + 1}`)
      const session = yield* harness.create({ location, engine: "kernel", model: modelRef })
      const admitted: string[] = []
      for (let index = 0; index < 1_000; index++) {
        const input = yield* sessions.prompt({
          sessionID: session.id,
          prompt: Prompt.make({ text: `queued ${index + 1}` }),
          resume: false,
          intent: { type: "queue" },
        })
        admitted.push(input.id)
      }
      yield* Fiber.join(yield* harness.resume(session.id))
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot).toMatchObject({ state: "idle", generation: 1_000 })
      expect(mock.requests).toBe(1_000)
      const rows = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, session.id))
        .all()
        .pipe(Effect.orDie)
      const terminalized = rows.filter((row) => row.terminal_outcome !== null)
      // Every input terminalized exactly once: one outcome each, none missing.
      expect(terminalized).toHaveLength(1_000)
      expect(rows.every((row) => row.terminal_outcome === "completed")).toBe(true)
      // Exactly one execution row with no lease at rest: valid active leases
      // per Session is at most one, and idle sessions hold none.
      const execution = yield* db
        .select()
        .from(SessionExecutionTable)
        .where(eq(SessionExecutionTable.session_id, session.id))
        .all()
        .pipe(Effect.orDie)
      expect(execution).toHaveLength(1)
      expect(execution[0]!.lease_token).toBeNull()
      // FIFO order matches generation order.
      const seqs = rows.map((row) => row.terminal_seq ?? 0)
      expect([...seqs].toSorted((a, b) => a - b)).toEqual(seqs)
    }),
    { timeout: 180_000 },
  )

  it.effect("one hundred concurrent kernel sessions enter the provider independently", () =>
    Effect.gen(function* () {
      const harness = yield* makeOwnedKernelHarness
      const { sessions } = harness
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      resetMock()
      mock.target = 100
      mock.allStarted = yield* Deferred.make<void>()
      mock.gate = yield* Deferred.make<void>()
      mock.queue = Array.from({ length: 100 }, (_, index) => `concurrent-${index + 1}`)
      const created = yield* Effect.forEach(
        Array.from({ length: 100 }, (_, index) => index),
        () => harness.create({ location, engine: "kernel", model: modelRef }),
      )
      yield* Effect.forEach(
        created,
        (session) =>
          sessions.prompt({
            sessionID: session.id,
            prompt: Prompt.make({ text: "concurrent turn" }),
            resume: false,
          }),
        { discard: true },
      )
      const resumes = yield* Effect.forEach(created, (session) => harness.resume(session.id), {
        concurrency: "unbounded",
      })
      yield* Deferred.await(mock.allStarted)
      const maxActive = mock.maxActive
      yield* Deferred.succeed(mock.gate, undefined)
      yield* Effect.forEach(resumes, (resume) => Fiber.join(resume), { discard: true })
      for (const session of created) {
        expect(yield* lifecycle.get(session.id)).toMatchObject({ state: "idle", generation: 1 })
        const inputs = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, session.id))
          .all()
          .pipe(Effect.orDie)
        expect(inputs).toHaveLength(1)
        expect(inputs[0]!.terminal_outcome).toBe("completed")
      }
      expect(maxActive).toBe(100)
      expect(mock.requests).toBe(100)
    }),
  )

  it.effect("closes an interrupted drain before the next case resets provider state", () =>
    Effect.gen(function* () {
      const first = yield* makeOwnedKernelHarness
      const { sessions } = first
      resetMock()
      mock.target = 1
      mock.gate = yield* Deferred.make<void>()
      mock.queue = ["aborted"]
      const session = yield* first.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "aborted turn" }),
        resume: false,
      })
      const resume = yield* first.resume(session.id)
      for (let index = 0; index < 50 && mock.active < 1; index++) yield* Effect.yieldNow
      expect(mock.active).toBe(1)
      yield* Fiber.interrupt(resume)
      expect((yield* sessions.active).size).toBe(1)
      yield* first.close
      expect(mock.active).toBe(0)

      const second = yield* makeOwnedKernelHarness
      const secondSession = yield* second.create({ location, engine: "kernel", model: modelRef })
      yield* second.sessions.prompt({
        sessionID: secondSession.id,
        prompt: Prompt.make({ text: "fresh turn" }),
        resume: false,
      })
      yield* Fiber.join(yield* second.resume(secondSession.id))
      expect(mock.requests).toBe(1)
      yield* second.close
    }),
  )

  it.effect("repeated interrupt and resume cycles settle exactly once", () =>
    Effect.gen(function* () {
      const harness = yield* makeOwnedKernelHarness
      const { sessions } = harness
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      resetMock()
      mock.queue = ["interrupt-answer"]
      const session = yield* harness.create({ location, engine: "kernel", model: modelRef })
      const admitted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "never interrupting" }),
        resume: false,
      })
      // Repeated interrupt fence and resume cycles over an idle session with
      // pending prompts: each pending input terminalizes exactly once, no
      // duplicate terminal facts, and the session ends idle.
      yield* sessions.interrupt(session.id)
      const after = yield* lifecycle.get(session.id)
      expect(["idle", "cancelling", "needs_recovery"]).toContain(after.state)
      yield* sessions.resume(session.id)
      yield* sessions.interrupt(session.id)
      yield* sessions.resume(session.id)
      expect(yield* lifecycle.get(session.id)).toMatchObject({ state: "idle" })
      const rows = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, session.id))
        .all()
        .pipe(Effect.orDie)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.terminal_outcome).toBe("completed")
      expect(yield* sessions.resume(session.id).pipe(Effect.exit)).toMatchObject({ _tag: "Success" })
    }),
  )
})
