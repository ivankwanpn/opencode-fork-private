# Session CRUD V2 P1/P2 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four P1 blockers and six P2 issues found by the external check of the session-httpapi-CRUD batch (the previous "READY TO MERGE" conclusion is retracted): remote share revocation on V2 delete, per-session background-job cancellation on recursive remove, create payload `workspaceID`, fork cutoff in transcript order, plus the list union decode, LIKE escaping, archived-zero, macOS menu zoom, wire-parity, and Deleted-event race issues, ending with the `999.0.17` version bump.

**Architecture:** The Deleted durable event becomes a surviving tombstone (purge-before-publish), which makes the wake-then-reread delivery deterministic and lets ShareNext revoke remote shares by watching the V2 `session.next.deleted` event directly (its `watch` helper already accepts any `EventV2.Definition`). The remove handler walks the session tree once and cancels each session's background jobs before the core recursion. Create honors `payload.workspaceID ?? routedWorkspace`. Fork cuts at the cutoff's transcript index (`findIndex` + `slice`), with unknown cutoffs rejected as 400. The ListInput union reorders so the project variant wins. Subpath LIKE patterns are escaped. Core `fromRow` reads `archived: 0` via nullish checks. The projection un-defaults the model variant and the handler restores the V1 child-title prefix. macOS native menus route the three zoom actions to the renderer path before the role check.

**Tech Stack:** Bun 1.3.14 test runner (bare test names act as filters — always pass `./path`), Effect 4.0.0-beta.83 (`Effect.fn` self-recursion per the V1 remove precedent), Drizzle+SQLite, Electron structural-type testability pattern (no electron imports in tested modules).

**Spec:** The external check findings (user message, 2026-08-14) are the spec; the previous batch's plan `docs/superpowers/plans/2026-08-14-session-httpapi-crud-v2.md` remains the context but its rulings 2 (fork cutoff verbatim) and its completion claims are superseded here.

## Global Constraints

- No star imports; no aliased imports outside the existing `@/` convention; avoid `any`/`as never`; avoid `else` (early return or switch).
- Tests run from package directories, never repository root. Bun bare test names act as filters — pass `./path` arguments.
- Stage explicit paths only (never `git add .`); commit with `git -c core.hooksPath=.git/hooks commit -m "type(scope): summary"`.
- Never modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` or anything under `docs/superpowers/handoffs/`. Never edit generated SDK files.
- Do not push (the branch is already on origin at `dad0bbb`; new commits stay local until the user pushes).

## Plan Rulings (binding)

1. **Deleted tombstone** — core `V2Session.remove` purges the aggregate's events BEFORE publishing `SessionEvent.Deleted`, so the deleted marker row survives as the aggregate's tombstone. This makes durable delivery deterministic (subscribers woken during publish always find the row on reread) and underpins remote share revocation. Cost: one small tombstone row per deleted session accumulates in the event table (no cleanup path today; acceptable).
2. **Share revocation via V2 watch** — ShareNext adds `watch(SessionEvent.Deleted, ...)` next to its V1 watch (its `watch` helper is generic over `EventV2.Definition`, and V1 definitions are registered on the same bus). The V1 watch stays (V1 remove producers still exist in cli/control-plane until later batches). No bridge projection is added — the minimal change is a second watch.
3. **Unknown fork cutoff → 400 BadRequest** — the V1 lexicographic filter could copy an arbitrary (possibly post-cutoff) transcript subset; preserving it is not acceptable. `findIndex` miss is a client error; the endpoint already declares `HttpApiError.BadRequest`.
4. **Child title** — the handler supplies `Child session - <ISO>` (V1 `childTitlePrefix` verbatim) when the payload omits the title but carries `parentID`; the root default stays the V2 create default (`New session - <ISO>`, identical to V1's `parentTitlePrefix`).
5. **Variant un-default** — `legacySessionFromV2` projects `variant: "default"` to `undefined` (V1 wire omission). Core `fromRow` is NOT changed (the server surface keeps its current variant semantics; only the httpapi projection is in scope).
6. **macOS zoom routing** — only the three zoom actions bypass the native role (action-first); all other `action+role` entries (edit/window/reload/devtools/fullscreen) keep role-first so macOS native accelerators continue to work. Keyboard zoom on macOS flows through the renderer keydown once the native zoom roles no longer consume the keys.
7. **Recursive background cancellation** — the handler collects the descendants via `canonical.children` recursion and calls `cancelBackgroundJobs` per session (root + descendants) before `canonical.remove`, restoring the V1 per-session cancellation (V1's recursive remove re-entered cancelBackgroundJobs for every child).
8. **WorkspaceID precedence** — `payload.workspaceID ?? InstanceState.workspaceID` (V1 semantics). If the test harness cannot create a workspace-scoped session (experimental-workspaces flag), the implementer reports BLOCKED with evidence and the test degrades to a row-assertion using the instance's own routed workspace.

---

### Task 1: Purge-before-publish in core remove (tombstone)

**Files:**
- Modify: `packages/core/src/session.ts` (remove impl, lines ~517-541)
- Test: `packages/core/test/session-list-query.test.ts` (append one test) or a new `packages/core/test/session-remove.test.ts` — new file preferred (its own harness copy from `session-create.test.ts:38-55`, same as `session-list-query.test.ts`)

**Interfaces:**
- Produces: after `SessionV2.remove`, the EventTable retains exactly one row for the aggregate — `type: "session.next.deleted"` (durable, version 1) — and the session row is gone (`get` fails NotFoundError). Consumers: ShareNext's new V2 watch (Task 2) and the remove test's live-stream pin.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/session-remove.test.ts`:

