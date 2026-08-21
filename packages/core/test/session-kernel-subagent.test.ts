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
import { AgentV2 } from "@opencode-ai/core/agent"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionRouter } from "@opencode-ai/core/session/execution/router"
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
      SessionCommand.node,
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

describe("Kernel subagents", () => {
  it.effect("gives parent and child independent generations and leases", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const commands = yield* SessionCommand.Service
      const store = yield* LifecycleStore.Service
      const parent = yield* sessions.create({ location, engine: "kernel" })
      const child = yield* commands.create({
        parentID: parent.id,
        title: "child (@general subagent)",
        location: parent.location,
        agent: AgentV2.ID.make("general"),
        engine: "kernel",
      })
      expect(parent.engine).toBe("kernel")
      expect(child.engine).toBe("kernel")
      const admitted = yield* sessions.prompt({
        sessionID: child.id,
        prompt: Prompt.make({ text: "child turn" }),
        resume: false,
      })
      const parentLease = yield* store.acquireIdle(parent.id, "responding")
      const childStart = yield* store
        .start({
          sessionID: child.id,
          inputID: admitted.id,
          turnID: SessionMessage.ID.create(),
          attemptID: EventV2.ID.create(),
          assistantMessageID: SessionMessage.ID.create(),
          processIncarnation: "child-process",
        })
        .pipe(Effect.exit)
      expect(childStart._tag).toBe("Success")
      if (childStart._tag === "Success") {
        expect(childStart.value.token).not.toBe(parentLease.token)
        expect(childStart.value.generation).toBe(1)
      }
      expect((yield* store.get(parent.id)).lease?.token).toBe(parentLease.token)
    }),
  )

  it.effect("child inputs do not leak into the parent delivery boundary", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const parent = yield* sessions.create({ location, engine: "kernel" })
      const child = yield* sessions.create({ parentID: parent.id, location, engine: "kernel" })
      yield* sessions.prompt({ sessionID: child.id, prompt: Prompt.make({ text: "child only" }), resume: false })
      expect(yield* SessionInput.pending((yield* Database.Service).db, parent.id)).toEqual([])
      expect(yield* SessionInput.pending((yield* Database.Service).db, child.id)).toHaveLength(1)
      expect((yield* store.get(parent.id)).state).toBe("idle")
    }),
  )
})
