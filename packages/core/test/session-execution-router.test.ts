import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
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

// Classic engine double that records every routed call. Kernel is not installed
// in Task 1, so kernel Sessions must fail with KernelUnavailableError and never
// reach this implementation.
const classicCalls: string[] = []
const classic = SessionExecution.Service.of({
  active: Effect.succeed(new Set([SessionSchema.ID.make("ses_classic_active")])),
  resume: (id) => Effect.sync(() => classicCalls.push(`resume:${id}`)),
  exclusive: (id, work) => Effect.sync(() => classicCalls.push(`exclusive:${id}`)).pipe(Effect.andThen(work)),
  wake: (id) => Effect.sync(() => classicCalls.push(`wake:${id}`)),
  wait: (id) => Effect.sync(() => classicCalls.push(`wait:${id}`)),
  interrupt: (id) => Effect.sync(() => classicCalls.push(`interrupt:${id}`)),
})

// SessionExecution.node is a root dependency so the compiled graph exposes the
// routed facade to test bodies; nested-only dependencies are hidden by
// Layer.provide inside SessionV2's node.
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node, SessionExecution.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.routingLayer({ classic })],
      pluginMap.replacement,
    ],
  ),
)

describe("SessionExecutionRouter", () => {
  it.effect("stores an immutable execution engine and defaults existing rows to classic", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const classic = yield* sessions.create({ location, id: SessionSchema.ID.make("ses_classic_engine") })
      const kernel = yield* sessions.create({ location, id: SessionSchema.ID.make("ses_kernel_engine"), engine: "kernel" })
      expect(classic.engine).toBe("classic")
      expect(kernel.engine).toBe("kernel")
      expect((yield* sessions.get(kernel.id)).engine).toBe("kernel")
      // The engine is fixed at creation and never changes with later mutations.
      yield* sessions.update({ sessionID: kernel.id, title: "renamed" })
      expect((yield* sessions.get(kernel.id)).engine).toBe("kernel")
    }),
  )

  it.effect("routes classic sessions to the classic engine", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      classicCalls.length = 0
      const classic = yield* sessions.create({ location })
      yield* execution.resume(classic.id)
      yield* execution.wake(classic.id)
      expect(classicCalls).toEqual([`resume:${classic.id}`, `wake:${classic.id}`])
    }),
  )

  it.effect("never falls back when a kernel engine is unavailable", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const execution = yield* SessionExecution.Service
      classicCalls.length = 0
      const session = yield* sessions.create({ location, engine: "kernel" })
      const error = yield* execution.resume(session.id).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "KernelUnavailableError", sessionID: session.id })
      expect(classicCalls).toEqual([])
    }),
  )

  it.effect("resolves a missing session with Session.NotFoundError", () =>
    Effect.gen(function* () {
      const execution = yield* SessionExecution.Service
      const missing = SessionSchema.ID.make("ses_missing_router")
      const error = yield* execution.resume(missing).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Session.NotFoundError", sessionID: missing })
    }),
  )

  it.effect("unions the active snapshots of every registered engine", () =>
    Effect.gen(function* () {
      const execution = yield* SessionExecution.Service
      expect(yield* execution.active).toEqual(new Set([SessionSchema.ID.make("ses_classic_active")]))
    }),
  )
})
