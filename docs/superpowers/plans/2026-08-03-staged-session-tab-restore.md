# Staged Session Tab Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep restored session tabs immediately visible while preventing every inactive tab from loading full session messages concurrently during desktop startup.

**Architecture:** Render inactive restored tabs from persisted `tabs.info`, then feed their existing session synchronization through a small post-paint idle queue with concurrency one. The routed tab remains foreground-owned and loads immediately; hover or keyboard focus promotes an inactive tab, clicking navigates immediately, and the existing per-session sync deduplication resolves foreground/background overlap.

**Tech Stack:** TypeScript, SolidJS, Bun test with happy-dom, Playwright production performance suite, browser `requestIdleCallback` with a post-paint timer fallback.

---

## Constraints

- Work on branch `999.0.5` in `D:\opencode-bugfix\opencode-fork-private-dev`.
- Record the existing production benchmark before changing session-tab behavior.
- Do not change WebSocket transport, session protocol, session storage, or database records.
- Do not change the layout-wide project session-index preload in this patch.
- Do not add machine-dependent millisecond pass/fail thresholds.
- Background failures must be fail-open and must not block navigation or the queue.
- Run package tests from `packages/app`, never from the repository root.
- Run performance tests serially against the production build.
- Do not restart a running desktop app or server during implementation.

### Task 1: Establish the production baseline and build a deterministic prefetch queue

**Files:**

- Create: `packages/app/src/components/titlebar-tab-prefetch.ts`
- Create: `packages/app/src/components/titlebar-tab-prefetch.test.ts`

- [ ] **Step 1: Record the current production benchmark before editing runtime code**

Run from `packages/app`:

```powershell
bunx playwright test --config e2e/performance/playwright.config.ts timeline/session-tab-flash.spec.ts --workers=1
```

Expected: the current benchmark passes and emits `BENCHMARK` records. Preserve the command output in the execution ledger, including the current restored-tab request count and repaint measurements, so Task 3 can compare the new behavior against it.

- [ ] **Step 2: Add deterministic queue tests first**

Create `packages/app/src/components/titlebar-tab-prefetch.test.ts` with an injected scheduler and deferred promises so the tests never depend on wall-clock timing:

```ts
import { describe, expect, test } from "bun:test"
import { createTabPrefetchQueue } from "./titlebar-tab-prefetch"

function createScheduler() {
  const pending: Array<() => void> = []
  return {
    schedule(run: () => void) {
      pending.push(run)
      return () => {
        const index = pending.indexOf(run)
        if (index !== -1) pending.splice(index, 1)
      }
    },
    flush() {
      pending.shift()?.()
    },
    size() {
      return pending.length
    },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

describe("createTabPrefetchQueue", () => {
  test("waits for the scheduler and runs one task at a time", async () => {
    const scheduler = createScheduler()
    const first = deferred()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)

    queue.add("a", async () => {
      order.push("a:start")
      await first.promise
      order.push("a:end")
    })
    queue.add("b", async () => {
      order.push("b")
    })

    expect(order).toEqual([])
    scheduler.flush()
    await Promise.resolve()
    expect(order).toEqual(["a:start"])
    expect(scheduler.size()).toBe(0)

    first.resolve()
    await first.promise
    await Promise.resolve()
    expect(scheduler.size()).toBe(1)
    expect(order).toEqual(["a:start", "a:end"])

    scheduler.flush()
    await Promise.resolve()
    expect(order).toEqual(["a:start", "a:end", "b"])
  })

  test("promotes focused work and removes closed work", async () => {
    const scheduler = createScheduler()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)
    queue.add("a", async () => {
      order.push("a")
    })
    queue.add("b", async () => {
      order.push("b")
    })
    queue.add("c", async () => {
      order.push("c")
    })
    queue.promote("c")
    queue.remove("a")

    scheduler.flush()
    await Promise.resolve()
    expect(order).toEqual(["c"])
    scheduler.flush()
    await Promise.resolve()
    expect(order).toEqual(["c", "b"])
  })

  test("continues after failure and cancels scheduled work on dispose", async () => {
    const scheduler = createScheduler()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)
    queue.add("bad", async () => {
      order.push("bad")
      throw new Error("offline")
    })
    queue.add("good", async () => {
      order.push("good")
    })

    scheduler.flush()
    await Promise.resolve()
    await Promise.resolve()
    scheduler.flush()
    await Promise.resolve()
    expect(order).toEqual(["bad", "good"])

    queue.add("cancelled", async () => {
      order.push("cancelled")
    })
    queue.dispose()
    expect(scheduler.size()).toBe(0)
    expect(order).toEqual(["bad", "good"])
  })
})
```