```ts
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
      expect(rows[0]!.type).toBe("session.next.deleted")
      expect(rows[0]!.version).toBe(1)

      const sessionRows = yield* db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).all().pipe(Effect.orDie)
      expect(sessionRows).toHaveLength(0)
    }),
  )
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/core`): `bun test ./test/session-remove.test.ts`
Expected: FAIL — `rows` has length 0 (the publish-then-purge order removes the deleted marker too).

- [ ] **Step 3: Reorder purge before publish**

In `packages/core/src/session.ts`, inside `V2Session.remove`, replace the tail:

```ts
        const timestamp = yield* DateTime.now
        yield* events.publish(
          SessionEvent.Deleted,
          { timestamp, sessionID, info: rowToSnapshot(row) },
          { location: fromRow(row).location },
        )
        yield* events.remove(sessionID)
```

with:

```ts
        const timestamp = yield* DateTime.now
        // Purge BEFORE publishing so the Deleted marker survives as the
        // aggregate's tombstone: durable subscribers are woken during publish
        // and re-read the table — with the old order a slow subscriber could
        // re-read an empty aggregate and miss the deletion (remote share
        // revocation depends on this event being durably observable).
        yield* events.remove(sessionID)
        yield* events.publish(
          SessionEvent.Deleted,
          { timestamp, sessionID, info: rowToSnapshot(row) },
          { location: fromRow(row).location },
        )
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `packages/core`): `bun test ./test/session-remove.test.ts`
Expected: 1/1 PASS.

- [ ] **Step 5: Run the core suite**

Run (from `packages/core`): `bun test` then `bun typecheck`
Expected: green / clean. (The tombstone changes what `SessionV2.history`/`events` reads return for deleted aggregates — the suite will surface any test that asserted zero rows post-remove.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/test/session-remove.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(core): keep the deleted event as the aggregate tombstone"
```

---

### Task 2: ShareNext revokes remote shares on V2 deletes

**Files:**
- Modify: `packages/opencode/src/share/share-next.ts` (add the V2 watch next to the V1 one at line 256; import `SessionEvent`)

**Interfaces:**
- Consumes: Task 1's tombstone (deterministic delivery), the existing `watch` helper (generic over `EventV2.Definition`), `SessionID.make`.
- Produces: V2 `session.next.deleted` events trigger `ShareNext.remove` — remote share deletion + local `SessionShareTable` row removal — exactly like the V1 `session.deleted` watch beside it.

