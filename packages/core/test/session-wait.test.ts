import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const location = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
const forces: boolean[] = []
let drainHandler: (force: boolean) => Effect.Effect<void, SessionRunner.RunError> = () => Effect.void

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (_sessionID, force) =>
        Effect.sync(() => forces.push(force)).pipe(Effect.andThen(Effect.suspend(() => drainHandler(force)))),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      exclusive: (sessionID, work) =>
        coordinator.exclusive(sessionID, work).pipe(
          Effect.catchTag("SessionRunCoordinator.Busy", () =>
            Effect.fail(new SessionExecution.BusyError({ sessionID })),
          ),
        ),
      wake: coordinator.wake,
      wait: coordinator.wait,
      interrupt: coordinator.interrupt,
    })
  }),
)

const pluginMap = pluginLocationMap()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, execution],
      pluginMap.replacement,
    ],
  ),
)

const setup = Effect.gen(function* () {
  forces.length = 0
  drainHandler = () => Effect.void
  const sessions = yield* SessionV2.Service
  const session = yield* sessions.create({ location })
  return { sessions, session }
})

describe("SessionV2.wait", () => {
  it.effect("returns immediately for an idle session without starting execution", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup

      yield* sessions.wait(session.id)

      expect(forces).toEqual([])
    }),
  )

  it.effect("waits for active execution to become idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sessions, session } = yield* setup
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const waited = yield* Deferred.make<void>()
        drainHandler = () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))

        const running = yield* sessions.resume(session.id).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const waiting = yield* sessions.wait(session.id).pipe(
          Effect.andThen(Deferred.succeed(waited, undefined)),
          Effect.forkChild,
        )
        yield* Effect.yieldNow

        expect(yield* Deferred.isDone(waited)).toBe(false)
        yield* Deferred.succeed(gate, undefined)
        yield* Effect.all([Fiber.join(running), Fiber.join(waiting)])
        expect(forces).toEqual([true])
      }),
    ),
  )

  it.effect("waits through a coalesced prompt successor", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sessions, session } = yield* setup
        const firstStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const secondGate = yield* Deferred.make<void>()
        const waited = yield* Deferred.make<void>()
        let runs = 0
        drainHandler = () =>
          Effect.sync(() => ++runs).pipe(
            Effect.flatMap((run) =>
              run === 1
                ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstGate)))
                : Deferred.succeed(secondStarted, undefined).pipe(Effect.andThen(Deferred.await(secondGate))),
            ),
          )

        const running = yield* sessions.resume(session.id).pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        yield* sessions.prompt({
          sessionID: session.id,
          prompt: Prompt.make({ text: "Follow up" }),
        })
        const waiting = yield* sessions.wait(session.id).pipe(
          Effect.andThen(Deferred.succeed(waited, undefined)),
          Effect.forkChild,
        )
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)

        expect(yield* Deferred.isDone(waited)).toBe(false)
        yield* Deferred.succeed(secondGate, undefined)
        yield* Effect.all([Fiber.join(running), Fiber.join(waiting)])
        expect(forces).toEqual([true, false])
      }),
    ),
  )

  it.effect("rejects a missing session before observing execution", () =>
    Effect.gen(function* () {
      const { sessions } = yield* setup
      const missing = SessionV2.ID.make("ses_missing_wait")

      expect(yield* sessions.wait(missing).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
        sessionID: missing,
      })
      expect(forces).toEqual([])
    }),
  )
})
