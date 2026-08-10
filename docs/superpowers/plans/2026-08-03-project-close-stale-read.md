# Project Close Stale-Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make project identity path-normalized and allow a renamed or missing project to be closed without a Solid stale-read exception, UI freeze, or reappearance after restart.

**Architecture:** Keep the project list as persisted user state; do not probe the filesystem or automatically delete missing directories. Normalize project identity only at the `ServerContext` mutation boundary, and snapshot the row's context-menu identity while its Solid owner is alive so cleanup never reads a disposed `<Show>` accessor.

**Tech Stack:** TypeScript, SolidJS, Bun test with happy-dom, Playwright, localStorage persistence.

---

## Constraints

- Work on branch `999.0.5` in `D:\opencode-bugfix\opencode-fork-private-dev`.
- Preserve project records and sessions; closing a project only removes it from the active project list.
- Treat slash direction and trailing separators as equivalent through the existing `pathKey` helper.
- Do not add filesystem existence checks or automatic stale-project cleanup.
- Run package tests from `packages/app`, never from the repository root.
- Do not restart a running desktop app or server during implementation.

### Task 1: Normalize active-project identity at the server context boundary

**Files:**

- Modify: `packages/app/src/context/server.test.ts`
- Modify: `packages/app/src/context/server.tsx`

- [ ] **Step 1: Add a failing normalized-identity regression test**

Add a test alongside the existing `recentlyClosed` normalization coverage. Exercise the public context API rather than duplicating `pathKey` behavior:

```ts
test("uses normalized path identity for active projects", () => {
  createRoot((dispose) => {
    const [scope] = createSignal(ServerScope.local)
    const [store, setStore] = createStore({ projects: {}, lastProject: {}, recentlyClosed: {} })
    const projects = createServerProjects({ scope, store, setStore })

    projects.open("D:\\repo")
    projects.open("D:/other")
    projects.open("D:/repo/")
    expect(projects.list()).toHaveLength(2)

    projects.collapse("D:/repo/")
    expect(projects.list()[1]?.expanded).toBe(false)

    projects.move("D:/repo/", 0)
    expect(projects.list()[0]?.worktree).toBe("D:\\repo")

    projects.expand("D:\\repo\\")
    expect(projects.list()[0]?.expanded).toBe(true)

    projects.close("D:/repo/")
    expect(projects.list()).toEqual([{ worktree: "D:/other", expanded: true }])
    expect(projects.recentlyClosed()).toEqual(["D:/repo/"])
    dispose()
  })
})
```

Keep the assertions and path spellings unchanged: together they cover deduplicated open, normalized collapse/expand/move, normalized close, and recently-closed behavior.

- [ ] **Step 2: Run the focused unit test and confirm it fails for the intended reason**

Run from `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/context/server.test.ts
```

Expected before the fix: either `open` creates a duplicate project, or `expand`, `collapse`, or `remove` cannot find the equivalent path spelling.

- [ ] **Step 3: Centralize normalized lookup and use it in project mutations**

In `packages/app/src/context/server.tsx`, keep the existing `pathKey` helper and add one local lookup at the project-store boundary:

```ts
const index = (directory: string) => {
  const key = pathKey(directory)
  return current().findIndex((project) => pathKey(project.worktree) === key)
}
```

Apply that identity consistently:

```ts
const remove = (directory: string) => {
  const key = pathKey(directory)
  setStore(
    "projects",
    input.scope(),
    current().filter((project) => pathKey(project.worktree) !== key),
  )
}

const open = (directory: string) => {
  const scope = input.scope()
  const key = pathKey(directory)
  const closed = currentClosed()
  if (closed.some((worktree) => pathKey(worktree) === key)) {
    setStore(
      "recentlyClosed",
      scope,
      closed.filter((worktree) => pathKey(worktree) !== key),
    )
  }
  if (index(directory) !== -1) return
  setStore("projects", scope, [{ worktree: directory, expanded: true }, ...current()])
}
```

Update `expand`, `collapse`, and `move` to use `index(directory)` instead of raw `project.worktree === directory` comparisons. Preserve their existing ordering, guards, and persistence semantics.

Do not add recently-closed state inside `remove`: the existing `close` method remains the only user-close path that calls `remove` and then records history.

- [ ] **Step 4: Re-run the focused test**