- [ ] **Step 1: Add the V2 watch**

In `packages/opencode/src/share/share-next.ts` add the import (check the existing import block; `SessionEvent` comes from `@opencode-ai/core/session/event`):

```ts
import { SessionEvent } from "@opencode-ai/core/session/event"
```

and directly below the existing V1 watch (line 256 `yield* watch(Session.Event.Deleted, (data) => remove(data.sessionID))`) add:

```ts
        // V2 removes publish session.next.deleted (the V1 producers are being
        // migrated away); watch it directly so remote shares are revoked before
        // the local session_share row cascades away with the session.
        yield* watch(SessionEvent.Deleted, (data) => remove(SessionID.make(data.sessionID)))
```

Keep the V1 watch in place (V1 remove producers still exist in cli/control-plane).

- [ ] **Step 2: Typecheck and run the share-related tests**

Run (from `packages/opencode`): `bun typecheck`
Run (from `packages/opencode`): `bun test ./test/share` if that directory exists (check first — if not, run `bun test ./test/server/httpapi-session.test.ts --timeout 30000` as the regression net and note it)
Expected: clean / green. (ShareNext is disabled in test configs, so the watch is dormant in tests; the wiring is what typecheck + review verify.)

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/share/share-next.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): revoke remote shares on V2 session deletes"
```

---

### Task 3: Per-session background-job cancellation on remove

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (remove handler)
- Test: `packages/opencode/test/server/httpapi-session.test.ts` (append one test)

**Interfaces:**
- Consumes: `canonical.children` (self-recursive collection), `cancelBackgroundJobs` (already imported), `BackgroundJob.Service`.
- Produces: before `canonical.remove`, every session in the subtree (root + descendants) gets its running background jobs canceled — V1's per-session semantics.

- [ ] **Step 1: Write the failing test**

Read `packages/opencode/src/background/job.ts` first to learn the registration API. Append to `packages/opencode/test/server/httpapi-session.test.ts`:

```ts
  it.instance(
    "remove cancels background jobs owned by descendant sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
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

        const background = yield* BackgroundJob.Service
        // Register a running job owned by the CHILD session (metadata.sessionId
        // = child.id), matching cancelBackgroundJobs' filter. Use whatever
        // registration API produces a job with status "running" — read
        // packages/opencode/src/background/job.ts for the exact shape.
        // (Implementer: replace this comment block with the actual
        // registration code and record the API used in the report.)

        yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: parent.id }), {
          method: "DELETE",
          headers,
        })

        const jobs = yield* background.list()
        expect(jobs.some((job) => job.id === childJobID)).toBe(false)
      }),
  )
```

If no API can produce a "running" job in the test environment, STOP and report BLOCKED with the job.ts evidence.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Expected: FAIL — the child's job survives (the current handler cancels only the root's jobs).

- [ ] **Step 3: Replace the remove handler**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` replace `remove` with:

```ts
    const collectDescendants = Effect.fnUntraced(function* (sessionID: SessionV2.ID): Effect.Effect<SessionV2.ID[], never, never> {
      const kids = yield* canonical.children(sessionID)
      const nested = yield* Effect.forEach(kids, (kid) => collectDescendants(kid.id), {
        concurrency: "unbounded",
      })
      return [...kids.map((kid) => kid.id), ...nested.flat()]
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      const hasInstance = yield* InstanceState.context.pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      )
      if (hasInstance) {
        const background = yield* BackgroundJob.Service
        // V1 canceled jobs per session during its recursion; the V2 core
        // recursion does not know BackgroundJob, so cancel the whole subtree
        // up front (root + descendants) before the core removes it.
        const descendants = yield* collectDescendants(sessionID)
        for (const id of [sessionID, ...descendants]) {
          yield* cancelBackgroundJobs(background, SessionID.make(id))
        }
      }
      yield* canonical.remove(sessionID).pipe(SessionError.mapSessionNotFound)
      return true
    })
```

