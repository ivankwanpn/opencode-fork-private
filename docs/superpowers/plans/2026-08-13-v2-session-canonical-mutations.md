# V2 Session Canonical Mutations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `SessionV2.Service` an atomic, concurrency-safe canonical mutation surface (metadata/share/permissions) and make `PermissionV2`/`CodeModeTool` apply Session-level permission rules, closing the remaining Core gaps of the V1→V2 hard cut.

**Architecture:** A durable optimistic-concurrency primitive (`expectedSeq`) is added to `EventV2.publish` as a defect-based conflict guard (repo precedent: `promoteInput`/`LifecycleConflict` in `packages/core/src/session.ts:786-791`), keeping the publish signature unchanged. `SessionV2` gains one file-local mutation boundary (`mutateSession`) that reads → derives → publishes `SessionEvent.Updated` with `expectedSeq` and retries on conflict. `PermissionV2.configured()` and CodeMode's execution-time catalog filter then merge agent → Session → prompt rules in canonical order.

**Tech Stack:** Bun 1.3.x, TypeScript (tsgo typecheck), Effect 4.0.0-beta.83, Drizzle + SQLite, bun test.

**Spec:**
- `docs/superpowers/specs/2026-08-13-v2-session-consumer-hard-cut-design.md` (Phase 3: Canonical mutations; Error Semantics)
- `V1-to-V2-migration.md` (批次 8 前置條件)
- `docs/superpowers/handoffs/2026-08-13-v2-hard-cut-handoff.md` (Paused Next Batch: Core Canonical Mutations)

## Global Constraints

