import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, LayerMap, Stream } from "effect"
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
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
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

const textEvents = (text: string): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-0" }),
  LLMEvent.textDelta({ id: "text-0", text }),
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
      const text = mock.queue.shift() ?? "hello"
      return Stream.fromIterable(textEvents(text))
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

const inputRow = Effect.fn("test.inputRow")(function* (
  db: Database.Interface["db"],
  id: SessionMessage.ID,
) {
  return yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
})

describe("Kernel input delivery", () => {
  it.effect("a prompt after a completed turn runs a fresh generation and turn", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.requests = 0
      mock.queue = ["first", "second"]
      const session = yield* sessions.create({ location, engine: "kernel", model: modelRef })
      const first = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "one" }),
        resume: false,
      })
      yield* sessions.resume(session.id)
      const afterFirst = yield* lifecycle.get(session.id)
      expect(afterFirst).toMatchObject({ state: "idle", generation: 1 })
      const second = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "two" }),
        resume: false,
      })
      yield* sessions.resume(session.id)
      const afterSecond = yield* lifecycle.get(session.id)
      expect(afterSecond).toMatchObject({ state: "idle", generation: 2 })
      // Every input terminalized exactly once; the second turn is not attached
      // to the first answer.
      expect((yield* inputRow(db, first.id))?.terminal_outcome).toBe("completed")
      expect((yield* inputRow(db, second.id))?.terminal_outcome).toBe("completed")
      expect((yield* inputRow(db, first.id))?.terminal_seq).not.toBe((yield* inputRow(db, second.id))?.terminal_seq)
      expect(mock.requests).toBe(2)
    }),
  )

  it.effect("queued inputs run FIFO one at a time across turns", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      mock.requests = 0
      mock.queue = ["first", "second"]
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
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot).toMatchObject({ state: "idle", generation: 2 })
      expect(mock.requests).toBe(2)
      expect((yield* inputRow(db, first.id))?.terminal_outcome).toBe("completed")
      expect((yield* inputRow(db, second.id))?.terminal_outcome).toBe("completed")
    }),
  )
})