(`requireSession` up front preserves the V1 404-on-missing-root and guarantees `children` never 404s inside the walk. Self-recursive `Effect.fnUntraced` follows the V1 remove precedent in `session.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Expected: the new test PASS; the remove-persists and fork-cutoff tests stay green (50 total pass, environment-slow tests may need the timeout as usual).

- [ ] **Step 5: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean. (`SessionV2.ID` is exposed on the SessionV2 namespace — if `collectDescendants` needs explicit typing adjustments, keep the semantics identical.)

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): cancel descendant background jobs on session remove"
```

---

### Task 4: Honor the create payload workspaceID and cut forks at the transcript index

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (create location + fork)
- Test: `packages/opencode/test/server/httpapi-session.test.ts` (append two tests)

**Interfaces:**
- Produces: create location `workspaceID: payload?.workspaceID ?? InstanceState.workspaceID` (V1 precedence); fork cuts at `history.findIndex(id === cutoff)` with `slice(0, index)` and 400 on unknown cutoff (ruling 3).

- [ ] **Step 1: Write the failing workspaceID test**

Append to `packages/opencode/test/server/httpapi-session.test.ts`:

```ts
  it.instance(
    "create stores the payload workspaceID over the routed one",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const { db } = yield* Database.Service

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "ws", workspaceID: "wrk_payload" }),
        })
        expect(created.id).toBeTruthy()

        const row = yield* db
          .select({ workspace_id: SessionTable.workspace_id })
          .from(SessionTable)
          .where(eq(SessionTable.id, created.id))
          .get()
          .pipe(Effect.orDie)
        expect(row?.workspace_id).toBe("wrk_payload")
      }),
  )
```

Add the imports this test needs (`SessionTable` from `@opencode-ai/core/session/sql`, `eq` from `drizzle-orm` — check what is already imported in the file and reuse). If the harness's location resolution rejects a foreign workspace (experimental-workspaces flag off), report BLOCKED with the evidence; the fallback per ruling 8 is to assert with the instance's own routed workspace ID as the payload value (proving precedence wiring compiles and stores — state which form was used).

- [ ] **Step 2: Write the failing fork tests**

Append to the same file:

```ts
  it.instance(
    "fork cuts the transcript at the cutoff's transcript index",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const parent = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "fork source" }),
        })
        // Seed two canonical messages whose ID order differs from transcript
        // order (ascending IDs would hide the lexicographic bug). If
        // insertCanonicalUserMessage forces ascending IDs, insert SessionMessageTable
        // rows directly with explicit ids "msg_zzz" then "msg_aaa" (type "user",
        // text "hello"/"world", time 1/2) — mirror the insert helper's row shape.
        // (Implementer: replace this comment with the actual seeding code and
        // record the mechanism used.)

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: parent.id }), {
          method: "POST",
          headers,
          body: JSON.stringify({ messageID: "msg_aaa" }),
        })

        const canonical = yield* SessionV2.Service
        const messages = yield* canonical.messages({ sessionID: SessionV2.ID.make(forked.id), order: "asc" })
        expect(messages.map((message) => ("text" in message ? message.text : null))).toEqual(["hello"])
      }),
  )

  it.instance(
    "fork rejects a cutoff that is not in the transcript",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const parent = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "fork source" }),
        })

        const response = yield* request(pathFor(SessionPaths.fork, { sessionID: parent.id }), {
          method: "POST",
          headers,
          body: JSON.stringify({ messageID: "msg_nonexistent" }),
        })
        expect(response.status).toBe(400)
      }),
  )
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Expected: workspaceID test FAILS (row stores the routed/none value); fork-index test FAILS (empty fork — the lexicographic filter drops `msg_zzz`); fork-400 test FAILS (V1 returns 200 with a wrong subset).

- [ ] **Step 4: Apply the handler fixes**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`, in the `create` handler change the location construction to:

```ts
        location: Location.Ref.make({
          directory: AbsolutePath.make(ctxState.directory),
          ...((payload?.workspaceID ?? workspaceID) === undefined
            ? {}
            : { workspaceID: payload?.workspaceID ?? workspaceID }),
        }),
```

and replace `fork` with:

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
      const cutoff = ctx.payload?.messageID
      let messages = history
      if (cutoff !== undefined) {
        // Cut at the cutoff's TRANSCRIPT index (ruling 3): the old lexicographic
        // filter could copy an arbitrary subset when imported IDs sort outside
        // transcript order. An unknown cutoff is a client error.
        const index = history.findIndex((message) => String(message.id) === String(cutoff))
        if (index < 0) return yield* new HttpApiError.BadRequest({})
        messages = history.slice(0, index)
      }
      const forked = yield* canonical.fork({ sessionID, messages }).pipe(SessionError.mapSessionNotFound)
      return yield* requireSession(SessionID.make(forked.id))
    })