If Bun requires one additional microtask turn for a `finally` assertion, use `await Promise.resolve()` rather than timers.

- [ ] **Step 3: Run the new unit test and confirm the module is missing**

```powershell
bun test --preload ./happydom.ts ./src/components/titlebar-tab-prefetch.test.ts
```

Expected before implementation: the import fails because `titlebar-tab-prefetch.ts` does not exist.

- [ ] **Step 4: Implement the serial, promotable queue and post-paint idle scheduler**

Create `packages/app/src/components/titlebar-tab-prefetch.ts`:

```ts
export type ScheduleTabPrefetch = (run: () => void) => () => void

type Task = {
  key: string
  run: () => Promise<void>
}

export function createTabPrefetchQueue(schedule: ScheduleTabPrefetch = scheduleTabPrefetch) {
  const pending: Task[] = []
  let running: string | undefined
  let cancel: (() => void) | undefined
  let disposed = false

  const arm = () => {
    if (disposed || running || cancel || pending.length === 0) return
    cancel = schedule(() => {
      cancel = undefined
      const task = pending.shift()
      if (!task) return
      running = task.key
      Promise.resolve()
        .then(task.run)
        .catch(() => undefined)
        .finally(() => {
          running = undefined
          arm()
        })
    })
  }

  return {
    add(key: string, run: () => Promise<void>) {
      if (disposed || running === key || pending.some((task) => task.key === key)) return
      pending.push({ key, run })
      arm()
    },
    promote(key: string) {
      const index = pending.findIndex((task) => task.key === key)
      if (index <= 0) return
      const task = pending.splice(index, 1)[0]
      if (!task) return
      pending.unshift(task)
    },
    remove(key: string) {
      const index = pending.findIndex((task) => task.key === key)
      if (index === -1) return
      pending.splice(index, 1)
      if (pending.length !== 0 || !cancel) return
      cancel()
      cancel = undefined
    },
    dispose() {
      disposed = true
      pending.length = 0
      cancel?.()
      cancel = undefined
    },
  }
}

export function scheduleTabPrefetch(run: () => void) {
  let idle: number | undefined
  let timer: number | undefined
  const frame = window.requestAnimationFrame(() => {
    if (window.requestIdleCallback) {
      idle = window.requestIdleCallback(run)
      return
    }
    timer = window.setTimeout(run, 0)
  })

  return () => {
    window.cancelAnimationFrame(frame)
    if (idle !== undefined) window.cancelIdleCallback(idle)
    if (timer !== undefined) window.clearTimeout(timer)
  }
}
```

Keep the queue independent of Solid and session APIs. Do not add retry, cancellation of already-running work, or a parallelism setting.

- [ ] **Step 5: Run the queue tests and typecheck**

```powershell
bun test --preload ./happydom.ts ./src/components/titlebar-tab-prefetch.test.ts
bun typecheck
```

Expected: the queue tests and app typecheck pass.

- [ ] **Step 6: Commit the queue primitive**

```powershell
git add packages/app/src/components/titlebar-tab-prefetch.ts packages/app/src/components/titlebar-tab-prefetch.test.ts
git commit -m "feat(app): add staged tab prefetch queue"
```

### Task 2: Restore inactive tabs from persisted metadata and load the routed tab immediately

**Files:**

- Create: `packages/app/e2e/utils/idle-callback.ts`
- Create: `packages/app/e2e/regression/restored-session-tab.spec.ts`
- Modify: `packages/app/src/components/titlebar-tab-strip.tsx`

- [ ] **Step 1: Add a controlled idle-callback helper for browser tests**

Create `packages/app/e2e/utils/idle-callback.ts`:

```ts
import type { Page } from "@playwright/test"

export async function holdIdleCallbacks(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, IdleRequestCallback>()
    let next = 0
    window.requestIdleCallback = (callback) => {
      const id = ++next
      callbacks.set(id, callback)
      return id
    }
    window.cancelIdleCallback = (id) => callbacks.delete(id)
    Object.assign(window, {
      __releaseIdleCallback() {
        const entry = callbacks.entries().next().value as [number, IdleRequestCallback] | undefined
        if (!entry) return false
        callbacks.delete(entry[0])
        entry[1]({ didTimeout: false, timeRemaining: () => 50 })
        return true
      },
      __pendingIdleCallbacks() {
        return callbacks.size
      },
    })
  })
}

export function releaseIdleCallback(page: Page) {
  return page.evaluate(() =>
    (window as Window & { __releaseIdleCallback(): boolean }).__releaseIdleCallback(),
  )
}

export function pendingIdleCallbacks(page: Page) {
  return page.evaluate(() =>
    (window as Window & { __pendingIdleCallbacks(): number }).__pendingIdleCallbacks(),
  )
}
```

This override is test-only and must be installed before `page.goto`. It controls the tab-prefetch idle boundary; do not expose a test hook in production code.

- [ ] **Step 2: Add a failing restored-tab regression**

Create `packages/app/e2e/regression/restored-session-tab.spec.ts`. Use the existing timeline fixture and mock helpers, persist two session tabs plus their `tabs.info`, hold idle callbacks, and assert that labels render without session message requests. Then click the second tab and assert its route loads immediately without releasing background idle work:

```ts
import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "../performance/timeline/timeline-test-helpers"
import { holdIdleCallbacks } from "../utils/idle-callback"

test("renders persisted tabs without background messages and foregrounds a clicked tab", async ({ page }) => {
  const requests: string[] = []
  await holdIdleCallbacks(page)
  await mockStressTimeline(page, {
    onMessages: (input) => {
      if (!input.before && input.phase === "start") requests.push(input.sessionID)
    },
  })
  await installStressSessionTabs(page, {
    sessionIDs: [fixture.sourceID, fixture.targetID],
  })
  await installTimelineSettings(page)

  await page.goto("/")
  const source = page.locator(
    `[data-titlebar-tab-slot]:has(a[href="${stressSessionHref(fixture.sourceID)}"])`,
  )
  const target = page.locator(
    `[data-titlebar-tab-slot]:has(a[href="${stressSessionHref(fixture.targetID)}"])`,
  )
  await expect(source.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.sourceTitle)
  await expect(target.locator("[data-titlebar-tab-title]")).toHaveText(fixture.expected.targetTitle)
  expect(requests).toEqual([])

  await target.click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
  await expect.poll(() => requests).toContain(fixture.targetID)
  expect(requests.filter((id) => id === fixture.sourceID)).toHaveLength(0)
})
```

Use the existing titlebar selectors; do not change production markup for this test.

- [ ] **Step 3: Run the regression and confirm eager background loading**

```powershell
bunx playwright test e2e/regression/restored-session-tab.spec.ts --workers=1
```

Expected before integration: inactive restored tabs issue message requests before the held idle callback is released, so `expect(requests).toEqual([])` fails.

- [ ] **Step 4: Create one queue for the strip and dispose it with the strip owner**

In `packages/app/src/components/titlebar-tab-strip.tsx`, import `createSignal`, import the queue, and create it once in `TitlebarTabStrip`:

```ts
import { createTabPrefetchQueue } from "./titlebar-tab-prefetch"

const prefetch = createTabPrefetchQueue()
onCleanup(() => prefetch.dispose())
```

Pass `prefetch` to each `SessionTabSlot`. Remove `createResource` and `createRoot` imports once the old per-tab eager resource is gone.

Type the new slot prop from the factory rather than duplicating the queue shape:

```ts
prefetch: ReturnType<typeof createTabPrefetchQueue>
```

- [ ] **Step 5: Replace eager per-tab loading with persisted rendering and queued synchronization**

Inside `SessionTabSlot`, retain the existing `cachedSession()` lookup and `tabs.info(tabKey)` fallback. Replace the unconditional `createResource`/effect pair with a queued task:

```ts
let alive = true
const [attempted, setAttempted] = createSignal(false)

createEffect(() => {
  const ctx = props.serverCtx()
  props.prefetch.remove(props.id)
  if (props.active()) {
    return
  }
  if (!ctx) return

  props.prefetch.add(props.id, async () => {
    const value = await ctx.sync.session.resolve(props.tab.sessionId).catch(() => undefined)
    if (alive) setAttempted(true)
    if (!value) return
    await ctx.sync.ensureDirSyncContext(value.directory).session.sync(value.id)
  })
})

onCleanup(() => {
  alive = false
  props.prefetch.remove(props.id)
})
```