```powershell
bun test --preload ./happydom.ts ./src/context/server.test.ts
```

Expected: all tests in `server.test.ts` pass, including the new normalized active-project test.

- [ ] **Step 5: Commit the normalized identity boundary**

```powershell
git add packages/app/src/context/server.tsx packages/app/src/context/server.test.ts
git commit -m "fix(app): normalize project list identity"
```

### Task 2: Prevent disposed project rows from being read during context-menu cleanup

**Files:**

- Create: `packages/app/e2e/regression/home-project-close.spec.ts`
- Modify: `packages/app/src/pages/home/home-projects-view.tsx`

- [ ] **Step 1: Add an end-to-end regression for closing a missing project**

Use `mockOpenCodeServer` from `packages/app/e2e/utils/mock-server.ts`. Seed new-layout settings and a missing Windows project before navigation, capture page errors, select the stale project, and close it from its menu:

```ts
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"

test("closes a missing project without a stale read or persistence rollback", async ({ page }) => {
  const directory = "D:\\opencode-missing-project-e2e"
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  await mockOpenCodeServer(page, {
    project: fixture.project,
    provider: fixture.provider,
    directory: fixture.directory,
    sessions: [],
    pageMessages,
  })

  await page.addInitScript((missing) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: missing, expanded: true }] },
        lastProject: { local: missing },
      }),
    )
    localStorage.setItem(
      "opencode.global.dat:layout",
      JSON.stringify({ home: { selection: { server: "local", directory: missing } } }),
    )
  }, directory)

  await page.goto("/")

  const row = page.locator('[data-component="home-project-row"]', { hasText: "opencode-missing-project-e2e" })
  await expect(row).toBeVisible()
  await row.locator('[data-action="home-project-menu"]').click()
  await page.getByRole("menuitem", { name: /close/i }).click()

  await expect(row).toHaveCount(0)
  expect(errors.filter((message) => message.includes("Stale read"))).toEqual([])

  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem("opencode.global.dat:server") ?? "{}")
        return state.projects?.local ?? []
      }),
    )
    .toEqual([])

  await page.reload()
  await expect(page.locator('[data-component="home-project-row"]', { hasText: "opencode-missing-project-e2e" })).toHaveCount(0)
})
```

Do not change the scenario, storage keys, or stale-read assertion.

- [ ] **Step 2: Run the new Playwright test and confirm the current bug**

Run from `packages/app`:

```powershell
bunx playwright test e2e/regression/home-project-close.spec.ts --workers=1
```

Expected before the view fix: the page-error assertion reports `Stale read from <Show>`, or the row fails to stay removed after the click.

- [ ] **Step 3: Snapshot the menu identity while the row owner is alive**

In `HomeProjectRow` inside `packages/app/src/pages/home/home-projects-view.tsx`, replace the reactive accessor that reads `props.project` during cleanup:

```ts
const contextMenuID = () => projectContextMenuID(props.server, props.project.worktree)
```

with an immutable snapshot:

```ts
const contextMenuID = projectContextMenuID(props.server, props.project.worktree)
```

Replace that row's `contextMenuID()` call sites with `contextMenuID`, including the cleanup registration. Do not cache the whole project object and do not move close behavior out of the controller.

- [ ] **Step 4: Run the regression and focused unit tests**

From `packages/app`:

```powershell
bunx playwright test e2e/regression/home-project-close.spec.ts --workers=1
bun test --preload ./happydom.ts ./src/context/server.test.ts
```

Expected: both commands pass, closing produces no stale-read page error, and the stale entry stays removed after reload.

- [ ] **Step 5: Run package verification**

```powershell
bun typecheck
bun run build
git diff --check
```

Expected: typecheck and production build exit successfully; `git diff --check` prints nothing.

- [ ] **Step 6: Commit the row-lifecycle fix**

```powershell
git add packages/app/src/pages/home/home-projects-view.tsx packages/app/e2e/regression/home-project-close.spec.ts
git commit -m "fix(app): close project menus safely"
```

## Acceptance Checklist

- A missing or renamed project can be closed from Home without freezing the desktop UI.
- No `Stale read from <Show>` error is emitted.
- Equivalent Windows path spellings do not create duplicate active projects.
- The closed project remains absent after reload.
- Existing project and session data on disk is untouched.