```

(`forkRaw` stays unchanged — it decodes the payload and delegates.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Expected: all three new tests PASS; the whole file green (52 pass).

- [ ] **Step 6: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): honor the create payload workspaceID and cut forks at the transcript index"
```

---

### Task 5: List union decode, subpath LIKE escaping, archived zero

**Files:**
- Modify: `packages/core/src/session.ts` (union order at line 88; subpath LIKE condition at ~556)
- Modify: `packages/core/src/session/info.ts` (fromRow archived at line 66)
- Test: `packages/core/test/session-list-query.test.ts` (append three tests) and a new `packages/core/test/session-info.test.ts` (archived zero unit test)

**Interfaces:**
- Produces: `{project, directory, subpath}` decodes as the project variant with all fields retained; subpath LIKE patterns escape `%`, `_`, and `\` with an `ESCAPE '\'` clause; `fromRow` reads `time_archived: 0` as epoch zero instead of undefined.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/session-list-query.test.ts` (it already imports Schema-capable modules — add `Schema` from `"effect"` if missing):

```ts
  it("decodes the project variant with directory and subpath intact", () => {
    const decoded = Schema.decodeUnknownSync(SessionV2.ListInput)({
      project: ProjectV2.ID.global,
      directory: AbsolutePath.make("/project"),
      subpath: RelativePath.make("packages/opencode"),
    })
    expect("project" in decoded).toBe(true)
    if (!("project" in decoded)) return
    expect(decoded.directory).toBe("/project")
    expect(decoded.subpath).toBe("packages/opencode")
  })

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
```

Create `packages/core/test/session-info.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { fromRow } from "../src/session/info"

describe("fromRow", () => {
  test("reads an archived timestamp of epoch zero", () => {
    const row = {
      id: "sess_x",
      project_id: "prj_global",
      slug: "slug",
      directory: "/project",
      title: "t",
      version: "v",
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      time_created: 1000,
      time_updated: 1000,
      time_compacting: null,
      time_archived: 0,
    }
    const info = fromRow(row as Parameters<typeof fromRow>[0])
    expect(info.time.archived).toEqual(DateTime.makeUnsafe(0))
  })
})
```

(If the row fixture's type needs more fields per `SessionTable.$inferSelect`, add them as `null`/`undefined` — the assertion targets `time.archived` only.)

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/core`): `bun test ./test/session-list-query.test.ts ./test/session-info.test.ts`
Expected: decode test FAILS (`"project" in decoded` false — the directory variant wins and strips the fields); LIKE test FAILS (both rows match); archived test FAILS (undefined).

- [ ] **Step 3: Fix the union order**

In `packages/core/src/session.ts` change line 88:

```ts
export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
```

to:

```ts
// The project variant must precede the directory variant: a query carrying
// {project, directory, subpath} would otherwise decode as ListDirectoryInput
// and silently drop the project scoping and subpath filter.
export const ListInput = Schema.Union([ListProjectInput, ListDirectoryInput, ListAllInput])
```

- [ ] **Step 4: Escape the subpath LIKE pattern**

In `packages/core/src/session.ts`, in the subpath condition block, replace:

```ts
            const pathConditions = [eq(SessionTable.path, input.subpath), like(SessionTable.path, `${input.subpath}/%`)]
```

with:

```ts
            const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)
            const pathConditions = [
              eq(SessionTable.path, input.subpath),
              sql`${SessionTable.path} LIKE ${`${escapeLike(input.subpath)}/%`} ESCAPE '\\'`,
            ]
