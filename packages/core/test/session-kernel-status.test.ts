import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { StatusProjector } from "@opencode-ai/core/session/kernel/status-projector"
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

const snapshot = (
  state: Parameters<typeof StatusProjector.deriveStatus>[0]["state"],
  phase?: Parameters<typeof StatusProjector.deriveStatus>[0]["phase"],
) => ({
  sessionID: SessionV2.ID.make("ses_status"),
  engine: "kernel" as const,
  generation: 1,
  state,
  ...(phase === undefined ? {} : { phase }),
  timeUpdated: DateTime.makeUnsafe(0),
})

describe("StatusProjector", () => {
  it.effect("derives idle, busy(phase), retry, cancelling, and recovery status", () =>
    Effect.gen(function* () {
      expect(StatusProjector.deriveStatus(snapshot("idle"))).toEqual({ type: "kernel", state: "idle" })
      expect(StatusProjector.deriveStatus(snapshot("active", "responding"))).toEqual({
        type: "kernel",
        state: "active",
        phase: "responding",
      })
      expect(StatusProjector.deriveStatus(snapshot("active", "tools"))).toEqual({
        type: "kernel",
        state: "active",
        phase: "tools",
      })
      expect(StatusProjector.deriveStatus(snapshot("retry_wait"))).toEqual({
        type: "kernel",
        state: "retry_wait",
      })
      expect(StatusProjector.deriveStatus(snapshot("cancelling"))).toEqual({
        type: "kernel",
        state: "cancelling",
      })
      expect(StatusProjector.deriveStatus(snapshot("needs_recovery"))).toEqual({
        type: "kernel",
        state: "needs_recovery",
      })
    }),
  )

  it.effect("exposes the derived status through SessionV2.status", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const admitted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Status turn" }),
        resume: false,
      })
      expect(yield* sessions.status(session.id)).toEqual({ type: "kernel", state: "idle" })
      const lease = yield* store.start({
        sessionID: session.id,
        inputID: admitted.id,
        turnID: SessionMessage.ID.create(),
        attemptID: EventV2.ID.create(),
        assistantMessageID: SessionMessage.ID.create(),
        processIncarnation: "incarnation-status",
      })
      expect(yield* sessions.status(session.id)).toEqual({
        type: "kernel",
        state: "active",
        phase: "dispatching",
      })
      // A classic Session keeps the classic status path.
      const classic = yield* sessions.create({ location })
      expect(yield* sessions.status(classic.id)).toEqual({ type: "idle" })
      yield* store.terminalize({ lease, outcome: "completed" })
      expect(yield* sessions.status(session.id)).toEqual({ type: "kernel", state: "idle" })
    }),
  )
})
