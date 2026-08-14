import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

// Harness copied verbatim from packages/core/test/session-create.test.ts:38-55.
const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const pluginMap = pluginLocationMap()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      pluginMap.replacement,
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("SessionV2 remove", () => {
  it.effect("keeps the deleted event as the aggregate tombstone", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* session.remove(created.id)

      const rows = yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie)
      expect(rows).toHaveLength(1)
      // The event table stores the versioned type (version suffix) — the same
      // form session-create.test.ts asserts for the created event.
      expect(rows[0]!.type).toBe(EventV2.versionedType(SessionEvent.Deleted.type, 1))

      const sessionRows = yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).all().pipe(Effect.orDie)
      expect(sessionRows).toHaveLength(0)
    }),
  )
})
