import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionAttemptTable, SessionTurnTable } from "@opencode-ai/core/session/sql"
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
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      pluginMap.replacement,
    ],
  ),
)

describe("Engine isolation", () => {
  it.effect("startupCandidates never includes a kernel session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const kernel = yield* sessions.create({ location, engine: "kernel" })
      const classic = yield* sessions.create({ location, engine: "classic" })
      yield* sessions.prompt({ sessionID: kernel.id, prompt: Prompt.make({ text: "kernel pending" }), resume: false })
      yield* sessions.prompt({ sessionID: classic.id, prompt: Prompt.make({ text: "classic pending" }), resume: false })
      const candidates = yield* SessionInput.startupCandidates(db)
      expect(candidates).toContainEqual({ sessionID: classic.id })
      expect(candidates).not.toContainEqual({ sessionID: kernel.id })
    }),
  )

  it.effect("classic attempt coordination skips kernel session lifecycle events", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const kernel = yield* sessions.create({ location, engine: "kernel" })
      const classic = yield* sessions.create({ location, engine: "classic" })
      const timestamp = yield* DateTime.now
      for (const sessionID of [kernel.id, classic.id]) {
        yield* events.publish(SessionEvent.ProviderAttempt.Started, {
          sessionID,
          timestamp,
          attemptID: EventV2.ID.create(),
          assistantMessageID: SessionMessage.ID.create(),
          attempt: 1,
        })
      }
      const kernelRows = yield* db
        .select()
        .from(SessionAttemptTable)
        .where(eq(SessionAttemptTable.session_id, kernel.id))
        .all()
        .pipe(Effect.orDie)
      const classicRows = yield* db
        .select()
        .from(SessionAttemptTable)
        .where(eq(SessionAttemptTable.session_id, classic.id))
        .all()
        .pipe(Effect.orDie)
      expect(kernelRows).toHaveLength(0)
      expect(classicRows).toHaveLength(1)
    }),
  )

  it.effect("classic turn coordination skips kernel session lifecycle events", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const kernel = yield* sessions.create({ location, engine: "kernel" })
      const classic = yield* sessions.create({ location, engine: "classic" })
      const timestamp = yield* DateTime.now
      for (const sessionID of [kernel.id, classic.id]) {
        yield* events.publish(SessionEvent.Turn.Started, {
          sessionID,
          turnID: SessionMessage.ID.create(),
          timestamp,
        })
      }
      const kernelRows = yield* db
        .select()
        .from(SessionTurnTable)
        .where(eq(SessionTurnTable.session_id, kernel.id))
        .all()
        .pipe(Effect.orDie)
      const classicRows = yield* db
        .select()
        .from(SessionTurnTable)
        .where(eq(SessionTurnTable.session_id, classic.id))
        .all()
        .pipe(Effect.orDie)
      expect(kernelRows).toHaveLength(0)
      expect(classicRows).toHaveLength(1)
    }),
  )
})
