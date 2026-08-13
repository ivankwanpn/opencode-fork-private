# V2 Session Workspace Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `Session.Service` dependency from instance HttpApi workspace routing and select session-scoped placement exclusively from canonical `SessionV2.Info.location`.

**Architecture:** `WorkspaceRoutingMiddleware` remains the single routing decision point, but its advisory Session lookup moves from the OpenCode V1 service to process-global `SessionV2.Service`. Only typed V2 not-found errors fall back to request placement; unexpected defects fail the request instead of silently routing work to another directory.

**Tech Stack:** TypeScript, Bun, Effect, Effect HttpApi, canonical `@opencode-ai/core/session`.

## Global Constraints

- Work only in `D:\agent-complete\opencode-fork-private-999.0.15` on branch `999.0.17`.
- Do not migrate or read retained legacy `message` / `part` rows and do not add any V1 fallback.
- Preserve routing precedence: Session location workspace beats query workspace; configured environment workspace beats the selected workspace; Session location directory beats query, header, and `process.cwd()` fallbacks.
- Missing Session lookup remains advisory; unexpected Session lookup defects must not be swallowed.
- Do not change public Protocol or HttpApi schemas in this task; Client regeneration is not required.
- Run tests and `bun typecheck` from `packages/opencode`, never from the repository root.
- Follow red-green TDD: the new canonical placement tests must fail for the expected legacy lookup reason before production code changes.
- Manually edit files only with `apply_patch`.
- Do not modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`.
- Stage only the five files named in this plan.

---

### Task 1: Route Session-scoped requests through canonical V2 placement

**Files:**
- Modify: `packages/opencode/test/server/httpapi-workspace-routing.test.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts`
- Modify: `packages/opencode/test/server/httpapi-instance-context.test.ts`
- Modify: `packages/opencode/test/server/httpapi-promptasync-context.test.ts`
- Modify: `packages/opencode/test/server/httpapi-mcp-oauth.test.ts`

**Interfaces:**
- Consumes: `SessionV2.Service.get(SessionV2.ID)` and canonical `SessionV2.Info.location`.
- Produces: `WorkspaceRoutingMiddleware` whose only Session dependency is `SessionV2.Service`; typed not-found fallback and non-swallowed defects; unchanged `WorkspaceRouteContext` and routing precedence.

- [ ] **Step 1: Add a Session-ID probe route and canonical Session fixture**

In `httpapi-workspace-routing.test.ts`, replace the legacy Session import with:

```ts
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Context, DateTime, Effect, Layer, Queue, Ref, Schema, Stream } from "effect"
```

Extend `ProbeApi` with a Session-ID route so `getWorkspaceRouteSessionID(...)` exercises the real middleware path:

```ts
HttpApiEndpoint.get("sessionByID", "/session/:sessionID", {
  params: { sessionID: SessionV2.ID },
  query: WorkspaceRoutingQuery,
  success: ProbeResult,
})
```

Add the corresponding handler returning `routeContextResponse`. Define a narrow fixture factory that returns a valid canonical Session and allows the location to be supplied explicitly:

```ts
const canonicalSession = (input: {
  id: SessionV2.ID
  projectID: Project.Info["id"]
  directory: string
  workspaceID?: WorkspaceV2.ID
}) =>
  SessionV2.Info.make({
    id: input.id,
    projectID: input.projectID,
    title: "Canonical session",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: DateTime.makeUnsafe(1),
      updated: DateTime.makeUnsafe(1),
    },
    location: {
      directory: AbsolutePath.make(input.directory),
      workspaceID: input.workspaceID,
    },
  })
