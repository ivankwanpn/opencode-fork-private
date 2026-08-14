# Session HttpApi CRUD → SessionV2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the experimental session HttpApi handlers (list/get/children/create/remove/update/fork + the shared `requireSession` precondition) from the V1 `Session.Service` to `SessionV2.Service`, keeping the V1 wire shape through a pure V2→V1 projection and leaving stats/share-sync/experimental-list/CLI/TUI/sync/legacy-execution/GitHub/task/code-mode/Config/Provider/Agent/Permission for later batches.

**Architecture:** All in-scope endpoints read and write through `SessionV2.Service` only. Responses keep the opencode V1 `Session.Info` wire schema, produced by a new pure projection `legacySessionFromV2` that lives next to `legacySessionFromNative` in the compat layer (the SDK-boundary projector stays untouched for acp/run consumers). `SessionV2.list` gains the three query capabilities the wire contract needs (`orderBy: "updated"`, `start`, `subpath` prefix filtering with the pathless-directory fallback). Create moves to `SessionV2.create` with the auto-share gate inlined in the handler; `SessionShare.create` (the V1 wrapper) is removed.

**Tech Stack:** Bun 1.3.14 test runner (bare test names act as filters — always pass `./path`), Effect 4.0.0-beta.83 (`Effect.fn`, `Effect.gen`, Schema), Drizzle+SQLite via `@opencode-ai/core/database`, effect `HttpApi` experimental surface.

**Spec:** `docs/superpowers/specs/2026-08-13-v2-session-consumer-hard-cut-design.md` (binding: only `SessionV2.Service`; compatibility at external boundaries is a pure projection from V2 values, never a second storage-backed repository) and the migration inventory `V1-to-V2-migration.md` (批次 8 下一步). User scope ruling (2026-08-14): only list/get/children/create/remove/update(title, metadata, archive, permission)/fork + requireSession; middleware is already V2 — do not redo it.

## Global Constraints