After removing `loadedSession`, make `session` and missing state derive only from the sync cache and the attempt flag:

```ts
const session = cachedSession
const missingSession = createMemo(() => !!props.serverCtx() && attempted() && !session())
```

Keep the existing effect that records resolved session title/directory and creates tab prompt state when `cachedSession()` becomes available. The attempt flag prevents persisted tabs from flashing as missing before their turn.

Add promotion without loading inline:

```tsx
onPointerEnter={() => props.prefetch.promote(props.id)}
onFocusIn={() => props.prefetch.promote(props.id)}
```

In the `<For>` body, route every navigation path through one synchronous wrapper so mouse activation, keyboard shortcuts, and drag activation all remove queued work first:

```ts
const navigate = (element?: HTMLDivElement) => {
  prefetch.remove(id)
  props.onNavigate(tab, element)
}

useTabShortcut(index, () => navigate(ref))
```

Pass `navigate` through the existing slot callbacks and wrap close as follows:

```tsx
onClose={() => {
  prefetch.remove(id)
  props.onClose(tab)
}}
```

The drag-start handler is outside the `<For>` owner, so remove its selected key directly before its existing navigation call:

```ts
prefetch.remove(tabKey(tab))
props.onNavigate(tab, tabEl ?? undefined)
```

Navigation must return immediately; it must never await queue work. Do not add a second message-fetch path—the route and queued work must both use the existing sync APIs so their in-flight session-ID dedupe remains authoritative.

- [ ] **Step 6: Persist realistic tab metadata in the E2E setup helper**

Update `installStressSessionTabs` in `packages/app/e2e/performance/timeline/timeline-test-helpers.ts` to seed `opencode.window.browser.dat:tabs.info` for every restored tab. Resolve each requested ID against `fixture.sessions` before `addInitScript`, and construct the persisted key exactly like `tabKey`:

```ts
export async function installStressSessionTabs(page: Page, input?: { draftID?: string; sessionIDs?: string[] }) {
  const server = stressServer()
  const sessionIDs = input?.sessionIDs ?? [fixture.sourceID, fixture.targetID]
  const sessions = sessionIDs.flatMap((id) => {
    const session = fixture.sessions.find((item) => item.id === id)
    if (!session) return []
    return [{ id, title: session.title, directory: session.directory }]
  })

  await page.addInitScript(
    ({ directory, sessions, dirBase64, server, serverBase64, draftID }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          ...sessions.map((session) => ({
            type: "session",
            server,
            dirBase64,
            sessionId: session.id,
          })),
          ...(draftID ? [{ type: "draft", draftID, server, directory }] : []),
        ]),
      )
      const info = Object.fromEntries(
        sessions.map((session) => [
          `${server}\n/server/${serverBase64}/session/${session.id}`,
          { title: session.title, directory: session.directory },
        ]),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs.info", JSON.stringify(info))
    },
    {
      directory: fixture.directory,
      sessions,
      dirBase64: base64Encode(fixture.directory),
      server,
      serverBase64: base64Encode(server),
      draftID: input?.draftID,
    },
  )
}
```

Keep the helper's current `{ draftID?: string; sessionIDs?: string[] }` input. Do not fabricate metadata in the production component.

- [ ] **Step 7: Run the queue unit test, restored-tab regression, and typecheck**

```powershell
bun test --preload ./happydom.ts ./src/components/titlebar-tab-prefetch.test.ts
bunx playwright test e2e/regression/restored-session-tab.spec.ts --workers=1
bun typecheck
```

Expected: persisted titles render while idle is held; clicking a tab starts only its foreground session load; all commands pass.

- [ ] **Step 8: Commit the titlebar integration**

```powershell
git add packages/app/src/components/titlebar-tab-strip.tsx packages/app/e2e/utils/idle-callback.ts packages/app/e2e/regression/restored-session-tab.spec.ts packages/app/e2e/performance/timeline/timeline-test-helpers.ts
git commit -m "fix(app): defer inactive session tab loading"
```

### Task 3: Replace the eager-prefetch benchmark with staged-restore acceptance coverage

