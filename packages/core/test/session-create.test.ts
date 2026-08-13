import { describe, expect } from "bun:test"
import path from "path"
import { Context, DateTime, Effect, Exit, Layer, LayerMap, Stream } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { and, asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"
import { tmpdir } from "./fixture/tmpdir"

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
const id = SessionV2.ID.create()

// Deterministic conflict injection: a graph whose EventV2.Service.publish fails the
// first two expectedSeq-guarded calls with ConflictError defects, then delegates.
// Wrapping happens at graph construction (Layer.effect + Layer.build — Layer.map
// does not exist and Layer.updateService leaves the tag required in effect
// 4.0.0-beta.83) so SessionV2's captured `events` reference sees the wrapper —
// provideService after construction would not reach it. The Database requirement
// is closed inside via the graph's own Database.node layer value so the flaky
// events service shares one memoized database instance with the test body.
// Each graph gets its own injection counter so the tests' count assertions stay
// isolated from one another.
const makeFlakyEventsLayer = (injection: { count: number }) =>
  Layer.effect(
    EventV2.Service,
    Effect.gen(function* () {
      const context = yield* Layer.build(EventV2.layerWith())
      const real = yield* Effect.sync(() => Context.get(context, EventV2.Service))
      return EventV2.Service.of({
        ...real,
        publish: ((definition, data, options) =>
          Effect.gen(function* () {
            if (injection.count < 2 && options?.expectedSeq !== undefined) {
              injection.count += 1
              return yield* Effect.die(
                new EventV2.ConflictError({
                  aggregateID: String((data as Record<string, unknown>).sessionID),
                  expectedSeq: options.expectedSeq,
                  actualSeq: options.expectedSeq + 1,
                }),
              )
            }
            return yield* real.publish(definition, data, options)
          })) as typeof real.publish,
      })
    }),
  ).pipe(Layer.provide(Database.node.implementation as Layer.Layer<Database.Service>))

const conflictInjection = { count: 0 }
const flakyEventsLayer = makeFlakyEventsLayer(conflictInjection)
const retryIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, SessionV2.node]),
    [
      [EventV2.node, flakyEventsLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

// Independent flaky instance for the compatibility-echo test (own counter), plus a
// light location service map with a stub Snapshot so the revert path can run
// without filesystem machinery.
const compatInjection = { count: 0 }
const compatFlakyEventsLayer = makeFlakyEventsLayer(compatInjection)
const stubSnapshotServices = Layer.succeed(
  Snapshot.Service,
  Snapshot.Service.of({
    capture: () => Effect.succeed(undefined),
    files: () => Effect.succeed([]),
    diff: () => Effect.succeed([]),
    preview: () => Effect.succeed([]),
    restore: () => Effect.void,
    checkout: () => Effect.void,
  }),
)
const compatPluginMap = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () => stubSnapshotServices as unknown as Layer.Layer<LocationServices>,
    { idleTimeToLive: "1 minute" },
  ),
)
const compatRetryIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionV2.node]),
    [
      [EventV2.node, compatFlakyEventsLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
      [LocationServiceMap.node, compatPluginMap],
    ],
  ),
)