```

Keep the existing empty `Layer.mock(Session.Service)({})` only during the RED step so current production code can build. Add a `SessionV2.Service` mock whose `get` returns the fixture and whose unused methods retain the standard `Layer.mock` defect behavior.

- [ ] **Step 2: Add two independent canonical placement tests**

Add a test named `uses canonical session directory before request directory hints`:

- create a temporary project;
- use a canonical Session with no workspace and `location.directory = sessionDirectory`;
- request `/session/{id}?directory={queryDirectory}` with a different `x-opencode-directory`;
- assert status 200 and `{ directory: sessionDirectory, workspaceID: null }`.

Add a test named `uses canonical session workspace before a conflicting workspace query`:

- create two real local workspaces for the same temporary project;
- set the canonical Session `location.workspaceID` to the first workspace;
- request `/session/{id}?workspace={secondWorkspace.id}`;
- assert the route context uses the first workspace ID and the first workspace target directory.

These remain separate because the second test's directory comes from the workspace adapter target; it cannot prove the Session directory precedence by itself.

- [ ] **Step 3: Add not-found and defect behavior tests**

Add `falls back to request placement when the canonical session is missing` with a V2 `get` implementation that fails with:

```ts
new SessionV2.NotFoundError({ sessionID })
```

Request the Session-ID probe with a directory query and assert that directory is used.

Add `does not swallow canonical session lookup defects` with `get: () => Effect.die("session lookup defect")`; request the Session-ID probe and assert HTTP status 500. This locks the removal of the current broad `catchDefect` fallback.

- [ ] **Step 4: Run the focused suite and verify RED**

Run from `packages/opencode`:

```powershell
bun test test/server/httpapi-workspace-routing.test.ts --timeout 30000
```

Expected RED:

- the directory and workspace tests do not use the supplied `SessionV2.Service` because production still calls legacy `Session.Service.get`;
- the missing-Session test may already match fallback behavior;
- the defect test fails because current production catches the legacy lookup defect and routes successfully instead of returning 500.

The run must reach assertions. A TypeScript/import error or broken fixture is not a valid RED; fix the test setup until failures reflect the missing production migration.

- [ ] **Step 5: Replace the middleware dependency with SessionV2**

In `workspace-routing.ts`:

- replace `import { Session } from "@/session/session"` with `import { SessionV2 } from "@opencode-ai/core/session"`;
- remove the legacy storage `NotFoundError` import;
- change `WorkspaceRoutingMiddleware.requires` to `SessionV2.Service`;
- change `planRequest` to accept `session?: SessionV2.Info`;
- read `session?.location.workspaceID` and `session?.location.directory`;
- change the `routeHttpApiWorkspace` environment union to `SessionV2.Service`;
- call `SessionV2.Service.use((sessions) => sessions.get(SessionV2.ID.make(sessionID)))`;
- catch only `Schema.is(SessionV2.NotFoundError)` and return `undefined` for that typed error;
- delete the broad `Effect.catchDefect(() => Effect.succeed(undefined))`.

Do not alter `selectedV2WorkspaceID`, environment workspace precedence, remote proxying, control-plane exclusions, or `getWorkspaceRouteSessionID`.

- [ ] **Step 6: Replace test-layer Session requirements**

After production compiles against V2, remove the temporary legacy mock from the new tests. Replace every workspace-routing support mock/import from `Session.Service` to `SessionV2.Service` in:

```text
packages/opencode/test/server/httpapi-workspace-routing.test.ts
packages/opencode/test/server/httpapi-instance-context.test.ts
packages/opencode/test/server/httpapi-promptasync-context.test.ts
packages/opencode/test/server/httpapi-mcp-oauth.test.ts
```

Do not refactor unrelated fixture layers. Keep `fakeSession` in the MCP OAuth test as a V2 mock rather than changing that suite's middleware assembly.

- [ ] **Step 7: Run GREEN and related regression suites**

Run from `packages/opencode`:

```powershell
bun test test/server/httpapi-workspace-routing.test.ts --timeout 30000
bun test test/server/httpapi-instance-context.test.ts test/server/httpapi-promptasync-context.test.ts test/server/httpapi-mcp-oauth.test.ts --timeout 30000
bun test test/server/httpapi-session.test.ts --timeout 30000
bun typecheck
```

Expected: all commands exit 0; workspace-routing includes the four new canonical lookup tests, and the session suite remains 44 passing tests unless unrelated upstream tests were added.

- [ ] **Step 8: Run the package and static gates**

Run the complete OpenCode test suite from `packages/opencode`:

```powershell
bun test --timeout 30000
bun typecheck
```

Then run read-only checks from the repository root:

```powershell
git diff --check
rg -n "Session\.Service|@/session/session|@/storage/storage" packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts
git status --short
git diff --name-only
```

Expected: the `rg` command returns no matches; the diff contains only the five files listed in this task plus the pre-existing untracked provider-native tool-search design.

- [ ] **Step 9: Commit only the Phase 1 files**

Stage exactly:

```powershell
git add -- packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts packages/opencode/test/server/httpapi-workspace-routing.test.ts packages/opencode/test/server/httpapi-instance-context.test.ts packages/opencode/test/server/httpapi-promptasync-context.test.ts packages/opencode/test/server/httpapi-mcp-oauth.test.ts
```

Verify:

```powershell
git diff --cached --name-only
git diff --cached --check
git status --short
```

Commit:

```powershell
git -c core.hooksPath=.git/hooks commit -m "refactor(opencode): route sessions through V2 location"
```

The task is complete only when the production middleware has zero legacy Session/storage imports, canonical placement precedence is covered by real HTTP middleware tests, related fixture layers use V2, all required gates pass, and the commit contains only these five files.