- Continue only in `D:\agent-complete\opencode-fork-private-999.0.15`; branch `999.0.17`; do not rewrite the 16 existing local commits.
- Do not modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` or `docs/superpowers/handoffs/` contents beyond the plan file.
- No migrated consumer may call legacy `Session.Service`, query legacy transcript tables, or catch a V2 error and retry through V1. Missing V2 behavior is implemented through the canonical V2 event/projector path.
- A successful mutation must publish exactly one durable `SessionEvent.Updated`, use one timestamp for `time.updated` and the event, project the complete snapshot, and return the projected result. It must not publish legacy `session.updated.1`.
- Do not put permissions in `SessionSchema.Info`; expose explicit `permissions`/`setPermissions` operations.
- `SessionExecution.exclusive` must not become the mutex for ordinary aggregate CRUD. Cross-process limitations must not be hidden.
- Tests: real Database + EventV2 journal + projector where practical; barrier/Deferred coordination only — no sleeps, no probabilistic race loops. Run tests from package directories, never repository root. RED → GREEN → refactor.
- Commits: stage explicit paths only (never `git add .`); use `git -c core.hooksPath=.git/hooks commit -m "type(scope): summary"`.
- Do not change public Protocol, Server `HttpApi`, or `packages/schema` in this plan. Do not run `bun run generate`.
- After this plan's tasks, fresh gates: `packages/core` tests + typecheck, downstream typechecks (`packages/server`, `packages/sdk-next`, `packages/opencode`), `git diff --check`, staged-file audit, then update `V1-to-V2-migration.md`.

---

### Task 0: EventV2 Optimistic Concurrency Primitive (`expectedSeq`)

**Files:**
- Modify: `packages/core/src/event.ts` (add `ConflictError`; extend `PublishOptions`, `commitDurableEvent` input, `publishEvent`, `publish`)
- Create: `packages/core/test/event-concurrency.test.ts`

**Interfaces:**
- Consumes: `EventSequenceTable`, `EventTable` from `./event/sql`; `db.transaction({ behavior: "immediate" })` (existing, `event.ts:351`).
- Produces:
  - `export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("EventV2.Conflict", { aggregateID: Schema.String, expectedSeq: Schema.Number, actualSeq: Schema.Number }) {}`
  - `PublishOptions.expectedSeq?: number` — when set and the aggregate's current `event_sequence.seq` differs at commit time, publish dies with `ConflictError` (a defect, caught by callers via `Effect.catchDefect`).
  - Semantics for later tasks: `SessionV2.mutateSession` passes `expectedSeq = await EventV2.latestSequence(db, sessionID)` read immediately before deriving the snapshot, and retries the whole read→derive→publish cycle on `ConflictError`.

- [ ] **Step 0: Read context**
  - Read `packages/core/test/session-projector.test.ts` top-to-bottom to learn the fixture idioms (`testEffect(AppNodeBuilder.build(...))`, `SessionEvent.SessionSnapshot.make` helper usage, `EventTable`/`EventSequenceTable` query patterns).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/event-concurrency.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Cause, DateTime, Deferred, Effect, Exit, Fiber, Option } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node])))
const aggregateID = SessionV2.ID.make("agg_concurrency_test")

const fixtureSnapshot = () =>
  SessionEvent.SessionSnapshot.make({
    id: SessionV2.ID.make("ses_fixture"),
    projectID: Project.ID.global,
    slug: "test",
    version: "test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    title: "test",
    location: { directory: AbsolutePath.make("/project") },
  })

const updated = (snapshot: SessionEvent.SessionSnapshot, sessionID: string) =>
  ({
    timestamp: snapshot.time.updated,
    sessionID,
    info: snapshot,
  }) as const

describe("EventV2 expectedSeq", () => {
  it.effect("publishes when expectedSeq matches the current aggregate sequence", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const snapshot = fixtureSnapshot()
      const seq = yield* EventV2.latestSequence(db, aggregateID)
      const event = yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID), {
        expectedSeq: seq,
      })
      expect(event.durable?.seq).toBe(seq + 1)
    }),
  )

  it.effect("dies with ConflictError when expectedSeq is stale", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const snapshot = fixtureSnapshot()
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID))
      const stale = yield* EventV2.latestSequence(db, aggregateID)
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID)) // advances the sequence
      const exit = yield* events
        .publish(SessionEvent.Updated, updated(snapshot, aggregateID), { expectedSeq: stale })
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(
        Option.isSome(Cause.find(exit.cause, (cause) => cause instanceof EventV2.ConflictError)),
      ).toBe(true)
      const rows = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .all()
        .pipe(Effect.orDie)
      expect(rows.length).toBe(2) // the stale publish wrote nothing
    }),
  )

  it.effect("conflict is observable and a retry with a fresh expectedSeq converges deterministically", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const barrier = yield* Deferred.make<void>()
      const snapshot = fixtureSnapshot()
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID))
      const fiber = yield* Effect.fork(
        Effect.gen(function* () {
          const seq = yield* EventV2.latestSequence(db, aggregateID)
          yield* Deferred.await(barrier) // deterministic pause: another publish wins the race
          yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID), { expectedSeq: seq })
        }),
      )
      yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID))
      yield* Deferred.succeed(barrier, undefined)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true) // the fiber observed the conflict as a ConflictError defect
      // A caller-level retry re-reads and succeeds:
      const fresh = yield* EventV2.latestSequence(db, aggregateID)
      const retried = yield* events.publish(SessionEvent.Updated, updated(snapshot, aggregateID), {
        expectedSeq: fresh,
      })
      expect(retried.durable?.seq).toBe(fresh + 1)
      const rows = yield* db
        .select({ seq: EventTable.seq })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, aggregateID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.seq)).toEqual([0, 1, 2]) // no gaps, no duplicates
    }),
  )
})
```