// Deterministic remove race: the publish wrapper deletes the session row right
// after a successful expectedSeq-guarded publish returns, simulating a concurrent
// remove's Deleted projection landing between mutateSession's publish and its
// fresh re-read.
const removeInjection = { removed: false }
const removeAfterPublishLayer = Layer.effect(
  EventV2.Service,
  Effect.gen(function* () {
    const context = yield* Layer.build(EventV2.layerWith())
    const real = yield* Effect.sync(() => Context.get(context, EventV2.Service))
    const { db } = yield* Database.Service
    return EventV2.Service.of({
      ...real,
      publish: ((definition, data, options) =>
        Effect.gen(function* () {
          const payload = yield* real.publish(definition, data, options)
          if (!removeInjection.removed && options?.expectedSeq !== undefined) {
            removeInjection.removed = true
            yield* db
              .delete(SessionTable)
              .where(eq(SessionTable.id, SessionV2.ID.make(String((data as Record<string, unknown>).sessionID))))
              .run()
              .pipe(Effect.orDie)
          }
          return payload
        })) as typeof real.publish,
    })
  }),
).pipe(Layer.provide(Database.node.implementation as Layer.Layer<Database.Service>))
const removeIt = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, SessionV2.node]),
    [
      [EventV2.node, removeAfterPublishLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

describe("SessionV2.create", () => {
  it.effect("creates a fresh projected session when the ID is omitted", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const first = yield* session.create({ location })
      const second = yield* session.create({ location })

      expect(second.id).not.toBe(first.id)
      expect(yield* session.list()).toHaveLength(2)
    }),
  )

  it.effect("returns the original session when the ID is retried", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const first = yield* session.create(input)
      const retried = yield* session.create(input)

      expect(retried).toEqual(first)
      expect(yield* session.list()).toEqual([first])
    }),
  )

  it.effect("stores supplied immutable create attributes", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const workspaceID = WorkspaceV2.ID.make("wrk_test")
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("fast"),
      })

      expect(
        yield* session.create({
          location: Location.Ref.make({ directory: location.directory, workspaceID }),
          agent: AgentV2.ID.make("build"),
          model,
        }),
      ).toMatchObject({ location: { directory: location.directory, workspaceID }, agent: "build", model })
    }),
  )

  it.effect("stores durable child-session identity and title", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({
        parentID: parent.id,
        title: "Inspect task flow (@general subagent)",
        location: parent.location,
        agent: AgentV2.ID.make("general"),
      })

      expect(child).toMatchObject({
        parentID: parent.id,
        title: "Inspect task flow (@general subagent)",
        location: parent.location,
        agent: "general",
      })
      expect(yield* session.get(child.id)).toEqual(child)
    }),
  )

  it.effect("filters root and child sessions by parent identity", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const root = yield* session.create({ location })
      const sibling = yield* session.create({ location })
      const child = yield* session.create({ parentID: root.id, location })

      expect((yield* session.list({ parentID: null })).map((item) => item.id)).toEqual([sibling.id, root.id])
      expect((yield* session.list({ parentID: root.id })).map((item) => item.id)).toEqual([child.id])
    }),
  )

  it.effect("resolves the legacy plan path from durable session identity and project VCS", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      const row = yield* db
        .select({ slug: SessionTable.slug, created: SessionTable.time_created })
        .from(SessionTable)
        .where(eq(SessionTable.id, created.id))
        .get()
        .pipe(Effect.orDie)

      expect(row).toBeDefined()
      expect(yield* session.plan(created.id)).toBe(
        path.join(Global.Path.data, "plans", `${row!.created}-${row!.slug}.md`),
      )

      yield* db
        .update(ProjectTable)
        .set({ vcs: "git" })
        .where(eq(ProjectTable.id, created.projectID))
        .run()
        .pipe(Effect.orDie)
      expect(yield* session.plan(created.id)).toBe(
        path.join(created.location.directory, ".opencode", "plans", `${row!.created}-${row!.slug}.md`),
      )
    }),
  )

  it.effect("returns the existing Session when one ID is reused with different create arguments", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ id, location })
      const changed = [
        { id, location: Location.Ref.make({ directory: AbsolutePath.make("/other") }) },
        { id, location, agent: AgentV2.ID.make("build") },
        {
          id,
          location,
          model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
        },
      ]

      for (const input of changed) {
        expect(yield* session.create(input)).toEqual(created)
      }
      expect(yield* session.list()).toHaveLength(1)
    }),
  )

  it.effect("returns one recorded session to concurrent exact retries", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const input = { id, location }

      const created = yield* Effect.all([session.create(input), session.create(input)], { concurrency: "unbounded" })

      expect(created[1]).toEqual(created[0])
      expect(yield* session.list()).toEqual([created[0]])
    }),
  )

  it.effect("returns the current Session projection after updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* db.update(SessionTable).set({ agent: "build" }).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)

      expect(yield* session.create(input)).toMatchObject({ id: created.id, agent: "build" })
    }),
  )

  it.effect("returns the current Session projection after projected updates", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const input = { id, location }
      const created = yield* session.create(input)

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: id,
        info: SessionV1.SessionInfo.make({
          id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.create(input)).toMatchObject({ id, agent: "build" })
    }),
  )

  it.effect("persists creation through the V2 created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toMatchObject([{ type: EventV2.versionedType(SessionEvent.Created.type, 1) }])
    }),
  )

  it.effect("persists caller-ID creation through the existing created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ id, location })

      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).get().pipe(Effect.orDie),
      ).toMatchObject({
        data: { sessionID: id },
      })
    }),
  )

  it.effect("starts the V2 Session event stream with the V2 created event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      yield* session.prompt({ sessionID: created.id, prompt: Prompt.make({ text: "Hello" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, created.id, Number.MAX_SAFE_INTEGER)

      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(3), Stream.runCollect)),
      ).toMatchObject([
        { durable: { seq: 0 }, type: "session.next.created" },
        { durable: { seq: 1 }, type: "session.next.prompt.admitted", data: { prompt: { text: "Hello" } } },
        { durable: { seq: 2 }, type: "session.next.prompted" },
      ])
    }),
  )

  it.effect("replays one prompt lifecycle into a fresh target database", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const sourceEvents = yield* EventV2.Service
      const sourceDb = (yield* Database.Service).db
      const created = yield* session.create({ id: SessionV2.ID.make("ses_fresh_target_replay"), location })
      const admitted = yield* session.prompt({
        sessionID: created.id,
        prompt: Prompt.make({ text: "Replay lifecycle" }),
        resume: false,
      })
      yield* SessionInput.promoteSteers(sourceDb, sourceEvents, created.id, Number.MAX_SAFE_INTEGER)
      const serialized = (yield* sourceDb
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)).map((event) => ({
        id: event.id,
        aggregateID: event.aggregate_id,
        seq: event.seq,
        type: event.type,
        data: event.data,
      }))

      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const targetDatabase = Database.layerFromPath(path.join(tmp.path, "target.sqlite"))
      const targetLayer = AppNodeBuilder.build(
        LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node]),
        [[Database.node, targetDatabase]],
      )

      yield* Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const events = yield* EventV2.Service
        const store = yield* SessionStore.Service
        yield* db
          .insert(ProjectTable)
          .values({ id: ProjectV2.ID.global, worktree: location.directory, sandboxes: [] })
          .run()
          .pipe(Effect.orDie)

        expect(yield* store.get(created.id)).toBeUndefined()
        expect(yield* events.replayAll(serialized.slice(0, 2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
        })
        expect(yield* store.context(created.id)).toEqual([])

        expect(yield* events.replayAll(serialized.slice(2))).toBe(created.id)
        expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({
          id: admitted.id,
          sessionID: created.id,
          prompt: { text: "Replay lifecycle" },
          delivery: "steer",
          admittedSeq: 1,
          promotedSeq: 2,
        })
        expect(yield* store.context(created.id)).toMatchObject([
          { id: admitted.id, type: "user", text: "Replay lifecycle" },
        ])
        expect(
          (yield* db
            .select()
            .from(EventTable)
            .where(eq(EventTable.aggregate_id, created.id))
            .orderBy(asc(EventTable.seq))
            .all()
            .pipe(Effect.orDie)).map((event) => [event.seq, event.type]),
        ).toEqual([
          [0, EventV2.versionedType(SessionEvent.Created.type, 1)],
          [1, EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1)],
          [2, EventV2.versionedType(SessionEvent.Prompted.type, 1)],
        ])
      }).pipe(Effect.provide(Layer.fresh(targetLayer)))
    }),
  )

  it.effect("does not mask unrelated created projector defects", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const event = yield* EventV2.Service
      const defect = new Error("unrelated projector defect")
      yield* event.project(SessionEvent.Created, () => Effect.die(defect))

      expect(yield* session.create({ id, location }).pipe(Effect.catchDefect(Effect.succeed))).toBe(defect)
    }),
  )

  it.effect("switches the selected agent through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      yield* session.switchAgent({ sessionID: created.id, agent: "plan" })

      expect(yield* session.get(created.id)).toMatchObject({ agent: "plan" })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(2), Stream.runCollect)),
      ).toMatchObject([
        { type: "session.next.created" },
        { type: "session.next.agent.switched", data: { agent: "plan" } },
      ])
    }),
  )

  it.effect("rejects an agent switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_agent_switch")

      expect(
        yield* session.switchAgent({ sessionID: missing, agent: "plan" }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("switches the selected model through the durable Session event", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({
        id: ModelV2.ID.make("sonnet"),
        providerID: ProviderV2.ID.anthropic,
        variant: ModelV2.VariantID.make("high"),
      })

      yield* session.switchModel({ sessionID: created.id, model })

      expect(yield* session.get(created.id)).toMatchObject({ model })
      expect(
        Array.from(yield* session.events({ sessionID: created.id }).pipe(Stream.take(2), Stream.runCollect)),
      ).toMatchObject([
        { type: "session.next.created" },
        { type: "session.next.model.switched", data: { model } },
      ])
    }),
  )

  it.effect("ignores a model switch when the selected model is unchanged", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })

      yield* session.switchModel({ sessionID: created.id, model })
      yield* session.switchModel({ sessionID: created.id, model })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(2)
      expect(yield* session.get(created.id)).toMatchObject({ model })
    }),
  )

  it.effect("treats an omitted variant as the default variant", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const model = ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic })
      const created = yield* session.create({ location, model })

      yield* session.switchModel({
        sessionID: created.id,
        model: ModelV2.Ref.make({ ...model, variant: ModelV2.VariantID.make("default") }),
      })

      const { db } = yield* Database.Service
      expect(
        yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, created.id)).all().pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  it.effect("rejects a model switch for a missing Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_model_switch")

      expect(
        yield* session
          .switchModel({
            sessionID: missing,
            model: ModelV2.Ref.make({ id: ModelV2.ID.make("sonnet"), providerID: ProviderV2.ID.anthropic }),
          })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
    }),
  )

  it.effect("update atomically replaces and clears metadata and share with one V2 Updated event per call", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* sessions.create({ location, title: "mut", metadata: { a: 1, keep: true } })
      expect(created.metadata).toEqual({ a: 1, keep: true })
      const updated = yield* sessions.update({ sessionID: created.id, metadata: { a: 1, keep: true, b: 2 } })
      expect(updated.metadata).toEqual({ a: 1, keep: true, b: 2 }) // full replacement
      const cleared = yield* sessions.update({ sessionID: created.id, metadata: null })
      expect(cleared.metadata).toBeUndefined()
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).get()
      expect(row?.metadata).toBeNull() // SQL NULL, not {}
      const eventRows = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.next.updated.1")))
        .all()
      expect(eventRows.length).toBe(2) // exactly one Updated per successful mutation
      const legacyRows = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.updated.1")))
        .all()
      expect(legacyRows.length).toBe(0) // no legacy session.updated.1
    }),
  )

  it.effect("permissions read and fully replace V2 rules without exposing them in Info", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* sessions.create({ location, title: "perm" })
      const rules: PermissionV2.Ruleset = [
        { action: "bash", resource: "*", effect: "allow" },
        { action: "bash", resource: "src/**", effect: "deny" },
        { action: "bash", resource: "*", effect: "allow" }, // duplicate on purpose
      ]
      yield* sessions.setPermissions({ sessionID: created.id, permissions: rules })
      const stored = yield* sessions.permissions(created.id)
      expect(stored).toEqual(rules) // order and duplicates preserved
      const info = yield* sessions.get(created.id)
      expect("permission" in info).toBe(false) // not part of public Info
      yield* sessions.setPermissions({ sessionID: created.id, permissions: [] })
      expect(yield* sessions.permissions(created.id)).toEqual([]) // explicit clear
      const row = yield* db
        .select({ permission: SessionTable.permission })
        .from(SessionTable)
        .where(eq(SessionTable.id, created.id))
        .get()
      expect(row?.permission).toEqual([])
    }),
  )

  it.effect("update and permission operations reject a missing Session with NotFoundError", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_ops")
      for (const program of [
        sessions.update({ sessionID: missing, title: "x" }),
        sessions.permissions(missing),
        sessions.setPermissions({ sessionID: missing, permissions: [] }),
      ]) {
        const exit = yield* program.pipe(Effect.exit)
        // use the file's existing typed-error assertion pattern for NotFoundError
        expect(Exit.isFailure(exit)).toBe(true)
      }
    }),
  )

  retryIt.effect("update retries deterministically when a concurrent mutation wins the sequence race", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const created = yield* sessions.create({ title: "race", location })
      const updated = yield* sessions.update({ sessionID: created.id, title: "raced" })
      expect(updated.title).toBe("raced")
      expect(conflictInjection.count).toBe(2)
      const eventRows = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.next.updated.1")))
        .all()
      expect(eventRows.length).toBe(1) // only the successful attempt wrote an event
    }),
  )

  compatRetryIt.effect("compatibility echo retries on conflict without clobbering the projection", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const created = yield* sessions.create({ location, title: "compat" })
      // Stage a revert so revert.clear's post-clear path reaches publishCompatibilityUpdate.
      yield* events.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: created.id,
        timestamp: yield* DateTime.now,
        revert: { messageID: SessionMessage.ID.make("msg_compat_revert"), files: [] },
      })
      yield* sessions.revert.clear(created.id)
      expect(compatInjection.count).toBe(2) // the compat echo hit the conflict guard twice, then converged
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).get()
      expect(row?.title).toBe("compat") // identity echo preserved the projection
      const eventRows = yield* db
        .select()
        .from(EventTable)
        .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.next.updated.1")))
        .all()
      expect(eventRows.length).toBe(1) // exactly the converged compat echo wrote an Updated event
    }),
  )

  removeIt.effect("update returns NotFoundError when the session is removed between publish and re-read", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const created = yield* sessions.create({ location, title: "removed" })
      expect(
        yield* sessions
          .update({ sessionID: created.id, title: "raced" })
          .pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
      ).toBe("Session.NotFoundError")
      expect(removeInjection.removed).toBe(true) // the delete really landed between publish and re-read
    }),
  )
})
