import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

// Harness copied verbatim from packages/core/test/session-create.test.ts:38-55.
// The projects stub resolves every directory to ProjectV2.ID.global, so all
// sessions share one project and directory varies only through location.
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
const otherLocation = Location.Ref.make({ directory: AbsolutePath.make("/other") })

// time_updated is bumped through db updates so the tests are deterministic
// (session.update timestamps share a millisecond with creation timestamps,
// which would make desc ordering fall back to the ID tiebreak).
const bumpUpdated = (db: Database.Interface["db"], sessionID: SessionV2.ID, by: number) =>
  db
    .update(SessionTable)
    .set({ time_updated: sql`${SessionTable.time_updated} + ${by}` })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)

describe("SessionV2 list query semantics", () => {
  it.effect("orders by updated desc when orderBy is updated", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const first = yield* session.create({ location })
      const second = yield* session.create({ location })
      yield* bumpUpdated(db, first.id, 1000)

      const listed = yield* session.list({ orderBy: "updated" })
      expect(listed.map((item) => item.id)).toEqual([first.id, second.id])
    }),
  )

  it.effect("filters sessions updated since start", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const first = yield* session.create({ location })
      const second = yield* session.create({ location })
      const secondUpdated = (
        yield* db
          .select({ updated: SessionTable.time_updated })
          .from(SessionTable)
          .where(eq(SessionTable.id, second.id))
          .get()
          .pipe(Effect.orDie)
      )!.updated
      yield* bumpUpdated(db, first.id, 1000)

      const listed = yield* session.list({ start: secondUpdated + 500 })
      expect(listed.map((item) => item.id)).toEqual([first.id])
    }),
  )

  it.effect("filters sessions by exact and prefixed subpath", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const exact = yield* session.create({ location })
      const prefixed = yield* session.create({ location })
      const other = yield* session.create({ location })
      yield* db.update(SessionTable).set({ path: "packages/opencode/src" }).where(eq(SessionTable.id, exact.id)).run().pipe(Effect.orDie)
      yield* db.update(SessionTable).set({ path: "packages/opencode/src/x" }).where(eq(SessionTable.id, prefixed.id)).run().pipe(Effect.orDie)
      yield* db.update(SessionTable).set({ path: "packages/other" }).where(eq(SessionTable.id, other.id)).run().pipe(Effect.orDie)

      const listed = yield* session.list({ project: ProjectV2.ID.global, subpath: RelativePath.make("packages/opencode/src") })
      expect(listed.map((item) => item.id).sort()).toEqual([exact.id, prefixed.id].sort())
    }),
  )

  it.effect("includes pathless sessions of the given directory in a subpath query", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const withPath = yield* session.create({ location })
      const pathlessSame = yield* session.create({ location })
      const pathlessOther = yield* session.create({ location: otherLocation })
      yield* db.update(SessionTable).set({ path: "packages/opencode/src" }).where(eq(SessionTable.id, withPath.id)).run().pipe(Effect.orDie)

      const listed = yield* session.list({
        project: ProjectV2.ID.global,
        subpath: RelativePath.make("packages/opencode/src"),
        directory: AbsolutePath.make("/project"),
      })
      expect(listed.map((item) => item.id).sort()).toEqual([withPath.id, pathlessSame.id].sort())
    }),
  )

  it.effect("decodes the project variant with directory and subpath intact", () =>
    Effect.gen(function* () {
      const decoded = Schema.decodeUnknownSync(SessionV2.ListInput)({
        project: ProjectV2.ID.global,
        directory: AbsolutePath.make("/project"),
        subpath: RelativePath.make("packages/opencode"),
      })
      expect("project" in decoded).toBe(true)
      if (!("project" in decoded)) return
      expect(decoded.directory).toBe(AbsolutePath.make("/project"))
      expect(decoded.subpath).toBe(RelativePath.make("packages/opencode"))
    }),
  )

  it.effect("does not treat LIKE wildcards in subpaths as patterns", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const underscore = yield* session.create({ location })
      const lookalike = yield* session.create({ location })
      yield* db.update(SessionTable).set({ path: "foo_bar/src" }).where(eq(SessionTable.id, underscore.id)).run().pipe(Effect.orDie)
      yield* db.update(SessionTable).set({ path: "fooXbar/src" }).where(eq(SessionTable.id, lookalike.id)).run().pipe(Effect.orDie)

      const listed = yield* session.list({ project: ProjectV2.ID.global, subpath: RelativePath.make("foo_bar") })
      expect(listed.map((item) => item.id)).toEqual([underscore.id])
    }),
  )
})