Note: `Project` must be imported for `Project.ID.global` (`import { Project } from "@opencode-ai/core/project"`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test test/event-concurrency.test.ts`
Expected: FAIL — `Property 'expectedSeq' does not exist on type 'PublishOptions'` / `EventV2.ConflictError` is undefined.

- [ ] **Step 3: Implement the primitive**

In `packages/core/src/event.ts`:

(a) After `InvalidDurableEventError` (`event.ts:42-48`) add:

```ts
export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()("EventV2.Conflict", {
  aggregateID: Schema.String,
  expectedSeq: Schema.Number,
  actualSeq: Schema.Number,
}) {}
```

(b) Extend `PublishOptions` (`event.ts:118-124`):

```ts
export interface PublishOptions {
  readonly id?: ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  /** Optimistic guard: publish fails with ConflictError (defect) when the aggregate's current seq differs. */
  readonly expectedSeq?: number
  /** Local operational projection committed atomically with a new durable event. Not replayed or serialized. */
  readonly commit?: (seq: number) => Effect.Effect<void>
}
```

(c) Extend `commitDurableEvent`'s `input` type (`event.ts:208-213`) with `readonly expectedSeq?: number`.

(d) In `commitDurableEvent`, immediately after `const latest = row?.seq ?? -1` (`event.ts:249`) add:

```ts
if (input?.expectedSeq !== undefined && input.expectedSeq !== latest) {
  yield* Effect.die(
    new ConflictError({
      aggregateID,
      expectedSeq: input.expectedSeq,
      actualSeq: latest,
    }),
  )
}
```

(e) Thread the option through: change `publishEvent`'s signature (`event.ts:369`) to
`function publishEvent<D extends Definition>(definition: D, event: Payload<D>, commit?: PublishOptions["commit"], expectedSeq?: number)`, and inside the durable branch (`event.ts:379`) call
`commitDurableEvent(definition, event as Payload, expectedSeq === undefined ? undefined : { expectedSeq }, commit)`.

(f) In `publish` (`event.ts:419-438`) pass `options?.expectedSeq` as the fourth argument of `publishEvent`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test test/event-concurrency.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Regression + typecheck**

Run: `cd packages/core && bun test test/session-projector.test.ts test/session-create.test.ts && bun typecheck`
Expected: existing tests stay green; typecheck exit 0 (publish signature unchanged → no call-site ripple).

- [ ] **Step 6: Commit**

```powershell
git add packages/core/src/event.ts packages/core/test/event-concurrency.test.ts
git -c core.hooksPath=.git/hooks commit -m "feat(core): add expectedSeq conflict guard to EventV2 publish"
```

---

### Task 1: SessionV2 Canonical Mutation Surface

**Files:**
- Modify: `packages/core/src/session.ts` (Interface + `mutateSession` boundary + `update`/`permissions`/`setPermissions`; `import type { PermissionV2 }`)
- Modify: `packages/core/src/session/projector.ts:76-104` (`sessionRowFromSnapshot` SQL null semantics)
- Modify (type-only import conversions, 1 line each): `packages/core/src/session/store.ts:7`, `packages/core/src/session/command.ts:18`, `packages/core/src/session/info.ts:5`, `packages/core/src/session/sql.ts:7`
- Test: extend `packages/core/test/session-create.test.ts` and `packages/core/test/session-projector.test.ts`

**Interfaces:**
- Consumes: `EventV2.ConflictError` + `PublishOptions.expectedSeq` (Task 0); `EventV2.latestSequence(db, aggregateID)` (`event.ts:21-32`); `SessionStore.permissions(sessionID)` (`store.ts:46-54`, returns `[]` for a missing Session — do not expose raw).
- Produces:
  - `Interface.update` gains `metadata?: NonNullable<SessionSchema.Info["metadata"]> | null` and `share?: NonNullable<SessionSchema.Info["share"]> | null` (i.e. `Record<string, Json> | null` and `{ url: string } | null`). Semantics: `undefined` preserves, `null` clears, value fully replaces (never merges). `metadata {}` is a stored empty object, not a clear.
  - `Interface.permissions: (sessionID: SessionSchema.ID) => Effect.Effect<PermissionV2.Ruleset, NotFoundError>`
  - `Interface.setPermissions: (input: { sessionID: SessionSchema.ID; permissions: PermissionV2.Ruleset }) => Effect.Effect<void, NotFoundError>` — full replacement, never merge; preserves rule order and duplicates; `[]` is a valid explicit clear.
  - `mutateSession` (file-local): retries on `ConflictError` up to 32 times, each attempt re-reading row + seq; NotFoundError is typed and never retried.

- [ ] **Step 0: Read context**
  - Re-read `packages/core/src/session.ts` (`rowToSnapshot`, `publishCompatibilityUpdate`, `Service.of`), `packages/core/test/session-create.test.ts` (session fixture + typed-error assertion idiom), `packages/core/test/session-projector.test.ts` (projector replay idiom, `sessionsLayer` construction).

- [ ] **Step 1: Write the failing tests**

Extend `packages/core/test/session-create.test.ts` with (using the file's existing `sessionsLayer` / `it` fixture). Add the following module-scope fixture before the tests (imports to add if missing: `Layer` from `"effect"`, `EventV2` from `"@opencode-ai/core/event"`, `SessionExecution` from `"@opencode-ai/core/session/execution"`, `AppNodeBuilder`, `testEffect`):

```ts
// Deterministic conflict injection: a graph whose EventV2.Service.publish fails the
// first two expectedSeq-guarded calls with ConflictError defects, then delegates.
// Wrapping happens at graph construction (Layer.map) so SessionV2's captured `events`
// reference sees the wrapper — provideService after construction would not reach it.
const conflictInjection = { count: 0 }
const flakyEventsLayer = EventV2.layerWith().pipe(
  Layer.map((real) =>
    EventV2.Service.of({
      ...real,
      publish: ((definition, data, options) =>
        Effect.gen(function* () {
          if (conflictInjection.count < 2 && options?.expectedSeq !== undefined) {
            conflictInjection.count += 1
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
    }),
  ),
)
const retryIt = testEffect(
  AppNodeBuilder.build(SessionV2.node, [
    [EventV2.node, flakyEventsLayer],
    [SessionExecution.node, SessionExecution.noopLayer],
  ]),
)
```

Then the tests (the retry test uses `retryIt.effect`; the others use the file's regular `it.effect`):

```ts
it.effect("update atomically replaces and clears metadata and share with one V2 Updated event per call", () =>
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const { db } = yield* Database.Service
    const created = yield* sessions.create({ title: "mut", metadata: { a: 1, keep: true } })
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
    const created = yield* sessions.create({ title: "perm" })
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
    const created = yield* sessions.create({ title: "race" })
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
```

Extend `packages/core/test/session-projector.test.ts` with (reusing the file's `it` fixture, which provides Database + EventV2 + SessionProjector, and its `sessionID`/`created` constants):

```ts
it.effect("replays Updated snapshots with cleared metadata/share as SQL NULL", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    const id = SessionV2.ID.make("ses_replay_clear")
    const base = {
      id,
      projectID: Project.ID.global,
      slug: "test",
      version: "test",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created, updated: DateTime.makeUnsafe(1) },
      title: "test",
      location: { directory: AbsolutePath.make("/project") },
    }
    const createdInfo = SessionEvent.SessionSnapshot.make({
      ...base,
      metadata: { keep: "x" },
      share: { url: "https://s.example/1" },
    })
    const updatedInfo = SessionEvent.SessionSnapshot.make({
      ...base,
      metadata: undefined,
      share: undefined,
      time: { ...base.time, updated: DateTime.makeUnsafe(2) },
    })
    yield* events.replay({
      id: EventV2.ID.make("evt_replay_created"),
      type: "session.next.created.1",
      seq: 0,
      aggregateID: id,
      data: Schema.encodeUnknownSync(SessionEvent.Created.data)({
        timestamp: 0,
        sessionID: id,
        info: createdInfo,
      }),
    })
    yield* events.replay({
      id: EventV2.ID.make("evt_replay_updated"),
      type: "session.next.updated.1",
      seq: 1,
      aggregateID: id,
      data: Schema.encodeUnknownSync(SessionEvent.Updated.data)({
        timestamp: 1,
        sessionID: id,
        info: updatedInfo,
      }),
    })
    const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, id)).get()
    expect(row?.metadata).toBeNull()
    expect(row?.share_url).toBeNull()
  }),
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test test/session-create.test.ts test/session-projector.test.ts`
Expected: new cases FAIL — `metadata`/`share` not accepted by `update`, `permissions`/`setPermissions` missing from `Interface`, cleared metadata still stored as `{}`/undefined rather than NULL, retry test dies without converging.

- [ ] **Step 3: Implement `mutateSession` + new members in `packages/core/src/session.ts`**

(a) Add import (type-only, prevents the `PermissionV2 -> SessionStore/SessionCommand -> PermissionV2` runtime cycle):

```ts
import type { PermissionV2 } from "./permission"
```

(b) Extend the `update` member of `Interface` (`session.ts:190-194`):

```ts
  readonly update: (input: {
    sessionID: SessionSchema.ID
    title?: string
    archived?: DateTime.Utc | null
    metadata?: NonNullable<SessionSchema.Info["metadata"]> | null
    share?: NonNullable<SessionSchema.Info["share"]> | null
  }) => Effect.Effect<SessionSchema.Info, NotFoundError>
```

(c) Add to `Interface` (after `update`):

```ts
  readonly permissions: (sessionID: SessionSchema.ID) => Effect.Effect<PermissionV2.Ruleset, NotFoundError>
  readonly setPermissions: (input: {
    sessionID: SessionSchema.ID
    permissions: PermissionV2.Ruleset
  }) => Effect.Effect<void, NotFoundError>
```

(d) Add the file-local mutation boundary after `publishCompatibilityUpdate` (`session.ts:442`), before `Service.of`:

```ts
    const mutateSession = Effect.fn("V2Session.mutateSession")(function* (
      sessionID: SessionSchema.ID,
      next: (snapshot: SessionEvent.SessionSnapshot, timestamp: DateTime.Utc) => SessionEvent.SessionSnapshot,
    ) {
      const attempt = Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ sessionID })
        const expectedSeq = yield* EventV2.latestSequence(db, sessionID)
        const timestamp = yield* DateTime.now
        const info = next(rowToSnapshot(row), timestamp)
        yield* events.publish(
          SessionEvent.Updated,
          { timestamp, sessionID, info },
          { location: fromRow(row).location, expectedSeq },
        )
        const fresh = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        return fromRow(fresh!)
      })
      const retry = (remaining: number): Effect.Effect<SessionSchema.Info, NotFoundError> =>
        attempt.pipe(
          Effect.catchDefect((defect) =>
            defect instanceof EventV2.ConflictError && remaining > 0 ? retry(remaining - 1) : Effect.die(defect),
          ),
        )
      return yield* retry(32)
    })
