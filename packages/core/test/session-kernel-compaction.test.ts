import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Node } from "@opencode-ai/core/effect/app-node"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionRouter } from "@opencode-ai/core/session/execution/router"
import { SessionInput } from "@opencode-ai/core/session/input"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { KernelPluginHost } from "@opencode-ai/core/session/kernel/plugin-host"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
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
const invocations: Array<Parameters<SessionCompaction.Interface["compact"]>[0]> = []
const transformedSummaries: SessionCompaction.Summary[] = []
let compactHandler: SessionCompaction.Interface["compact"] = () =>
  Effect.succeed({ compacted: true, shouldContinue: false })
const compaction = Layer.succeed(
  SessionCompaction.Service,
  SessionCompaction.Service.of({
    compact: (input) =>
      Effect.gen(function* () {
        invocations.push(input)
        const transform = (
          input as typeof input & {
            readonly transformSummary?: (input: {
              readonly sessionID: SessionV2.ID
              readonly text: string
              readonly recent: string
            }) => Effect.Effect<{ readonly text: string; readonly recent: string }>
          }
        ).transformSummary
        if (transform)
          transformedSummaries.push(
            yield* transform({ sessionID: input.session.id, text: "Provider summary", recent: "Recent tail" }),
          )
        return yield* compactHandler(input)
      }),
  }),
)
let compactionPermitted = true
const pluginHost = Layer.succeed(
  KernelPluginHost.Service,
  KernelPluginHost.Service.of({
    install: () => Effect.die("unused"),
    disable: () => Effect.void,
    dispose: () => Effect.void,
    has: () => Effect.succeed(false),
    snapshot: () => Effect.succeed([]),
    ownedContributions: () => Effect.succeed([]),
    ui: { list: () => Effect.succeed([]) },
    services: {
      provide: () => Effect.void,
      retract: () => Effect.void,
      has: () => Effect.succeed(false),
      get: () => Effect.die("unused"),
      list: () => Effect.succeed([]),
    },
    seams: {
      register: () => Effect.succeed(Effect.void),
      active: () => Effect.succeed(0),
      run: (name, event) =>
        name === KernelPluginHost.SeamName.compactionPolicyDecide
          ? Effect.succeed({ ...(event as object), permitted: compactionPermitted })
          : name === KernelPluginHost.SeamName.compactionSummaryTransform
            ? Effect.succeed({ ...(event as object), text: "Plugin summary", recent: "Plugin recent" })
            : Effect.succeed(event),
    },
  }),
)
const pluginMap = pluginLocationMap(undefined, undefined, undefined, Layer.merge(compaction, pluginHost))
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

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
    [[ProjectV2.node, projects], [SessionExecution.node, executionNode], pluginMap.replacement],
  ),
)

describe("Kernel compaction phase", () => {
  it.effect("routes public SessionV2 compaction through the fenced kernel owner", () =>
    Effect.gen(function* () {
      invocations.length = 0
      compactHandler = () => Effect.succeed({ compacted: true, shouldContinue: false })
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const prompt = Prompt.make({ text: "Preserve the durable boundary" })

      yield* sessions.compact({ sessionID: session.id, prompt })

      expect(invocations).toHaveLength(1)
      expect(invocations[0]).toMatchObject({ session, prompt, reason: "manual" })
      expect(yield* sessions.status(session.id)).toEqual({ type: "kernel", state: "idle" })
    }),
  )

  it.effect("applies the Kernel summary transform before compaction persists its checkpoint", () =>
    Effect.gen(function* () {
      transformedSummaries.length = 0
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({ location, engine: "kernel" })

      yield* sessions.compact({ sessionID: session.id })

      expect(transformedSummaries).toEqual([{ sessionID: session.id, text: "Plugin summary", recent: "Plugin recent" }])
    }),
  )
  it.effect("applies the Kernel compaction policy before invoking the compactor", () =>
    Effect.gen(function* () {
      invocations.length = 0
      compactionPermitted = false
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({ location, engine: "kernel" })

      yield* sessions.compact({ sessionID: session.id })

      expect(invocations).toEqual([])
      expect(yield* sessions.status(session.id)).toEqual({ type: "kernel", state: "idle" })
      compactionPermitted = true
    }),
  )

  it.effect("interrupts owned kernel compaction and settles a phase-only execution back to idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        invocations.length = 0
        const sessions = yield* SessionV2.Service
        const store = yield* LifecycleStore.Service
        const session = yield* sessions.create({ location, engine: "kernel" })
        const started = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        compactHandler = () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          )
        const running = yield* sessions.compact({ sessionID: session.id }).pipe(Effect.forkScoped)
        yield* Deferred.await(started)

        yield* sessions.interrupt(session.id)
        yield* Deferred.await(interrupted)

        expect(Exit.isFailure(yield* Fiber.await(running))).toBeTrue()
        expect(yield* store.get(session.id)).toMatchObject({ state: "idle", phase: undefined })
      }),
    ),
  )
  it.effect("acquires an idle phase lease into the compacting phase", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const lease = yield* store.acquireIdle(session.id, "compacting")
      const snapshot = yield* store.get(session.id)
      expect(snapshot).toMatchObject({ state: "active", phase: "compacting", generation: 1 })
      expect(snapshot.lease).toMatchObject({ generation: 1 })
      // A second acquisition while compacting conflicts.
      const conflict = yield* store.acquireIdle(session.id, "compacting").pipe(Effect.exit)
      expect(conflict._tag).toBe("Failure")
    }),
  )

  it.effect("a fenced release is rejected while a live release resets the row", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const lease = yield* store.acquireIdle(session.id, "compacting")
      yield* store.releaseIdle(lease)
      expect(yield* store.get(session.id)).toMatchObject({ state: "idle", phase: undefined })
      // Releasing the same lease again is fenced out.
      const stale = yield* store.releaseIdle(lease).pipe(Effect.flip)
      expect(stale).toMatchObject({ _tag: "StaleExecutionError" })
    }),
  )

  it.effect("a new turn conflicts with an active compaction phase", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const admitted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Wait for compaction" }),
        resume: false,
      })
      yield* store.acquireIdle(session.id, "compacting")
      const start = yield* store
        .start({
          sessionID: session.id,
          inputID: admitted.id,
          turnID: SessionMessage.ID.create(),
          attemptID: EventV2.ID.create(),
          assistantMessageID: SessionMessage.ID.create(),
          processIncarnation: "instance",
        })
        .pipe(Effect.exit)
      expect(start._tag).toBe("Failure")
      // The compaction itself can be fenced by an interrupt: a new owner wins.
      yield* store.acceptInterrupt({ sessionID: session.id, expectedGeneration: 1, reason: "user" })
      expect(yield* store.get(session.id)).toMatchObject({ state: "cancelling", generation: 2 })
    }),
  )
})
