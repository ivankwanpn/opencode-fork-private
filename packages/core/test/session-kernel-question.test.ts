import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
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
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const locationMap = pluginLocationMap(
  undefined,
  undefined,
  undefined,
  QuestionV2.locationLayer as Layer.Layer<QuestionV2.Service>,
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      EventV2.node,
      LocationServiceMap.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      Kernel.node,
      LifecycleStore.node,
    ]),
    [[ProjectV2.node, projects], [SessionExecution.node, SessionExecution.noopLayer], locationMap.replacement],
  ),
)

const question: QuestionV2.Info = {
  question: "Continue?",
  header: "Decision",
  options: [{ label: "Continue", description: "Continue the turn" }],
}

const waitForRequest = Effect.fn("KernelQuestionTest.waitForRequest")(function* (questions: QuestionV2.Interface) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const request = (yield* questions.list())[0]
    if (request) return request
    yield* Effect.yieldNow
  }
  return yield* Effect.die("Question request was not registered")
})

describe("Kernel question binding", () => {
  it.effect("accepts a reply only while the owning generation is current", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const locations = yield* LocationServiceMap.Service
      const questions = yield* QuestionV2.Service.pipe(Effect.provide(locations.get(location)))
      const session = yield* sessions.create({ location, engine: "kernel" })
      const lease = yield* lifecycle.acquireIdle(session.id, "responding")
      const fiber = yield* questions
        .ask({ sessionID: session.id, questions: [question], generation: lease.generation })
        .pipe(Effect.forkScoped)
      const request = yield* waitForRequest(questions)

      yield* questions.reply({ requestID: request.id, answers: [["Continue"]] })

      expect(yield* Fiber.join(fiber)).toEqual([["Continue"]])
      expect(yield* questions.list()).toEqual([])
      yield* lifecycle.releaseIdle(lease)
    }),
  )

  it.effect("rejects both pending and late replies after the generation is fenced", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const locations = yield* LocationServiceMap.Service
      const questions = yield* QuestionV2.Service.pipe(Effect.provide(locations.get(location)))
      const session = yield* sessions.create({ location, engine: "kernel" })
      const lease = yield* lifecycle.acquireIdle(session.id, "responding")
      const fiber = yield* questions
        .ask({ sessionID: session.id, questions: [question], generation: lease.generation })
        .pipe(Effect.forkScoped)
      const request = yield* waitForRequest(questions)

      yield* lifecycle.acceptInterrupt({
        sessionID: session.id,
        expectedGeneration: lease.generation,
        reason: "user",
      })
      expect(yield* questions.reply({ requestID: request.id, answers: [["Continue"]] }).pipe(Effect.flip)).toEqual(
        new QuestionV2.StaleQuestionError({ requestID: request.id, expectedGeneration: lease.generation }),
      )

      yield* Fiber.interrupt(fiber)
      expect(yield* questions.list()).toEqual([])
      expect(yield* questions.reply({ requestID: request.id, answers: [["Continue"]] }).pipe(Effect.flip)).toEqual(
        new QuestionV2.StaleQuestionError({ requestID: request.id, expectedGeneration: lease.generation }),
      )
      yield* lifecycle.settle({
        sessionID: session.id,
        expectedGeneration: lease.generation + 1,
        outcome: "cancelled",
      })
    }),
  )
})