```

(e) Replace the `update` implementation (`session.ts:496-527`) with:

```ts
      update: Effect.fn("V2Session.update")(function* (input) {
        return yield* mutateSession(input.sessionID, (snapshot, timestamp) =>
          SessionEvent.SessionSnapshot.make({
            ...snapshot,
            title: input.title ?? snapshot.title,
            metadata:
              input.metadata === undefined ? snapshot.metadata : input.metadata === null ? undefined : input.metadata,
            share: input.share === undefined ? snapshot.share : input.share === null ? undefined : input.share,
            time: {
              ...snapshot.time,
              updated: timestamp,
              archived:
                input.archived === undefined
                  ? snapshot.time.archived
                  : input.archived === null
                    ? undefined
                    : input.archived,
            },
          }),
        )
      }),
      permissions: Effect.fn("V2Session.permissions")(function* (sessionID) {
        const stored = yield* store.get(sessionID)
        if (!stored) return yield* new NotFoundError({ sessionID })
        return yield* store.permissions(sessionID)
      }),
      setPermissions: Effect.fn("V2Session.setPermissions")(function* (input) {
        yield* mutateSession(input.sessionID, (snapshot, timestamp) =>
          SessionEvent.SessionSnapshot.make({
            ...snapshot,
            permission: [...input.permissions],
            time: { ...snapshot.time, updated: timestamp },
          }),
        )
      }),