```

(`sql` is already imported from `drizzle-orm` in this file — if not, add it. The exact-match `eq` branch is unaffected.)

- [ ] **Step 5: Fix the archived read**

In `packages/core/src/session/info.ts` change:

```ts
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
```

to:

```ts
      archived:
        row.time_archived === null || row.time_archived === undefined
          ? undefined
          : DateTime.makeUnsafe(row.time_archived),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `packages/core`): `bun test ./test/session-list-query.test.ts ./test/session-info.test.ts`
Expected: all three new tests PASS.

- [ ] **Step 7: Run the core suite**

Run (from `packages/core`): `bun test` then `bun typecheck`
Expected: green / clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/session/info.ts packages/core/test/session-list-query.test.ts packages/core/test/session-info.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(core): list variant decoding, LIKE escaping, and archived epoch zero"
```

---

### Task 6: Projection variant and the child-title prefix

**Files:**
- Modify: `packages/opencode/src/compat/native-v1-session.ts` (variant un-default)
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` (create title)
- Test: `packages/opencode/test/compat/native-v1-session.test.ts` (extend) and `packages/opencode/test/server/httpapi-session.test.ts` (append)

**Interfaces:**
- Produces: `legacySessionFromV2` projects `variant: "default"` to undefined (V1 wire omission, ruling 5); create without a title but with `parentID` uses `Child session - <ISO>` (V1 `childTitlePrefix` at `packages/opencode/src/session/session.ts:48`).

- [ ] **Step 1: Write the failing tests**

In `packages/opencode/test/compat/native-v1-session.test.ts`, extend the first test's fixture model to `variant: "default"` and change the model assertion to `expect(projected.model).toEqual({ id: "claude-sonnet-5", providerID: "anthropic" })` (variant absent), then append:

```ts
  test("projects non-default model variants through", () => {
    const info = SessionSchema.Info.make({
      id: "sess_v2id",
      projectID: "prj_1",
      title: "hello",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(1000), updated: DateTime.makeUnsafe(1000) },
      location: { directory: "D:/work" },
      model: { id: "claude-sonnet-5", providerID: "anthropic", variant: "opus-pro" },
    })

    expect(legacySessionFromV2(info).model?.variant).toBe("opus-pro")
  })
```

Append to `packages/opencode/test/server/httpapi-session.test.ts`:

```ts
  it.instance(
    "create titles child sessions with the V1 child prefix",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const parent = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "parent" }),
        })
        const child = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ parentID: parent.id }),
        })
        expect(child.title.startsWith("Child session - ")).toBe(true)
      }),
  )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/opencode`): `bun test ./test/compat/native-v1-session.test.ts` and `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Expected: variant test FAILS (`"default"` present); child-title test FAILS (`New session - `).

- [ ] **Step 3: Un-default the variant**

In `packages/opencode/src/compat/native-v1-session.ts`, in `legacySessionFromV2`'s model mapping, change:

```ts
            variant: info.model.variant,
```

to:

```ts
            variant: info.model.variant === "default" ? undefined : info.model.variant,
```

- [ ] **Step 4: Add the child-title prefix**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`, in the `create` handler, change the title spread:

```ts
        ...(payload?.title === undefined ? {} : { title: payload.title }),
```

to:

```ts
        ...(payload?.title === undefined
          ? payload?.parentID === undefined
            ? {}
            : { title: `Child session - ${new Date().toISOString()}` }
          : { title: payload.title }),
```

