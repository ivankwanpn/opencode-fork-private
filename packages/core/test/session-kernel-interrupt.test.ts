import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, LayerMap, Stream } from "effect"
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
  LLMEvent.textEnd({ id: "text-0" }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

const mock = {
  gate: undefined as Deferred.Deferred<void> | undefined,
  started: undefined as Deferred.Deferred<void> | undefined,
}
const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: (() => {
      const events = Stream.fromIterable(textEvents)
      return Stream.unwrap(
        (mock.started ? Deferred.succeed(mock.started, undefined) : Effect.void).pipe(
          Effect.andThen(Deferred.await(mock.gate!)),
          Effect.as(events),
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

describe("Kernel interrupt", () => {
  it.effect("durably fences before interrupt returns accepted", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.started = yield* Deferred.make<void>()
      mock.gate = yield* Deferred.make<void>()
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const input = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Interrupt me" }),
        resume: false,
      })
      const fiber = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Deferred.await(mock.started)
      const before = yield* lifecycle.get(session.id)
      expect(before.state).toBe("active")
      yield* sessions.interrupt(session.id)
      const accepted = yield* lifecycle.get(session.id)
      expect(accepted.generation).toBe(before.generation + 1)
      expect(accepted.lease).toBeUndefined()
      expect(accepted.state).toBe("cancelling")
      // Release the provider stream; the drain settles the cancelled turn.
      yield* Deferred.succeed(mock.gate, undefined)
      yield* Fiber.join(fiber)
      const settled = yield* lifecycle.get(session.id)
      expect(settled.state).toBe("idle")
      expect(settled.generation).toBe(before.generation + 1)
      const row = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(row?.terminal_outcome).toBe("cancelled")
    }),
  )

  it.effect("repeated interrupt is idempotent and never duplicates terminal facts", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.started = yield* Deferred.make<void>()
      mock.gate = yield* Deferred.make<void>()
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      yield* sessions.prompt({ sessionID: session.id, prompt: Prompt.make({ text: "Twice" }), resume: false })
      const fiber = yield* sessions.resume(session.id).pipe(Effect.forkScoped)
      yield* Deferred.await(mock.started)
      yield* sessions.interrupt(session.id)
      const first = yield* lifecycle.get(session.id)
      // A second interrupt with the stale generation is a durable no-op.
      yield* sessions.interrupt(session.id)
      const second = yield* lifecycle.get(session.id)
      expect(second.generation).toBe(first.generation)
      expect(second.state).toBe("cancelling")
      yield* Deferred.succeed(mock.gate, undefined)
      yield* Fiber.join(fiber)
      expect((yield* lifecycle.get(session.id)).state).toBe("idle")
      expect(
        yield* db
          .select({ id: SessionInputTable.id })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, session.id))
          .all()
          .pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )
})