```

- [ ] **Step 4: Fix the projector SQL null semantics in `packages/core/src/session/projector.ts:76-104`**

In `sessionRowFromSnapshot` change:

```ts
    share_url: snapshot.share?.url ?? null,
    metadata: snapshot.metadata ?? null,
```

(Leave `permission: snapshot.permission ? [...snapshot.permission] : undefined` unchanged — Drizzle ignores `undefined` so permission is preserved when the snapshot carries none. Note `[]` is truthy, so an explicit empty-rules clear is written.)

- [ ] **Step 5: Convert the four type-only PermissionV2 imports**

In each of `packages/core/src/session/store.ts:7`, `packages/core/src/session/command.ts:18`, `packages/core/src/session/info.ts:5`, `packages/core/src/session/sql.ts:7` change `import { PermissionV2 } from "../permission"` to `import type { PermissionV2 } from "../permission"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && bun test test/event-concurrency.test.ts test/session-create.test.ts test/session-projector.test.ts`
Expected: all green (new cases included).

- [ ] **Step 7: Typecheck + mock safety**

Run: `cd packages/core && bun typecheck`
Expected: exit 0. (Mock impact audit verified: `Layer.mock` partial semantics protect all 9 `SessionV2.Service` test sites — no test file changes required. Optionally add explicit `permissions: () => Effect.die("not implemented")` / `setPermissions` stubs to the `unusedSessionMembers` helper in `packages/opencode/test/server/httpapi-workspace-routing.test.ts:281` for runtime protection.)

- [ ] **Step 8: Commit**

```powershell
git add packages/core/src/session.ts packages/core/src/session/projector.ts packages/core/src/session/store.ts packages/core/src/session/command.ts packages/core/src/session/info.ts packages/core/src/session/sql.ts packages/core/test/session-create.test.ts packages/core/test/session-projector.test.ts
git -c core.hooksPath=.git/hooks commit -m "feat(core): extend SessionV2 canonical mutations"
```

---

### Task 2: Permission and CodeMode Consumer Parity

**Files:**
- Modify: `packages/core/src/permission.ts:150-160` (`configured` merge order)
- Modify: `packages/core/src/tool/code-mode.ts` (execution-time catalog filter; add `SessionStore` service + `SessionStore.node` dep)
- Test: extend `packages/core/test/permission.test.ts` and `packages/core/test/tool-code-mode.test.ts`

**Interfaces:**
- Consumes: `SessionStore.permissions(sessionID)` and `SessionStore.latestPrompt(sessionID)` (`store.ts:19-29`); `PermissionV2.fromToolOverrides` (`permission.ts:94-102`); `PermissionV2.evaluate` last-match-wins (`permission.ts:78-88`).
- Produces: `PermissionV2.configured(sessionID, agentID?)` returns rules in canonical order `agent.permissions → SessionStore.permissions(sessionID) → fromToolOverrides(latestPrompt?.tools)`. Preserves: Session existence check (`SessionCommand.NotFoundError`), missing-agent deny (`missingAgentPermissions`). CodeMode's execution-time `entries()` call is filtered by the same merge.

- [ ] **Step 0: Read context**
  - Read the existing `packages/core/test/permission.test.ts` (fixture layers for `PermissionV2.Service`, stubbed agents/saved/plugins) and `packages/core/test/tool-code-mode.test.ts` (isolated tool test setup, MCP fake, execution idiom).

- [ ] **Step 1: Write the failing tests**

Extend `packages/core/test/permission.test.ts` (using its existing fixtures; if the file does not already stub `SessionStore.Service`, add one with the same `Layer.succeed` pattern as `tool-code-mode.test.ts` — mutable `sessionPermissions` and `latestPrompt`):

```ts
it.effect("applies agent, then Session, then latest promoted prompt rules in order", () =>
  Effect.gen(function* () {
    const permission = yield* PermissionV2.Service
    // Fixture state: agent rules allow "bash" and "edit"; SessionStore stub
    // permissions returns [{ action: "bash", resource: "*", effect: "deny" }];
    // latestPrompt returns { tools: { read: true } }.
    // Session rules override the agent allow (last-match-wins) -> BlockedError:
    const denied = yield* permission
      .assert({ action: "bash", resources: ["*"], save: [], metadata: {}, sessionID, source: fixtureSource() })
      .pipe(Effect.exit)
    expect(Exit.isFailure(denied)).toBe(true)
    // Prompt override (read: true) allows "read" even though neither ruleset mentions it:
    yield* permission.assert({ action: "read", resources: ["*"], save: [], metadata: {}, sessionID, source: fixtureSource() })
    // Agent-only rule still applies:
    yield* permission.assert({ action: "edit", resources: ["*"], save: [], metadata: {}, sessionID, source: fixtureSource() })
  }),
)
```

(`fixtureSource()` reuses the file's existing `source` fixture shape — mirror the `assert` calls already present in `permission.test.ts`. Reset the stub's `sessionPermissions`/`latestPrompt` before each test.)

Extend `packages/core/test/tool-code-mode.test.ts` (reusing its existing MCP/agent stubs — `mcpTools`, `handlers`, `currentAgent`, `assertions`):

Add a module-scope `SessionStore` stub with mutable state (per handoff: only `permissions` and `latestPrompt` return values; unused methods die):

```ts
let sessionPermissions: PermissionV2.Ruleset = []
let latestPrompt: { readonly tools: Record<string, boolean> } | undefined = undefined

