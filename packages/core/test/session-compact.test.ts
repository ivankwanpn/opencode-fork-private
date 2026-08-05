import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
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
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { testEffect } from "./lib/effect"

const location = Location.Ref.make({ directory: AbsolutePath.make(process.cwd()) })
const invocations: Array<Parameters<SessionCompaction.Interface["compact"]>[0]> = []
const drainInvocations: boolean[] = []
let compactHandler: SessionCompaction.Interface["compact"] = () =>
  Effect.succeed({ compacted: true, shouldContinue: false })
let drainHandler: (force: boolean) => Effect.Effect<void> = () => Effect.void

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)

const compaction = Layer.succeed(
  SessionCompaction.Service,
  SessionCompaction.Service.of({
    compact: (input) =>
      Effect.sync(() => invocations.push(input)).pipe(Effect.andThen(Effect.suspend(() => compactHandler(input)))),
  }),
)

const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (_sessionID, force) =>
        Effect.sync(() => drainInvocations.push(force)).pipe(Effect.andThen(Effect.suspend(() => drainHandler(force)))),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      exclusive: (sessionID, work) =>
        coordinator
          .exclusive(sessionID, work)
          .pipe(
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
          [SessionCompaction.node, compaction],
          [SessionExecution.node, SessionExecution.noopLayer],
        ]),
      ],
      [SessionExecution.node, execution],
    ],
  ),
)

const setup = Effect.gen(function* () {
  invocations.length = 0
  drainInvocations.length = 0
  compactHandler = () => Effect.succeed({ compacted: true, shouldContinue: false })
  drainHandler = () => Effect.void
  const sessions = yield* SessionV2.Service
  const session = yield* sessions.create({ location })
  return { sessions, session }
})

describe("SessionV2.compact", () => {
  it.effect("runs manual compaction with the projected session and custom prompt", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup
      const prompt = Prompt.make({ text: "Keep issue identifiers" })
      const events = yield* EventV2.Service
      const statuses: string[] = []
      const idleSeen = yield* Deferred.make<void>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== SessionStatusEvent.Status.type) return
          const data = Schema.decodeUnknownSync(SessionStatusEvent.Status.data)(event.data)
          if (data.sessionID !== session.id) return
          statuses.push(data.status.type)
          if (data.status.type === "idle") yield* Deferred.succeed(idleSeen, undefined)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)

      yield* sessions.compact({ sessionID: session.id, prompt })
      yield* Deferred.await(idleSeen)

      expect(invocations).toEqual([{ session, prompt, reason: "manual" }])
      expect(Array.from(yield* sessions.active)).toEqual([])
      expect(statuses).toEqual(["busy", "idle"])
    }),
    30_000,
  )

  it.effect("continues execution after successful automatic compaction", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup
      compactHandler = () => Effect.succeed({ compacted: true, shouldContinue: true })

      yield* sessions.compact({ sessionID: session.id, reason: "auto" })

      expect(invocations).toEqual([{ session, prompt: undefined, reason: "auto" }])
      expect(drainInvocations).toEqual([true])
    }),
    30_000,
  )

  it.effect("stops after automatic compaction when continuation is disabled", () =>
    Effect.gen(function* () {
      const { sessions, session } = yield* setup

      yield* sessions.compact({ sessionID: session.id, reason: "auto" })

      expect(invocations).toEqual([{ session, prompt: undefined, reason: "auto" }])
      expect(drainInvocations).toEqual([])
    }),
    30_000,
  )

  it.effect("rejects compaction while the same session is active", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sessions, session } = yield* setup
        const started = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        drainHandler = () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
        const running = yield* sessions.resume(session.id).pipe(Effect.forkChild)
        yield* Deferred.await(started)

        expect(yield* sessions.compact({ sessionID: session.id }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.ExecutionBusyError",
          sessionID: session.id,
        })
        expect(invocations).toEqual([])

        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(running)
      }),
    ),
  )

  it.effect("shares Session interruption with manual compaction", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { sessions, session } = yield* setup
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        compactHandler = () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          )

        const running = yield* sessions.compact({ sessionID: session.id }).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* sessions.interrupt(session.id)
        yield* Deferred.await(interrupted)

        expect(Exit.isFailure(yield* Fiber.await(running))).toBeTrue()
      }),
    ),
    30_000,
  )

  it.effect("rejects a missing session before resolving location services", () =>
    Effect.gen(function* () {
      invocations.length = 0
      const sessions = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_compaction")

      expect(yield* sessions.compact({ sessionID: missing }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
        sessionID: missing,
      })
      expect(invocations).toEqual([])
    }),
  )
})