(The root default stays the V2 create default `New session - <ISO>`, which equals V1's `parentTitlePrefix`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `packages/opencode`): `bun test ./test/compat/native-v1-session.test.ts` and `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Expected: both new tests PASS; the file suites stay green.

- [ ] **Step 6: Typecheck**

Run (from `packages/opencode`): `bun typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/compat/native-v1-session.ts packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts packages/opencode/test/compat/native-v1-session.test.ts packages/opencode/test/server/httpapi-session.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): project default variants away and restore the V1 child title"
```

---

### Task 7: Route macOS native menu zoom through the renderer

**Files:**
- Create: `packages/desktop/src/main/menu-zoom.ts` (pure, no electron imports)
- Modify: `packages/desktop/src/main/menu.ts` (zoom check before the role check)
- Test: `packages/desktop/src/main/menu-zoom.test.ts` (new)

**Interfaces:**
- Produces: `isZoomAction(action): boolean` (true for `view.resetZoom`/`view.zoomIn`/`view.zoomOut`); `menu.ts` builds a click item calling `runDesktopMenuAction` for those three before the role branch (ruling 6). All other `action+role` entries keep role-first (macOS native accelerators preserved).

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/main/menu-zoom.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { isZoomAction } from "./menu-zoom"

describe("isZoomAction", () => {
  test("recognizes the three zoom actions", () => {
    expect(isZoomAction("view.resetZoom")).toBe(true)
    expect(isZoomAction("view.zoomIn")).toBe(true)
    expect(isZoomAction("view.zoomOut")).toBe(true)
  })

  test("rejects other action+role entries and undefined", () => {
    expect(isZoomAction("view.reload")).toBe(false)
    expect(isZoomAction("view.toggleDevTools")).toBe(false)
    expect(isZoomAction("view.toggleFullscreen")).toBe(false)
    expect(isZoomAction("edit.undo")).toBe(false)
    expect(isZoomAction(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/desktop`): `bun test ./src/main/menu-zoom.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the pure helper**

Create `packages/desktop/src/main/menu-zoom.ts`:

```ts
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"

// The three zoom actions must reach runDesktopMenuAction on the native macOS
// menu: Electron's built-in zoom roles would apply zoom in the main process,
// bypassing the renderer-owned zoom path. Entries with BOTH a role and one of
// these actions therefore prefer the action; every other action+role entry
// keeps its native role (macOS accelerators depend on it).
const ZOOM_ACTIONS: readonly DesktopMenuAction[] = ["view.resetZoom", "view.zoomIn", "view.zoomOut"]

export function isZoomAction(action: DesktopMenuAction | undefined): boolean {
  return action !== undefined && ZOOM_ACTIONS.includes(action)
}
```

- [ ] **Step 4: Wire it into the native menu**

In `packages/desktop/src/main/menu.ts`, add the import:

```ts
import { isZoomAction } from "./menu-zoom"
```

and in `nativeItem`, insert BEFORE the `if (entry.role)` line:

```ts
  if (entry.action && isZoomAction(entry.action)) {
    const action = entry.action
    const zoomItem: MenuItemConstructorOptions = {
      label: entry.label,
      accelerator: entry.accelerator?.macos,
    }
    zoomItem.click = () =>
      runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
        relaunch: deps.relaunch,
        createWindow: createMainWindow,
      })
    return zoomItem
  }
```

(Note: the zoom entries carry no macOS accelerators, so Cmd+0/Cmd+=/Cmd+- are no longer consumed by native roles — they reach the renderer's own keydown handler in `webview-zoom.ts`, which routes them through the same renderer-owned path. This is the intended behavior per ruling 6.)

- [ ] **Step 5: Run the tests and the desktop suite**

Run (from `packages/desktop`): `bun test ./src/main/menu-zoom.test.ts`
Run (from `packages/desktop`): `bun test`
Run (from `packages/desktop`): `bun typecheck`
Expected: 2/2 new tests PASS; full desktop suite green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/menu-zoom.ts packages/desktop/src/main/menu-zoom.test.ts packages/desktop/src/main/menu.ts
git -c core.hooksPath=.git/hooks commit -m "fix(desktop): route native menu zoom through the renderer"
```

---

### Task 8: Bump 999.0.17 and correct the migration notes

**Files:**
- Modify: the 19 `packages/*/package.json` files currently at `"version": "999.0.16"` (app, cli, codemode, core, desktop, effect-drizzle-sqlite, effect-sqlite-node, enterprise, function, http-recorder, llm, opencode, plugin, server, session-ui, slack, tui, ui, web) — each `"version": "999.0.16"` → `"999.0.17"`
- Modify: `bun.lock` (refresh via `bun install`)
- Modify: `V1-to-V2-migration.md` (append a P1-fix block to the httpapi closeout)

- [ ] **Step 1: Bump the versions**

For each of the 19 package.json files, change `"version": "999.0.16"` to `"version": "999.0.17"` (explicit per-file staging — do not use `git add .`). Then run `bun install` from the repo root to refresh `bun.lock` and verify with `git diff bun.lock | head` that only version refs changed.

- [ ] **Step 2: Correct the migration closeout**

In `V1-to-V2-migration.md`, right after the `**本輪 httpapi session CRUD 遷移（999.0.17）**` block, append:

```text
>
> **本輪 P1/P2 修正（999.0.17）**：
> - remove 現在先 purge 再發布 `session.next.deleted`，Deleted 事件作為 aggregate tombstone 留存，durable 訂閱的 wake-then-reread 交付變成確定性。
> - ShareNext 直接 watch V2 `session.next.deleted`，V2 刪除會同步撤銷遠端分享（修復本地 `session_share` cascade 後遠端 URL 無法撤銷的洩漏）。
> - remove handler 在 core 遞迴前逐 session 取消整棵子樹的 background jobs（V1 每 session 取消語義還原）。
> - create 尊重 payload 的 `workspaceID`（`payload.workspaceID ?? routedWorkspace`）；未指定 title 的子 session 使用 V1 的 `Child session - ` 前綴。
> - fork 改以 cutoff 的 transcript index 切割（`findIndex` + `slice`），未知 cutoff 回 400；原字典序過濾在 imported IDs 下會複製錯誤子集。
> - `SessionV2.ListInput` union 順序修正（project variant 優先，`{project,directory,subpath}` 不再被剝成 directory 查詢）；subpath LIKE 逃逸 `%`/`_`/`\`（`ESCAPE '\'`）；`fromRow` 的 `archived: 0` 改 nullish 讀取。
> - 投影不再把 model variant 強制成 `"default"`；macOS 原生選單的 zoom 動作在 role 檢查前走 renderer-owned 路徑。
```

- [ ] **Step 3: Hygiene**

Run: `git diff --check` and `git status --short`
Expected: no whitespace errors; only the intended files modified + the two protected untracked paths.

- [ ] **Step 4: Commit**

```bash
git add packages/*/package.json bun.lock V1-to-V2-migration.md
git -c core.hooksPath=.git/hooks commit -m "chore: bump 999.0.17 and record the P1 fixes"
```

(Verify `git status --short` before staging — only the 19 package.json files, bun.lock, and the migration doc should be staged.)

---

### Task 9: Final verification gates

- [ ] **Step 1: Typechecks**

Run (from `packages/core`, `packages/opencode`, `packages/server`, `packages/sdk-next`, `packages/desktop`, `packages/app`): `bun typecheck` in each.
Expected: all exit 0.

- [ ] **Step 2: Targeted suites**

Run (from `packages/core`): `bun test ./test/session-remove.test.ts ./test/session-list-query.test.ts ./test/session-info.test.ts`
Run (from `packages/opencode`): `bun test ./test/server/httpapi-session.test.ts --timeout 30000`
Run (from `packages/opencode`): `bun test ./test/compat/native-v1-session.test.ts`
Run (from `packages/desktop`): `bun test`
Run (from `packages/app`): `bun run test:unit`
Expected: all green (the known environment-slow tests may need the timeout).

- [ ] **Step 3: Hygiene**

Run: `git diff --check` and `grep -rn "999.0.16" packages/*/package.json` (expected: no matches).
