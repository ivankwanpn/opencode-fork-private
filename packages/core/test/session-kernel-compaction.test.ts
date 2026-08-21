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
import { SessionInput } from "@opencode-ai/core/session/input"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
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
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      pluginMap.replacement,
    ],
  ),
)

describe("Kernel compaction phase", () => {
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