const sessions = Layer.succeed(
  SessionStore.Service,
  SessionStore.Service.of({
    get: () => Effect.die("unused"),
    permissions: () => Effect.sync(() => [...sessionPermissions]),
    context: () => Effect.die("unused"),
    runnerContext: () => Effect.die("unused"),
    latestPrompt: () => Effect.succeed(latestPrompt),
    message: () => Effect.die("unused"),
  }),
)
```

Add `sessions` to the graph's layer list in `AppNodeBuilder.build(...)` (the file's `layer` at `:180`), with imports `import { SessionStore } from "@opencode-ai/core/session/store"`.

New test (uses the file's existing tool-execution idiom — see its `settleTool`/execute tests; `handlers` map records invocations):

```ts
it.effect("execution catalog is filtered by agent, then Session, then prompt rules", () =>
  Effect.gen(function* () {
    sessionPermissions = [{ action: "demo_server_echo", resource: "*", effect: "deny" }]
    latestPrompt = { tools: { demo_server_structured: false } }
    currentAgent = AgentV2.Info.make({ ...currentAgent, permissions: [{ action: "demo_server_*", resource: "*", effect: "allow" }] })
    handlers.clear()
    handlers.set("echo", async (input) => ({ content: [{ type: "text", text: `echo:${input.text}` }] }))
    handlers.set("fail", async () => ({ content: [{ type: "text", text: "fail-ran" }] }))
    // Session rule denies echo -> script call fails, handler never invoked:
    const echoExit = yield* /* existing execute idiom for `demo_server.echo({ text: "hi" })` */.pipe(Effect.exit)
    expect(Exit.isFailure(echoExit)).toBe(true)
    expect(handlers.has("echo")).toBe(true) // registered but never called (track via invocation counter)
    // Prompt override denies structured -> same behavior:
    // Agent-only allowance (fail) still succeeds and its handler is invoked.
  }),
)
```

The implementer must adapt the `/* execute idiom */` lines to the file's existing execute helper (same pattern as its existing success/failure tests) and assert handler non-invocation with a counter (e.g. wrap `handlers.set` values or add `const calls = new Map<string, number>()`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test test/permission.test.ts test/tool-code-mode.test.ts`
Expected: new cases FAIL — Session rules not consulted; prompt overrides don't win; CodeMode still filters by agent permissions only.

