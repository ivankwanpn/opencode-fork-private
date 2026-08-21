import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const pluginMap = pluginLocationMap()
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

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
      QuestionV2.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      [Location.node, Location.boundNode({ directory: location.directory })],
      pluginMap.replacement,
    ],
  ),
)

const question = { label: "Proceed?", description: "Continue the turn?" }

describe("Kernel question binding", () => {
  it.effect.skip("a reply bound to the current generation settles the question", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const questions = yield* QuestionV2.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      yield* store.acquireIdle(session.id, "responding")
      const ask = yield* questions.ask({
        sessionID: session.id,
        questions: [question],
        generation: 1,
      })
      const fiber = yield* ask.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* questions.reply({ requestID: (yield* questions.list())[0]!.id, answers: [["yes"]] })
      expect(yield* fiber.pipe(Effect.flip)).toMatchObject({ answers: [["yes"]] })
    }),
  )

  it.effect.skip("a stale reply bound to a fenced generation is rejected", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const questions = yield* QuestionV2.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      yield* store.acquireIdle(session.id, "responding")
      const ask = yield* questions.ask({
        sessionID: session.id,
        questions: [question],
        generation: 1,
      })
      const fiber = yield* ask.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      // The interrupt fence advances the generation before the reply lands.
      yield* store.acceptInterrupt({ sessionID: session.id, expectedGeneration: 1, reason: "user" })
      const requestID = (yield* questions.list())[0]!.id
      const error = yield* questions.reply({ requestID, answers: [["yes"]] }).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "QuestionV2.StaleQuestion", expectedGeneration: 1 })
      yield* Fiber.interrupt(fiber)
    }),
  )

  it.effect.skip("async reject still resolves the awaiting ask", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const questions = yield* QuestionV2.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      yield* store.acquireIdle(session.id, "responding")
      const ask = yield* questions.ask({ sessionID: session.id, questions: [question], generation: 1 })
      const fiber = yield* ask.pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      yield* questions.reject((yield* questions.list())[0]!.id)
      const exit = yield* Fiber.join(fiber).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
