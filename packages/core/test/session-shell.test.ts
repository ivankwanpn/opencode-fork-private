import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { MCP } from "@opencode-ai/core/mcp"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionShell } from "@opencode-ai/core/session/shell"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
const invocations: SessionShell.ExecuteInput[] = []
const drainForces: boolean[] = []
let executeHandler: (input: SessionShell.ExecuteInput) => Effect.Effect<void> = () => Effect.void
let drainHandler: (force: boolean) => Effect.Effect<void> = () => Effect.void

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const shell = Layer.succeed(
  SessionShell.Service,
  SessionShell.Service.of({
    execute: (input) =>
      Effect.sync(() => invocations.push(input)).pipe(Effect.andThen(Effect.suspend(() => executeHandler(input)))),
  }),
)

const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (_sessionID, force) =>
        Effect.sync(() => drainForces.push(force)).pipe(Effect.andThen(Effect.suspend(() => drainHandler(force)))),
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

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [
        LocationServiceMap.node,
        buildLocationServiceMap([
          [MCP.node, MCP.emptyLayer],
          [SessionShell.node, shell],
          [SessionExecution.node, SessionExecution.noopLayer],
        ]),
      ],
      [SessionExecution.node, execution],
    ],
  ),
)

const setup = Effect.gen(function* () {
  invocations.length = 0
  drainForces.length = 0
  executeHandler = (input) =>
    input.onOutput("first ").pipe(Effect.andThen(input.onOutput("second")))
  drainHandler = () => Effect.void
  const sessions = yield* SessionV2.Service
  const session = yield* sessions.create({ location })
  return { sessions, session }
})

describe("SessionV2.shell", () => {
  it.effect("records live output and one replayable shell message", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup
      const events = yield* EventV2.Service
      const eventID = EventV2.ID.create()
      const userID = SessionMessage.ID.make("msg_legacy_shell_user")
      const deltas: string[] = []
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionEvent.Shell.Delta.type)
            deltas.push((event.data as { readonly delta: string }).delta)
        }),
      )

      yield* sessions.shell({
        id: eventID,
        userID,
        sessionID: session.id,
        command: "printf output",
        resume: false,
      })

      yield* unsubscribe
      expect(deltas).toEqual(["first ", "second"])
      expect(invocations).toMatchObject([{ command: "printf output", cwd: location.directory }])
      expect(yield* sessions.context(session.id)).toMatchObject([
        {
          type: "shell",
          userID,
          callID: eventID,
          command: "printf output",
          output: "first second",
          time: { completed: expect.anything() },
        },
      ])
      expect(
        (yield* sessions.history({ sessionID: session.id, limit: 10 })).events
          .filter((event) => event.type.startsWith("session.next.shell"))
          .map((event) => [event.id, event.type]),
      ).toEqual([
        [eventID, SessionEvent.Shell.Started.type],
        [expect.stringMatching(/^evt_/), SessionEvent.Shell.Ended.type],
      ])
      expect(drainForces).toEqual([])
    }),
    30_000,
  )

  it.effect("schedules a non-forced drain after successful shell execution by default", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup
      const drained = yield* Deferred.make<void>()
      drainHandler = () => Deferred.succeed(drained, undefined)

      yield* sessions.shell({ sessionID: session.id, command: "printf output" })
      yield* Deferred.await(drained)

      expect(drainForces).toEqual([false])
    }),
    30_000,
  )

  it.effect("rejects shell execution while the same session is active", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sessions, session } = yield* setup
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        drainHandler = () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
        const running = yield* sessions.resume(session.id).pipe(Effect.forkChild)
        yield* Deferred.await(started)

        const error = yield* sessions
          .shell({ sessionID: session.id, command: "printf blocked", resume: false })
          .pipe(Effect.flip)
        expect(error).toMatchObject({ _tag: "Session.ExecutionBusyError", sessionID: session.id })
        expect(invocations).toEqual([])

        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(running)
      }),
    ),
  )

  it.effect("settles partial output durably when interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sessions, session } = yield* setup
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        executeHandler = (input) =>
          input.onOutput("partial").pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          )

        const running = yield* sessions
          .shell({ sessionID: session.id, command: "long command", resume: false })
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* sessions.interrupt(session.id)
        yield* Deferred.await(interrupted)

        expect(Exit.isFailure(yield* Fiber.await(running))).toBeTrue()
        expect(yield* sessions.context(session.id)).toMatchObject([
          {
            type: "shell",
            output: "partial\n\n<metadata>\nUser aborted the command\n</metadata>",
            time: { completed: expect.anything() },
          },
        ])
        expect(drainForces).toEqual([])
      }),
    ),
    30_000,
  )
})