- [ ] **Step 3: Fix `configured` in `packages/core/src/permission.ts:150-160`**

```ts
    const configured = EffectRuntime.fn("PermissionV2.configured")(function* (
      sessionID: SessionSchema.ID,
      agentID?: AgentV2.ID,
    ) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionCommand.NotFoundError({ sessionID })
      const agent = yield* agents.resolve(agentID ?? session.agent)
      if (!agent) return missingAgentPermissions
      const prompt = yield* sessions.latestPrompt(sessionID)
      return [
        ...agent.permissions,
        ...(yield* sessions.permissions(sessionID)),
        ...fromToolOverrides(prompt?.tools),
      ]
    })
```

- [ ] **Step 4: Fix execution-time filtering in `packages/core/src/tool/code-mode.ts`**

(a) Add service acquisition in the layer (after `const location = yield* Location.Service`, `code-mode.ts:236`):

```ts
    const sessions = yield* SessionStore.Service
```

with import `import { SessionStore } from "../session/store"` (this import already exists in `permission.ts:11`; verify `code-mode.ts` has no existing `SessionStore` import).

(b) Replace the execution-time catalog computation (`code-mode.ts:316-318`):

```ts
              const selected = yield* agents.resolve(context.agent)
              if (!selected) return yield* new Tool.Failure({ message: `Unknown agent: ${context.agent}` })
              const catalog = entries(yield* mcp.tools(), selected.permissions)
```

