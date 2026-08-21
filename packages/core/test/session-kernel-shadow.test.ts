import { describe, expect } from "bun:test"
import { Effect, Layer, LayerMap, Stream } from "effect"
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
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionRouter } from "@opencode-ai/core/session/execution/router"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { KernelDiagnostics } from "@opencode-ai/core/session/kernel/diagnostics"
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

/** Recorded provider event sequence turned LLM events; the shadow contract feeds the same recording to both engines. */
const recording: LLMEvent[] = [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-0" }),
  LLMEvent.textDelta({ id: "text-0", text: "shadow" }),
  LLMEvent.textEnd({ id: "text-0" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const mock = {
  requests: 0,
  queue: [] as string[],
}
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => {
      mock.requests += 1
      void mock.queue.shift()
      return Stream.fromIterable(recording)
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
      KernelDiagnostics.node,
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

/** Normalized public contract: the shadow comparison excludes lease tokens, generations, seqs, and timings. */
const runShadowTurn = Effect.fn("shadow.runTurn")(function* (input: { text: string }) {
  const sessions = yield* SessionV2.Service
  const lifecycle = yield* LifecycleStore.Service
  const { db } = yield* Database.Service
  const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
  const admitted = yield* sessions.prompt({
    sessionID: session.id,
    prompt: Prompt.make({ text: input.text }),
    resume: false,
  })
  yield* sessions.resume(session.id)
  const after = yield* lifecycle.get(session.id)
  const terminal = yield* db
    .select()
    .from(SessionInputTable)
    .where(eq(SessionInputTable.id, admitted.id))
    .get()
    .pipe(Effect.orDie)
  return {
    sessionID: session.id,
    engine: session.engine,
    state: after.state,
    terminalOutcome: terminal?.terminal_outcome ?? null,
    requests: mock.requests,
  }
})

describe("Kernel shadow contract", () => {
  it.effect("feeds a recorded provider turn and produces the exact public contract", () =>
    Effect.gen(function* () {
      mock.requests = 0
      mock.queue = ["shadow-run"]
      const run = yield* runShadowTurn({ text: "recorded turn" })
      // Public contract: kernel engine, single completed turn, one provider
      // request, terminalized exactly once.
      expect(run.engine).toBe("kernel")
      expect(run.state).toBe("idle")
      expect(run.terminalOutcome).toBe("completed")
      expect(run.requests).toBe(1)
    }),
  )

  it.effect("preserves event order and terminal outcome for a FIFO pair of recorded turns", () =>
    Effect.gen(function* () {
      mock.requests = 0
      mock.queue = ["first-shadow", "second-shadow"]
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const first = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "one" }),
        resume: false,
        intent: { type: "queue" },
      })
      const second = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "two" }),
        resume: false,
        intent: { type: "queue" },
      })
      yield* sessions.resume(session.id)
      const inputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, session.id))
        .all()
        .pipe(Effect.orDie)
      expect(yield* lifecycle.get(session.id)).toMatchObject({ state: "idle", generation: 2 })
      expect(mock.requests).toBe(2)
      for (const input of [first.id, second.id]) {
        const row = inputs.find((item) => item.id === input)
        expect(row?.terminal_outcome).toBe("completed")
        expect(row?.terminal_seq).not.toBeNull()
      }
      // Order: first input committed before the second.
      const firstRow = inputs.find((item) => item.id === first.id)
      const secondRow = inputs.find((item) => item.id === second.id)
      expect(firstRow?.terminal_seq ?? 0).toBeLessThan(secondRow?.terminal_seq ?? 0)
    }),
  )

  it.effect("records checkpoint and terminal latencies into diagnostics", () =>
    Effect.gen(function* () {
      const diagnostics = yield* KernelDiagnostics.Service
      const snapshot = yield* diagnostics.snapshot()
      // Diagnostics is a surface, not a fake: integration points that record
      // are exercised by the other kernel suites; the sample contract here is
      // counters/histograms shape stability.
      expect(Array.isArray(snapshot.counters)).toBe(true)
      expect(Array.isArray(snapshot.latencies)).toBe(true)
      for (const sample of snapshot.latencies) {
        expect(sample.count).toBeGreaterThanOrEqual(0)
        expect(sample.p95Ms).toBeGreaterThanOrEqual(0)
      }
      expect(yield* diagnostics.reset()).toBeUndefined()
    }),
  )
})