- No star imports; no aliased imports outside opencode's existing `@/` convention; avoid `any`/`as never`; avoid `else` (early return or switch).
- Tests run from package directories, never repository root. Bun bare test names act as filters — pass `./path` arguments.
- Stage explicit paths only (never `git add .`); commit with `git -c core.hooksPath=.git/hooks commit -m "type(scope): summary"`.
- Never modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` or anything under `docs/superpowers/handoffs/`. Never edit generated SDK files (`packages/sdk/js/src/v2/gen/*`).
- Do not push.

## Plan Rulings (binding on all tasks)

1. **Response projection field set** — the new `legacySessionFromV2` carries every `SessionV2.Info` field (including `metadata`), synthesizes `slug: info.id` and `version: "2"` exactly like `legacySessionFromNative`, and intentionally omits `summary` (V1-only row columns with no V2 equivalent — the production `packages/server` V2 surface also omits it) and `permission` (separate from public Info by design; same as the server surface). The one contract test pinning `summary` is updated in Task 3.
2. **Fork cutoff semantics preserved verbatim** — the V1 lexicographic filter `String(message.id) < String(payload.messageID)` is kept (no 404 on unknown boundary; the production server's `findIndex`+404 semantics are a different contract and out of scope).
3. **Remove returns 404 on missing session** — V1 `remove` also 404s via its initial `get`; the endpoint's declared error is `ApiNotFoundError`. `SessionV2.remove` maps through `mapSessionNotFound`.
4. **Auto-share gate inlined in the create handler** — `SessionShare.create` (V1 wrapper) is removed; the gate (`flags.autoShare || conf.share === "auto"`, skip when `parentID` set) and the fire-and-forget `shareNext.create` + `SessionV2.update({share})` move into the handler. `SessionShare.share/unshare` stay untouched (share endpoints are a later batch).
5. **Background-job cancellation preserved** — `cancelBackgroundJobs` in `packages/opencode/src/session/session.ts` gains an `export` keyword; the remove handler calls it before `SessionV2.remove`, guarded by the same `InstanceState.context` catch.
6. **Permission merge** — `Permission.merge` is flat concatenation and `toV2Rules(toV1Rules(x)) === x`, so the update handler concatenates `[...currentV2, ...toV2Rules(payload.permission)]` directly (identical semantics, one shape conversion instead of two).
7. **TDD RED mechanism for migration-parity tasks** — behavioral parity tasks pin new EventTable assertions (V2 `session.next.*` events present, V1 `session.*` absent) that fail on the pre-migration code; pure relocations (fork) get pin-tests that pass before and after.

---

### Task 1: Extend SessionV2.list with the wire-contract query semantics

**Files:**
- Modify: `packages/core/src/session.ts:63-86` (ListInputBase, ListProjectInput), `packages/core/src/session.ts:542-580` (list impl)
- Test: `packages/core/test/session-list-query.test.ts` (new)

**Interfaces:**
- Consumes: existing `SessionTable`, `fromRow`, `ListAnchor` in the same file.
- Produces: `ListInputBase.orderBy?: "created" | "updated"` (default `"created"` — existing consumers unchanged), `ListInputBase.start?: number` (`time_updated >= start`), `ListProjectInput.directory?: AbsolutePath`, and `subpath` filtering (exact-or-prefix, plus pathless-directory fallback) in the project variant. The handler in Task 4 passes `{project, orderBy: "updated", ...}`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/session-list-query.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { eq, sql } from "drizzle-orm"
import { Effect, Layer } from "effect"
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
})
```

If `SessionTable.path` rejects a plain string in `db.update(...).set(...)` (DatabasePath column type), wrap the value with whatever `make`/brand the column type exposes (check `packages/core/src/session/sql.ts`) and keep the same string values. The expected lists stay as written.

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/core`): `bun test ./test/session-list-query.test.ts`
Expected: FAIL — `orderBy`/`start` do not exist on `ListInput` (typecheck-level RED via tsgo), and/or the behavior assertions fail because `subpath` is currently ignored and ordering is by `time_created`.

- [ ] **Step 3: Extend the list input schemas**

In `packages/core/src/session.ts` change `ListInputBase` (lines 63-70) to:

```ts
const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  orderBy: Schema.Literals(["created", "updated"]).pipe(Schema.optional),
  start: Schema.Finite.pipe(Schema.optional),
  parentID: Schema.NullOr(SessionSchema.ID).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}
```

and change `ListProjectInput` (lines 77-81) to:

```ts
const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
  directory: AbsolutePath.pipe(Schema.optional),
})
```

- [ ] **Step 4: Extend the list implementation**

In `packages/core/src/session.ts` replace the condition-building portion of the `list` implementation (lines 543-567) with:

```ts
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = input.orderBy === "updated" ? SessionTable.time_updated : SessionTable.time_created
        const conditions: SQL[] = []
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input && input.subpath !== undefined) {
          // V1 parity: an empty path disables both the path and directory filters.
          if (input.subpath !== "") {
            const pathConditions = [eq(SessionTable.path, input.subpath), like(SessionTable.path, `${input.subpath}/%`)]
            conditions.push(
              input.directory !== undefined
                ? or(
                    ...pathConditions,
                    // Pathless rows are "" in the V2 world (prepareLocation writes the
                    // empty subpath for workspace-less locations) and NULL in legacy V1
                    // rows — the fallback must match both.
                    and(or(isNull(SessionTable.path), eq(SessionTable.path, "")), eq(SessionTable.directory, input.directory))!,
                  )!
                : or(...pathConditions)!,
            )
          }
        } else if ("directory" in input && input.directory !== undefined) {
          conditions.push(eq(SessionTable.directory, input.directory))
        }
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.parentID === null) conditions.push(isNull(SessionTable.parent_id))
        if (input.parentID !== undefined && input.parentID !== null)
          conditions.push(eq(SessionTable.parent_id, input.parentID))
        if (input.start !== undefined) conditions.push(gte(SessionTable.time_updated, input.start))
```

Keep the anchor block (lines 555-567 of the original) unchanged immediately after, and keep the tail (query build, orderBy, limit, `toReversed`, `fromRow` map) unchanged — the `sortColumn` variable now feeds both the anchor conditions and the orderBy, which is exactly what makes `orderBy: "updated"` consistent with anchors.

Imports: `gte` must be added to the drizzle-orm import at the top of `session.ts` (it currently imports `and`, `asc`, `desc`, `eq`, `isNull`, `like`, `or`, `lt`, `gt` — check the existing import line and add `gte`).

- [ ] **Step 5: Run the new tests to verify they pass**

Run (from `packages/core`): `bun test ./test/session-list-query.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 6: Run the existing core suite**

Run (from `packages/core`): `bun test` then `bun typecheck`
Expected: all green — existing list consumers (default `orderBy` = `"created"`) unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/session.ts packages/core/test/session-list-query.test.ts
git -c core.hooksPath=.git/hooks commit -m "feat(core): add updated-ordering, start, and subpath filters to SessionV2.list"
```

---

### Task 2: Add the pure V2→V1 httpapi projection

**Files:**
- Modify: `packages/opencode/src/compat/native-v1-session.ts` (append `legacySessionFromV2`)
- Test: `packages/opencode/test/compat/native-v1-session.test.ts` (new)

**Interfaces:**
- Consumes: `SessionSchema.Info` from `@opencode-ai/core/session/schema`, opencode brands from `@/session/schema`.
- Produces: `legacySessionFromV2(info: SessionSchema.Info): Session.Info` (opencode V1 `Session.Info` from `@/session/session`), pure — no storage, no effects. Used by Tasks 3-7.

- [ ] **Step 1: Write the failing test**

Create `packages/opencode/test/compat/native-v1-session.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { legacySessionFromV2 } from "../../src/compat/native-v1-session"

describe("legacySessionFromV2", () => {
  test("projects a canonical V2 info into the V1 wire shape", () => {
    const created = DateTime.unsafeMake(1000)
    const updated = DateTime.unsafeMake(2000)
    const info = SessionSchema.Info.make({
      id: "sess_v2id",
      projectID: "prj_1",
      title: "hello",
      metadata: { source: "sdk", trace: { id: "abc" } },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created, updated },
      location: { directory: "D:/work/app", workspaceID: "wsp_1" },
      subpath: "packages/opencode",
      agent: "build",
      model: { id: "claude-sonnet-5", providerID: "anthropic", variant: "default" },
      share: { url: "https://share.example/s" },
      revert: { messageID: "msg_1", partID: "prt_1", snapshot: "snap", diff: "diff" },
    })

    const projected = legacySessionFromV2(info)

    expect(projected.id).toBe("sess_v2id")
    expect(projected.slug).toBe("sess_v2id")
    expect(projected.version).toBe("2")
    expect(projected.projectID).toBe("prj_1")
    expect(projected.directory).toBe("D:/work/app")
    expect(projected.workspaceID).toBe("wsp_1")
    expect(projected.path).toBe("packages/opencode")
    expect(projected.title).toBe("hello")
    expect(projected.metadata).toEqual({ source: "sdk", trace: { id: "abc" } })
    expect(projected.agent).toBe("build")
    expect(projected.model).toEqual({ id: "claude-sonnet-5", providerID: "anthropic", variant: "default" })
    expect(projected.share).toEqual({ url: "https://share.example/s" })
    expect(projected.time).toEqual({ created: 1000, updated: 2000 })
    expect(projected.revert).toEqual({ messageID: "msg_1", partID: "prt_1", snapshot: "snap", diff: "diff" })
    expect(Object.hasOwn(projected, "summary")).toBe(false)
    expect(Object.hasOwn(projected, "permission")).toBe(false)
  })

  test("projects undefined optional fields and dates as undefined", () => {
    const info = SessionSchema.Info.make({
      id: "sess_v2id",
      projectID: "prj_1",
      title: "hello",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.unsafeMake(1000), updated: DateTime.unsafeMake(1000) },
      location: { directory: "D:/work" },
    })

    const projected = legacySessionFromV2(info)

    expect(projected.parentID).toBeUndefined()
    expect(projected.path).toBeUndefined()
    expect(projected.workspaceID).toBeUndefined()
    expect(projected.agent).toBeUndefined()
    expect(projected.model).toBeUndefined()
    expect(projected.share).toBeUndefined()
    expect(projected.revert).toBeUndefined()
    expect(projected.metadata).toBeUndefined()
    expect(projected.time.compacting).toBeUndefined()
    expect(projected.time.archived).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/opencode`): `bun test ./test/compat/native-v1-session.test.ts`
Expected: FAIL — `legacySessionFromV2` is not exported (module resolution error).

- [ ] **Step 3: Implement the projection**

In `packages/opencode/src/compat/native-v1-session.ts` add imports:

```ts
import { DateTime } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import type { Session as LegacySession } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
```

and append (keep `legacySessionFromNative` and the `NativeV1Session` re-export untouched):

```ts
// Pure V2→V1 wire projection for the experimental httpapi session surface.
// The canonical SessionV2.Info has no slug/version (synthesized here like
// legacySessionFromNative), and no summary/permission (V1-only row data kept
// separate from the public V2 Info — matching the production server surface).
// This performs no storage reads: everything comes from the V2 values.
export function legacySessionFromV2(info: SessionSchema.Info): LegacySession.Info {
  const millis = (value: DateTime.Utc | undefined) => (value === undefined ? undefined : DateTime.toEpochMillis(value))
  return LegacySession.Info.make({
    id: SessionID.make(info.id),
    slug: info.id,
    projectID: info.projectID,
    workspaceID: info.location.workspaceID,
    directory: info.location.directory,
    path: info.subpath,
    parentID: info.parentID === undefined ? undefined : SessionID.make(info.parentID),
    title: info.title,
    agent: info.agent,
    model:
      info.model === undefined
        ? undefined
        : {
            id: ModelV2.ID.make(info.model.id),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: info.model.variant,
            protocol: info.model.protocol,
          },
    version: "2",
    cost: info.cost,
    tokens: {
      input: info.tokens.input,
      output: info.tokens.output,
      reasoning: info.tokens.reasoning,
      cache: { read: info.tokens.cache.read, write: info.tokens.cache.write },
    },
    share: info.share,
    metadata: info.metadata,
    time: {
      created: DateTime.toEpochMillis(info.time.created),
      updated: DateTime.toEpochMillis(info.time.updated),
      compacting: millis(info.time.compacting),
      archived: millis(info.time.archived),
    },
    revert:
      info.revert === undefined
        ? undefined
        : {
            messageID: MessageID.make(info.revert.messageID),
            partID: info.revert.partID === undefined ? undefined : PartID.make(info.revert.partID),
            snapshot: info.revert.snapshot,
            diff: info.revert.diff,
          },
  })
}
```

If the typecheck flags any field mismatch between `SessionSchema.Info`/`Revert.State` and the opencode `Session.Info` schema (e.g. `variant` typing), adjust the mapping to what `tsgo` requires and update the test expectations to match — the authoritative shapes are `packages/schema/src/session.ts` (V2 Info) and `packages/opencode/src/session/session.ts:215-236` (V1 Info).

- [ ] **Step 4: Run the test to verify it passes**

Run (from `packages/opencode`): `bun test ./test/compat/native-v1-session.test.ts`
Expected: 2/2 PASS.

- [ ] **Step 5: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean (`tsgo --noEmit`).

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/compat/native-v1-session.ts packages/opencode/test/compat/native-v1-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "feat(opencode): project canonical session info into the V1 wire shape"
```

---

### Task 3: Switch requireSession/get/children to SessionV2

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (requireSession, get, children; imports)
- Test: `packages/opencode/test/server/httpapi-session.test.ts` (update the summary test, add the projection test)

**Interfaces:**
- Consumes: `legacySessionFromV2` (Task 2), `SessionError.mapSessionNotFound` (existing).
- Produces: `requireSession(sessionID)` returns the projected V1 `Session.Info` — the out-of-scope execution endpoints (init/prompt/promptAsync/command/shell) keep consuming it unchanged, since their `LegacySessionExecution` inputs are typed `Session.Info` (`packages/opencode/src/session/legacy-session-execution.ts:31-62`).

- [ ] **Step 1: Update the summary contract test (RED)**

In `packages/opencode/test/server/httpapi-session.test.ts` replace the test at lines 1945-1961:

```ts
  it.instance(
    "serves sessions with migrated summary diffs missing file details",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "legacy diff" })
        yield* setLegacySummaryDiff(session.id)

        const response = yield* request(pathFor(SessionPaths.get, { sessionID: session.id }), {
          headers: { "x-opencode-directory": test.directory },
        })

        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).summary?.diffs).toEqual([{ additions: 1, deletions: 0 }])
      }),
  )
```

with:

```ts
  it.instance(
    "serves sessions without the V1-only summary field",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "legacy diff" })
        yield* setLegacySummaryDiff(session.id)

        const response = yield* request(pathFor(SessionPaths.get, { sessionID: session.id }), {
          headers: { "x-opencode-directory": test.directory },
        })

        expect(response.status).toBe(200)
        // Ruling 1: summary is V1-only row data; the V2 projection omits it,
        // matching the production server surface.
        expect((yield* json<Session.Info>(response)).summary).toBeUndefined()
      }),
  )
```

- [ ] **Step 2: Add the projection contract test (RED)**

Append to `packages/opencode/test/server/httpapi-session.test.ts` (same file, same harness):

```ts
  it.instance(
    "get serves the V2 projection of the session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "projected", metadata: { source: "sdk" } }),
        })
        expect(created.id).toBeTruthy()

        const fetched = yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: created.id }), {
          headers,
        })

        expect(fetched).toMatchObject({ id: created.id, title: "projected", metadata: { source: "sdk" } })
        expect(fetched.version).toBe("2")
        expect(fetched.slug).toBe(created.id)
        expect(Object.hasOwn(fetched, "permission")).toBe(false)
        expect(Object.hasOwn(fetched, "summary")).toBe(false)
      }),
  )
```

- [ ] **Step 3: Run both tests to verify they fail**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "summary"` then `bun test ./test/server/httpapi-session.test.ts -t "projection"`
Expected: the summary test FAILS (V1 path still serves `summary`); the projection test FAILS (`version` is the installation version, not `"2"`; `slug` differs from the id).

- [ ] **Step 4: Switch requireSession and the read endpoints**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`:

Add imports:

```ts
import { legacySessionFromV2 } from "@/compat/native-v1-session"
```

Add the canonical service handle directly after the `const revertSvc = yield* SessionV2.Service` line (line 141) — the migrated handlers use it; the existing `revertSvc` stays untouched for the transcript handlers:

```ts
    const canonical = yield* SessionV2.Service
```

Replace `requireSession` (lines 180-182) with:

```ts
    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      const info = yield* canonical.get(SessionV2.ID.make(sessionID)).pipe(SessionError.mapSessionNotFound)
      return legacySessionFromV2(info)
    })
```

Replace `children` (lines 188-191) with:

```ts
    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const kids = yield* canonical.children(SessionV2.ID.make(ctx.params.sessionID)).pipe(SessionError.mapSessionNotFound)
      return kids.map(legacySessionFromV2)
    })
```

`get` (lines 184-186) stays as-is — it already delegates to `requireSession`.

- [ ] **Step 5: Run the two tests to verify they pass**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "summary"` and `bun test ./test/server/httpapi-session.test.ts -t "projection"`
Expected: both PASS.

- [ ] **Step 6: Run the read-path contract suites**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts` and `bun test ./test/server/session-actions.test.ts`
Expected: all green — the "serves read routes" test (roots/children), metadata tests, and lifecycle tests all still pass (create/update/fork/remove are not migrated yet, so their V1 paths still produce the current behavior; the projection test above is the only new shape).

- [ ] **Step 7: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean. (`sessionExecution` consumers still receive `Session.Info` — the projected type — so init/prompt/command/shell compile unchanged.)

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "refactor(opencode): read session httpapi endpoints through SessionV2"
```

---

### Task 4: Migrate the list endpoint

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (list handler; imports)

**Interfaces:**
- Consumes: `SessionV2.list` with the Task 1 extensions (`orderBy: "updated"`, `start`, `subpath`, optional `directory` on the project variant).
- Produces: unchanged `/session` list wire behavior — the existing contract tests are the oracle.

- [ ] **Step 1: Establish the green baseline**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "list"` and `bun test ./test/server/httpapi-session.test.ts -t "scope"`
Expected: all green on HEAD (V1 list) — these must stay green after the switch. If bun's `-t` filter matches nothing (bare-name filter caveat), run the whole file once and note the green baseline.

- [ ] **Step 2: Replace the list handler**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` add to the core imports:

```ts
import { RelativePath } from "@opencode-ai/core/schema"
```

Replace `list` (lines 163-174) with:

```ts
    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const query = ctx.query
      const ctxState = yield* InstanceState.context
      const directory = query.directory ? yield* InstanceState.directory : undefined
      const scoped = query.scope === "project"
      const hasSubpath = query.path !== undefined && query.path !== ""
      // V1 parity: scope=project suppresses the directory filter; path="" disables
      // both filters; a truthy path selects exact-or-prefix (plus the core impl's
      // pathless-directory fallback when directory is also given).
      const includeDirectory = (query.path === undefined || hasSubpath) && !scoped && directory !== undefined
      const input: Extract<SessionV2.ListInput, { project: unknown }> = {
        project: ctxState.project.id,
        orderBy: "updated",
        ...(!hasSubpath ? {} : { subpath: RelativePath.make(query.path) }),
        ...(!includeDirectory ? {} : { directory: AbsolutePath.make(directory) }),
        ...(query.roots === undefined ? {} : { parentID: query.roots ? null : undefined }),
        ...(query.start === undefined ? {} : { start: query.start }),
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }
      const items = yield* canonical.list(input)
      return items.map(legacySessionFromV2)
    })
```

This mirrors the V1 query mapping exactly: `scope=project` suppresses the directory filter; `path` present and non-empty selects exact-or-prefix (plus the pathless-directory fallback in the core impl when directory is also given); `path` empty disables both filters; `roots` maps to `parentID: null`; ordering becomes `desc(time_updated)` via `orderBy: "updated"` (V2 default order is desc).

- [ ] **Step 3: Run the list and scope tests**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts`
Expected: all green — including "serves read routes" (`?roots=true`), the scope/path precedence test (lines 2091-2123), and the archived-timestamp tests.

- [ ] **Step 4: Run the DSL contract blocks for legacy list**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-exercise/index.ts`
Expected: green — the legacy `session.list` blocks and the v2 session blocks are untouched by this task.

- [ ] **Step 5: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean. (`AbsolutePath` is already imported at line 5.)

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts
git -c core.hooksPath=.git/hooks commit -m "refactor(opencode): list httpapi sessions through SessionV2"
```

---

### Task 5: Migrate the update endpoint (title/metadata/archive/permission)

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (update handler; imports)
- Test: `packages/opencode/test/server/httpapi-session.test.ts` (append the V2-events test)

**Interfaces:**
- Consumes: `SessionV2.update`, `SessionV2.permissions`, `SessionV2.setPermissions`, `toV2Rules` from `@opencode-ai/core/session/info` (exported pure converter), `DateTime.makeUnsafe` for the archived timestamp.
- Produces: unchanged PATCH semantics — title/metadata replace, archived round-trip (including `-1`), permission append-merge with last-match-wins.

- [ ] **Step 1: Write the failing V2-events test**

Append to `packages/opencode/test/server/httpapi-session.test.ts` (the harness already provides `Database.node` and `SessionV2` through `HttpApiApp.routes`):

```ts
  it.instance(
    "update persists through canonical V2 events only",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const { db } = yield* Database.Service
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "before" }),
        })

        yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: created.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "after", metadata: { a: 1 } }),
        })

        const v2Rows = yield* db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.next.updated.1")))
          .all()
          .pipe(Effect.orDie)
        const v1Rows = yield* db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.updated.1")))
          .all()
          .pipe(Effect.orDie)

        expect(v2Rows.length).toBe(1)
        expect(v1Rows.length).toBe(0)
      }),
  )
```

Add the imports this test needs to the test file: `import { and, eq } from "drizzle-orm"`, `import { EventTable } from "@opencode-ai/core/event/sql"`, `import { Database } from "@opencode-ai/core/database/database"` (match how `setLegacySummaryDiff` accesses the db in that file — reuse its pattern if it differs).

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "canonical V2 events"`
Expected: FAIL — the V1 path publishes `session.updated.1` (v1Rows > 0, v2Rows === 0).

- [ ] **Step 3: Replace the update handler**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` add:

```ts
import { toV2Rules } from "@opencode-ai/core/session/info"
```

Replace `update` (lines 320-341) with:

```ts
    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload
      if (payload.title !== undefined || payload.metadata !== undefined || payload.time?.archived !== undefined) {
        yield* canonical
          .update({
            sessionID,
            ...(payload.title === undefined ? {} : { title: payload.title }),
            ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
            ...(payload.time?.archived === undefined ? {} : { archived: DateTime.makeUnsafe(payload.time.archived) }),
          })
          .pipe(SessionError.mapSessionNotFound)
      }
      if (payload.permission !== undefined) {
        const current = yield* canonical.permissions(sessionID).pipe(SessionError.mapSessionNotFound)
        // V1 merged the current rules with the payload via Permission.merge,
        // which is flat concatenation; the V2 column shape concatenates the
        // same way (last-match-wins at evaluation time).
        yield* canonical
          .setPermissions({ sessionID, permissions: [...current, ...toV2Rules(payload.permission)] })
          .pipe(SessionError.mapSessionNotFound)
      }
      return yield* requireSession(ctx.params.sessionID)
    })
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "canonical V2 events"`
Expected: PASS — exactly one `session.next.updated.1`, zero legacy `session.updated.1`.

- [ ] **Step 5: Run the update contract tests**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts` and `bun test ./test/server/session-actions.test.ts`
Expected: green — lifecycle (`title`, `time.archived: 1`), metadata replace (`{}` full replacement), archived `-1` round-trip, permission responses all unchanged.

- [ ] **Step 6: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "refactor(opencode): update httpapi sessions through SessionV2"
```

---

### Task 6: Migrate the create endpoint with the inlined auto-share gate

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (create/createRaw handlers; imports)
- Modify: `packages/opencode/src/share/session.ts` (remove `create` from Interface and layer)
- Test: `packages/opencode/test/server/httpapi-session.test.ts` (append the V2-events create test)

**Interfaces:**
- Consumes: `SessionV2.create` (CreateInput: `{id?, parentID?, title?, agent?, model?, metadata?, location, permissions?}` — `packages/core/src/session/command.ts:62-71`), `Config.Service`, `RuntimeFlags.Service`, `ShareNext.Service`, `Scope.Scope`, `InstanceState`.
- Produces: unchanged POST /session wire behavior + auto-share gate; `SessionShare.create` is removed (its only caller was the create handler).

- [ ] **Step 1: Write the failing V2-events create test**

Append to `packages/opencode/test/server/httpapi-session.test.ts`:

```ts
  it.instance(
    "create persists through canonical V2 events only",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const { db } = yield* Database.Service
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created" }),
        })

        const v2Rows = yield* db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.next.created.1")))
          .all()
          .pipe(Effect.orDie)
        const v1Rows = yield* db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, created.id), eq(EventTable.type, "session.created.1")))
          .all()
          .pipe(Effect.orDie)

        expect(v2Rows.length).toBe(1)
        expect(v1Rows.length).toBe(0)
        expect(created.title).toBe("created")
      }),
  )
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "create persists"`
Expected: FAIL — the V1 path publishes `session.created.1`.

- [ ] **Step 3: Replace the create handlers**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` add imports:

```ts
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ShareNext } from "@/share/share-next"
```

(If `Scope` is not yet imported from `effect`, add it to the existing effect import.)

Replace `create` and `createRaw` (lines 292-313) with:

```ts
    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      const payload = ctx.payload
      const ctxState = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const created = yield* canonical.create({
        ...(payload?.parentID === undefined ? {} : { parentID: SessionV2.ID.make(payload.parentID) }),
        ...(payload?.title === undefined ? {} : { title: payload.title }),
        ...(payload?.agent === undefined ? {} : { agent: AgentV2.ID.make(payload.agent) }),
        ...(payload?.model === undefined
          ? {}
          : {
              model: {
                id: ModelV2.ID.make(payload.model.id),
                providerID: ProviderV2.ID.make(payload.model.providerID),
                ...(payload.model.variant === undefined ? {} : { variant: ModelV2.VariantID.make(payload.model.variant) }),
                ...(payload.model.protocol === undefined ? {} : { protocol: payload.model.protocol }),
              },
            }),
        ...(payload?.metadata === undefined ? {} : { metadata: payload.metadata }),
        ...(payload?.permission === undefined ? {} : { permissions: toV2Rules(payload.permission) }),
        location: Location.Ref.make({
          directory: AbsolutePath.make(ctxState.directory),
          ...(workspaceID === undefined ? {} : { workspaceID }),
        }),
      })

      if (created.parentID === undefined) {
        const flags = yield* RuntimeFlags.Service
        const cfg = yield* Config.Service
        const conf = yield* cfg.get()
        if (flags.autoShare || conf.share === "auto") {
          // Same fire-and-forget auto-share as the removed SessionShare.create:
          // disabled-config and share failures are logged and swallowed.
          yield* Effect.gen(function* () {
            const shareConf = yield* cfg.get()
            if (shareConf.share === "disabled") return
            const shareNext = yield* ShareNext.Service
            const result = yield* shareNext.create(SessionID.make(created.id))
            yield* canonical.update({ sessionID: created.id, share: { url: result.url } })
          }).pipe(Effect.ignore, Effect.forkIn(Scope.Scope))
        }
      }

      return yield* requireSession(SessionID.make(created.id))
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })
```

- [ ] **Step 4: Remove SessionShare.create**

In `packages/opencode/src/share/session.ts` remove the `create` member from the `Interface`:

```ts
export interface Interface {
  readonly share: (sessionID: SessionID) => Effect.Effect<{ url: string }, unknown>
  readonly unshare: (sessionID: SessionID) => Effect.Effect<void, unknown>
}
```

remove the `create` Effect.fn from the layer body (lines 39-46), change the return to:

```ts
    return Service.of({ share, unshare })
```

and remove the now-unused `import { Session } from "@/session/session"` if nothing else in the file references it (share/unshare only use `session.setShare` and `SessionID`). The `node` deps stay `[Config.node, Session.node, ShareNext.node, RuntimeFlags.node]` — `Session.Service` is still used by `setShare`.

- [ ] **Step 5: Run the test to verify it passes**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "create persists"`
Expected: PASS — exactly one `session.next.created.1`, zero legacy `session.created.1`.

- [ ] **Step 6: Run the create/update contract suites**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts` and `bun test ./test/server/session-actions.test.ts`
Expected: green — lifecycle create (empty body, title, metadata), fork-from-create, and metadata-on-create all unchanged. The fixtures use `share: "disabled"`, so the auto-share branch stays dormant exactly as before.

- [ ] **Step 7: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean — including `share/session.ts` (no remaining references to the removed `create`).

- [ ] **Step 8: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/src/share/session.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "refactor(opencode): create httpapi sessions through SessionV2 with the auto-share gate"
```

---

### Task 7: Migrate remove and fork, drop the V1 session service from the handlers

**Files:**
- Modify: `packages/opencode/src/session/session.ts` (export `cancelBackgroundJobs`)
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (remove/fork handlers; drop `Session.Service` and `LegacySessionRead` yields; imports)
- Modify: `packages/opencode/src/server/routes/instance/httpapi/server.ts` (drop `LegacySessionRead.layer` provide if it has no other consumer)
- Test: `packages/opencode/test/server/httpapi-session.test.ts` (append remove-events and fork-cutoff tests)

**Interfaces:**
- Consumes: `SessionV2.remove` (recurses into children, publishes `session.next.deleted`, cleans events — `packages/core/src/session.ts:517-541`), `SessionV2.messages` + `SessionV2.fork`, `cancelBackgroundJobs` (newly exported from `@/session/session`), `BackgroundJob.Service` (node present in the httpapi host graph, `server.ts:268`).
- Produces: unchanged DELETE and fork wire behavior; the handlers file no longer resolves the V1 `Session.Service` at all.

- [ ] **Step 1: Write the failing remove-events test**

Append to `packages/opencode/test/server/httpapi-session.test.ts`:

```ts
  it.instance(
    "remove persists through canonical V2 events and cleans up children",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const { db } = yield* Database.Service
        const parent = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "parent" }),
        })
        const child = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "child", parentID: parent.id }),
        })

        const removed = yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: parent.id }), {
          method: "DELETE",
          headers,
        })
        expect(removed).toBe(true)

        const v2Rows = yield* db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, parent.id), eq(EventTable.type, "session.next.deleted.1")))
          .all()
          .pipe(Effect.orDie)
        const v1Rows = yield* db
          .select()
          .from(EventTable)
          .where(and(eq(EventTable.aggregate_id, parent.id), eq(EventTable.type, "session.deleted.1")))
          .all()
          .pipe(Effect.orDie)

        expect(v2Rows.length).toBe(1)
        expect(v1Rows.length).toBe(0)

        const childGone = yield* request(pathFor(SessionPaths.get, { sessionID: child.id }), { headers })
        expect(childGone.status).toBe(404)
      }),
  )
```

- [ ] **Step 2: Write the fork cutoff pin test**

Append to the same file:

```ts
  it.instance(
    "fork cuts the canonical transcript at the given message",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const parent = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "fork source" }),
        })
        const first = yield* insertCanonicalUserMessage(parent.id, "hello", 1)
        const second = yield* insertCanonicalUserMessage(parent.id, "world", 2)

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: parent.id }), {
          method: "POST",
          headers,
          body: JSON.stringify({ messageID: second.info.id }),
        })
        expect(forked.id).not.toBe(parent.id)
        expect(forked.parentID).toBe(parent.id)

        const canonical = yield* SessionV2.Service
        const messages = yield* canonical.messages({ sessionID: SessionV2.ID.make(forked.id), order: "asc" })
        expect(messages.map((message) => message.text)).toEqual(["hello"])
        expect(messages.length).toBe(1)
      }),
  )
```

Note: reuse the existing `insertCanonicalUserMessage` helper in that file (returns `SessionV1.WithParts`-shaped fixtures with `.info.id`) — if its return shape differs, adapt to whatever the helper returns, keeping the assertion "the forked transcript contains only the messages before the cutoff".

- [ ] **Step 3: Run the tests to verify the remove-events one fails**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts -t "remove persists"` and `bun test ./test/server/httpapi-session.test.ts -t "fork cuts"`
Expected: remove test FAILS (V1 publishes `session.deleted.1`); fork test PASSES already (the current V1 fork delegates to canonical V2 — this is the pin that must survive the relocation).

- [ ] **Step 4: Export cancelBackgroundJobs**

In `packages/opencode/src/session/session.ts` change line 788:

```ts
const cancelBackgroundJobs = Effect.fn("Session.cancelBackgroundJobs")(function* (
```

to:

```ts
export const cancelBackgroundJobs = Effect.fn("Session.cancelBackgroundJobs")(function* (
```

(body unchanged — it filters running jobs by `job.id`, `job.metadata?.sessionId`, and `job.metadata?.parentSessionId` and cancels them.)

- [ ] **Step 5: Replace remove and fork**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` add imports:

```ts
import { BackgroundJob } from "@/background/job"
import { cancelBackgroundJobs } from "@/session/session"
```

Replace `remove` (lines 315-318) with:

```ts
    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      const hasInstance = yield* InstanceState.context.pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      )
      if (hasInstance) {
        const background = yield* BackgroundJob.Service
        yield* cancelBackgroundJobs(background, ctx.params.sessionID)
      }
      yield* canonical.remove(SessionV2.ID.make(ctx.params.sessionID)).pipe(SessionError.mapSessionNotFound)
      return true
    })
```

Replace `fork` (lines 343-353) with:

```ts
    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      const history = yield* canonical.messages({ sessionID, order: "asc" }).pipe(
        Effect.catchTag("Session.MessageDecodeError", Effect.die),
        SessionError.mapSessionNotFound,
      )
      const forked = yield* canonical
        .fork({
          sessionID,
          messages:
            ctx.payload?.messageID === undefined
              ? history
              : history.filter((message) => String(message.id) < String(ctx.payload.messageID)),
        })
        .pipe(SessionError.mapSessionNotFound)
      return yield* requireSession(SessionID.make(forked.id))
    })
```

`forkRaw` (lines 355-367) stays unchanged — it decodes the payload and delegates to `fork`.

- [ ] **Step 6: Drop the V1 session service and LegacySessionRead from the handler**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`:

- Delete line 137 (`const session = yield* Session.Service`).
- Delete line 138 (`const sessionRead = yield* LegacySessionRead.Service`).
- Delete the import `import { Session } from "@/session/session"` — but KEEP it if the file still references the `Session` namespace (the create/update/fork payload types `Session.CreateInput`/`Session.Metadata`/`Session.ArchivedTimestamp` in the groups import — verify with grep: if `Session.CreateInput` appears in `createRaw`, keep the import).
- Delete the import `import { LegacySessionRead } from "@/session/legacy-session-read"`.
- In `packages/opencode/src/server/routes/instance/httpapi/server.ts`: grep `LegacySessionRead` — if its only remaining use is the `sessionCompatibilityHandlers` provide (lines 151-154), remove `Layer.provide(LegacySessionRead.layer)` and the import at line 39, leaving:

```ts
const sessionCompatibilityHandlers = sessionHandlers.pipe(
  Layer.provide(LegacySessionExecution.layer),
)
```

If another handlers file consumes `LegacySessionRead.Service`, leave the provide in place and note it in your report instead.

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts`
Expected: all green — including both new tests and the full existing lifecycle suite.

- [ ] **Step 8: Run the opencode suite and typecheck**

Run (from `packages/opencode`): `bun test` then `bun typecheck`
Expected: green / clean. The whole opencode suite is the regression net for the removed yields and the exported helper.

- [ ] **Step 9: Commit**

```bash
git add packages/opencode/src/session/session.ts packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/src/server/routes/instance/httpapi/server.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "refactor(opencode): remove and fork httpapi sessions through SessionV2"
```

---

### Task 8: Final batch gates and migration inventory update

**Files:**
- Modify: `V1-to-V2-migration.md` (批次 8 下一步 section)

- [ ] **Step 1: Full verification gates**

Run, in order:

```bash
cd packages/core && bun test && bun typecheck
cd ../opencode && bun test && bun typecheck
cd ../server && bun typecheck
cd ../sdk-next && bun typecheck
```

Expected: all green. (`sdk-next` only if that package directory exists — check first; the handoff gates name `packages/server` and `packages/sdk-next`.)

- [ ] **Step 2: Hygiene checks**

Run: `git diff --check` and `git status --short`
Expected: no whitespace errors; the only untracked files are the protected paths (`docs/superpowers/handoffs/`, `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`) and the plan's SDD workspace.

Also verify no V1 session-service calls remain in the handler file:

```bash
grep -n "Session.Service\|LegacySessionRead" packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts
```

Expected: no matches.

- [ ] **Step 3: Update the migration inventory**

In `V1-to-V2-migration.md`, under `### 批次 8：删除 V1 目录（最终）`, append to the `**批次 8 下一步**` paragraph a new closeout note:

```text
> ✅ **本輪 httpapi session CRUD 遷移（999.0.17）**：
> - 實驗性 httpapi 的 list/get/children/create/remove/update/fork 與 requireSession 全部改走 `SessionV2.Service`；handler 不再 resolve V1 `Session.Service`，`LegacySessionRead` 的 httpapi 引用已移除。
> - 響應保留 V1 `Session.Info` wire 形狀，經 compat 層新增的純投影 `legacySessionFromV2`（`compat/native-v1-session.ts`，無任何 storage 讀取）；`summary`/`permission` 不在 V2 公共 Info 中，響應不再攜帶（與 production server 面一致），契約測試已同步。
> - `SessionV2.list` 擴充 `orderBy: "updated"`、`start`（time_updated >=）、`subpath` 前綴過濾與 pathless-directory fallback，完整覆蓋原 V1 list 的 directory/scope/path/roots/start/search/limit 語義。
> - create 走 `SessionV2.create`，auto-share 門檻（`flags.autoShare || conf.share === "auto"`，子 session 跳過）內聯至 handler；`SessionShare.create`（V1 wrapper）已移除，share/unshare 端點保留待後續批次。
> - update 走 `SessionV2.update` + `permissions`/`setPermissions`（permission 合併語義不變）；remove 走 `SessionV2.remove`（遞迴子 session）+ 保留 background-job 取消；fork 直接讀取 canonical V2 messages 並以 `SessionV2.fork` 複製（無 V2→V1→V2 往返）。
> - 剩餘 `Session.Service` consumer（stats/share sync/experimental list/CLI/TUI/sync/legacy execution/GitHub/task/code-mode 等）留待後續批次。
```

- [ ] **Step 4: Commit**

```bash
git add V1-to-V2-migration.md
git -c core.hooksPath=.git/hooks commit -m "docs: record the httpapi session CRUD V2 migration"
```