with:

```ts
              const selected = yield* agents.resolve(context.agent)
              if (!selected) return yield* new Tool.Failure({ message: `Unknown agent: ${context.agent}` })
              const rules = [
                ...selected.permissions,
                ...(yield* sessions.permissions(context.sessionID)),
                ...PermissionV2.fromToolOverrides((yield* sessions.latestPrompt(context.sessionID))?.tools),
              ]
              const catalog = entries(yield* mcp.tools(), rules)
```

Keep every child `permission.assert()` call (`invokeChildTool`, `execute`) unchanged as the second execution-time check. Do not make the synchronous `describe` callback (`describeCatalog`, `code-mode.ts:280`) effectful — advertisement already receives the runner's effective permissions.

(c) Add the Location-to-Global dependency in `code-mode.ts:434-446`: append `SessionStore.node` to the `deps` array of `makeLocationNode`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test test/permission.test.ts test/tool-code-mode.test.ts`
Expected: all green (new cases included).

- [ ] **Step 6: Full core regression + typecheck**

Run: `cd packages/core && bun test test/event-concurrency.test.ts test/session-create.test.ts test/session-projector.test.ts test/permission.test.ts test/tool-code-mode.test.ts && bun typecheck`
Expected: green, exit 0. (Watch `task-grant-v2.test.ts` — it exercises `SessionStore.permissions` at `:59/:70/:100/:101/:114/:115` and must stay green since Task 1 kept store semantics unchanged.)

- [ ] **Step 7: Commit**

```powershell
git add packages/core/src/permission.ts packages/core/src/tool/code-mode.ts packages/core/test/permission.test.ts packages/core/test/tool-code-mode.test.ts
git -c core.hooksPath=.git/hooks commit -m "feat(core): apply session permission rules in PermissionV2 and CodeMode"
```

---

## Post-Task Verification (all tasks complete)

- [ ] `cd packages/core && bun test test/event-concurrency.test.ts test/session-create.test.ts test/session-projector.test.ts test/permission.test.ts test/tool-code-mode.test.ts && bun typecheck`
- [ ] `cd packages/server && bun typecheck`
- [ ] `cd packages/sdk-next && bun typecheck`
- [ ] `cd packages/opencode && bun typecheck`
- [ ] `git diff --check`
- [ ] Explicit staged-file audit (no untracked files staged; the two protected untracked files remain untouched)
- [ ] Update `V1-to-V2-migration.md` (批次 8: Session mutation surface now canonical; record remaining consumers) and commit it separately: `docs: record V2 session canonical mutations`
- [ ] Update the plan ledger `.superpowers/sdd/2026-08-13-v2-session-canonical-mutations/progress.md` with task completions and review verdicts
- [ ] Do not push unless the user explicitly asks