**Files:**

- Modify: `packages/app/e2e/performance/timeline/session-tab-flash.spec.ts`
- Modify only if required by the fixture callback: `packages/app/e2e/performance/timeline/timeline-test-helpers.ts`

- [ ] **Step 1: Rewrite the eager-prefetch scenario around observable scheduling invariants**

Replace the scenario named `prefetches every open session tab` with `stages restored session tabs after paint with one request in flight`. Keep the cached-tab repaint scenario intact.

The new production-build scenario must:

1. install three persisted tabs with `tabs.info`;
2. hold idle callbacks before navigation;
3. assert all three labels are visible and zero `/message` requests have started;
4. release one idle callback and hold that first message response;
5. assert releasing callbacks cannot start a second message request while the first is in flight;
6. release the first response, then release one idle callback per remaining tab;
7. assert every inactive tab eventually synchronizes and `maxConcurrentMessages === 1`;
8. emit `reportBenchmark` metrics for request count, max concurrency, and requests before the first idle release.

Use deferred response gates rather than timeouts:

```ts
let releaseFirst!: () => void
const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve))
let active = 0
let maxActive = 0
const started: string[] = []

await mockStressTimeline(page, {
  onMessages: (input) => {
    if (input.before) return
    if (input.phase === "start") {
      started.push(input.sessionID)
      active += 1
      maxActive = Math.max(maxActive, active)
      return
    }
    active -= 1
  },
  beforeMessagesResponse: async (input) => {
    if (!input.before && started[0] === input.sessionID) await firstGate
  },
})
```

Extend `mockStressTimeline` with the existing server callback type and forward it; do not implement a second mock server:

```ts
import { mockOpenCodeServer, type MockServerConfig } from "../../utils/mock-server"

input?: {
  onMessages?: MockServerConfig["onMessages"]
  beforeMessagesResponse?: MockServerConfig["beforeMessagesResponse"]
  vcsDiff?: unknown[]
}

// Inside mockOpenCodeServer input:
beforeMessagesResponse: input?.beforeMessagesResponse,
```

Start this scenario at `/` so there is no foreground session request before idle. Release callbacks with `releaseIdleCallback(page)` and poll `pendingIdleCallbacks(page)` instead of sleeping. While the first response is held, `releaseIdleCallback(page)` must return `false`; after `releaseFirst()`, poll until the next idle callback appears before releasing it.

- [ ] **Step 2: Run the production benchmark serially**

```powershell
bunx playwright test --config e2e/performance/playwright.config.ts timeline/session-tab-flash.spec.ts --workers=1
```

Expected: both scenarios pass and emit `BENCHMARK` records. The new staged scenario reports:

- `requestsBeforeIdle: 0`
- `maxConcurrentMessages: 1`
- one eventual request per restored session tab

Compare its repaint metrics with the Task 1 baseline and record the comparison in the execution ledger. Investigate a material repaint regression; do not introduce a machine-specific duration assertion.

- [ ] **Step 3: Run full focused verification**

From `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/components/titlebar-tab-prefetch.test.ts
bunx playwright test e2e/regression/restored-session-tab.spec.ts --workers=1
bun typecheck
bun run build
git diff --check
```

Expected: all unit tests, regressions, typecheck, and production build pass; `git diff --check` prints nothing.

- [ ] **Step 4: Commit benchmark acceptance coverage**

```powershell
git add packages/app/e2e/performance/timeline/session-tab-flash.spec.ts packages/app/e2e/performance/timeline/timeline-test-helpers.ts
git commit -m "test(app): benchmark staged tab restore"
```

Skip the commit only if Task 2 already committed the helper and the benchmark file has no staged change, which should not occur when replacing the eager-prefetch scenario.

## Acceptance Checklist

- Restored tab labels appear immediately from persisted metadata.
- On Home, no inactive restored tab requests messages before its idle turn.
- Background session synchronization has a maximum concurrency of one and yields between tabs.
- Hover and keyboard focus promote pending work.
- Clicking a tab navigates immediately and lets the routed view load it without waiting for idle work.
- Closing a tab removes queued work; disposing the strip cancels scheduled callbacks.
- A failed background load does not block later tabs.
- The existing production repaint benchmark does not materially regress from the recorded baseline.
- No WebSocket, protocol, database, or durable session behavior changes.
