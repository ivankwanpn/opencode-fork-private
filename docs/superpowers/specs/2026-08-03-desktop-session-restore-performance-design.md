# Desktop Project Close and Session Restore Performance

## Status

Approved design for implementation on branch `999.0.5`.

## Goal

Fix the new-layout Desktop project-close failure and remove the startup burst caused
by restoring multiple session tabs, while preserving persisted tabs and fast later
tab switching.

The design must make a stale project removable without changing or archiving its
sessions, and it must move inactive-tab prefetching out of the startup-critical
path rather than removing session restoration entirely.

## Confirmed evidence

### Stale project close

The installed Desktop state contains both `D:\分析` and `D:\agent-comper` in the
local project list. The first path no longer exists and the second does, which is
consistent with a physical folder rename rather than two display names for one
live path.

Clicking Close on the stale entry produced three renderer errors at the matching
interaction times:

```text
Uncaught Error: Stale read from <Show>.
```

`HomeProjectSlot` renders the row through a Solid `<Show>` accessor. During close,
the project store update disposes that row. `HomeProjectRow` then runs cleanup and
recomputes its context-menu ID through `props.project.worktree`, which still points
through the disposed `<Show>` accessor. The exception interrupts the close flow
before it can finish cleanly and persist all close state.

### Restored-tab startup burst

Every persisted session tab mounts a `SessionTabSlot`. Each slot currently:

1. resolves its session through the server;
2. creates a directory sync context; and
3. calls `session.sync(...)` for the full session content.

This happens for every open tab even when the app starts on Home and none of those
tabs is active. The existing performance benchmark explicitly asserts that every
open tab is prefetched. Leaving more tabs open therefore creates more concurrent
session metadata and message requests during startup.

The general project layout also loads session indexes for persisted projects after
mount. That behavior exists in the compared official 1.18.10 source as well and is
not the conditional trigger confirmed by the user's open-tab report, so it remains
outside this change.

## Scope

### In scope

- Make closing a project row safe while its keyed Solid subtree is being disposed.
- Remove the selected persisted project entry immediately and durably.
- Treat path-equivalent stored project entries consistently where the existing
  `pathKey` normalization already considers them equivalent.
- Render restored inactive tabs from persisted tab information without immediately
  loading full session content.
- Load a routed/active session immediately.
- Prefetch inactive sessions after startup through a cancellable, single-concurrency
  idle queue.
- Promote a hovered, focused, or selected tab ahead of background work.
- Add deterministic correctness tests and production-build performance benchmarks.

### Out of scope

- Archiving, deleting, migrating, or rewriting session records.
- Automatically deleting every missing local folder; removable drives and remote
  paths may be temporarily unavailable.
- Detecting that two genuinely different paths are old and new names for the same
  physical folder.
- Changing the session protocol, WebSocket transport, database schema, or server
  APIs.
- Redesigning Electron storage or prompt-history persistence.
- Changing the all-project Home session-index hydration policy in the same patch.
- Adding machine-dependent millisecond pass/fail thresholds.

## Proposed design

### 1. Safe project close

`HomeProjectRow` will capture the immutable row identity needed during cleanup while
the row is still live. Cleanup will use that captured context-menu ID rather than
reading `props.project` after the `<Show>` owner has been disposed.

The visible project object remains reactive for name, icon, color, and other normal
updates. Only the immutable identity used by event cleanup is snapshotted.

The project store will use the same existing `pathKey` identity rule for duplicate
checks and removal. Closing one spelling of a path therefore removes equivalent
slash or trailing-separator spellings instead of leaving a visually duplicate
entry. A physical rename such as `D:\分析` to `D:\agent-comper` remains two distinct
identities; the stale one is removed only when the user closes it.

Closing a selected project clears only the Home project selection. It does not
archive sessions, remove session tabs, delete per-session state, or inspect the
filesystem.

### 2. Startup tab presentation

Persisted `tabs.info` already contains the title and directory needed to draw a
restored session tab. An inactive tab will use that information immediately and
will not require a session or message request merely to appear in the titlebar.

If the current route points to a session, that session bypasses background
scheduling and follows the existing immediate route-loading path. Starting on Home
does not select an active session merely because tabs are present.

If persisted tab information is incomplete, the tab may show the existing loading
or unknown fallback until its metadata turn runs. Missing metadata must not block
other tabs or the Home screen.

### 3. Idle prefetch coordinator

The tab strip, rather than each tab slot independently, will own inactive-tab
prefetch scheduling. This provides one place to enforce ordering, cancellation, and
concurrency.

The coordinator will follow these rules:

1. Active or explicitly selected work has foreground priority and is not placed
   behind background tabs.
2. Inactive restored tabs enter an idle queue only after the initial UI has painted.
3. At most one inactive session performs full synchronization at a time.
4. Each completed item yields back to the browser before another background item
   starts.
5. Pointer hover or keyboard focus promotes that tab to the front of the queue.
6. Clicking a tab navigates immediately; route loading does not wait for the idle
   queue.
7. Closing a tab removes pending work for that tab. Disposing the tab strip cancels
   scheduled idle callbacks and prevents new work.

Use the browser idle callback when available. The fallback must defer work beyond
the initial paint and preserve the same single-concurrency behavior. Background
errors are fail-open: a failed tab does not stop later tabs from being considered.

The existing server-side/session-sync deduplication remains authoritative if a
foreground navigation reaches a session that background prefetch has already
started.

### 4. Session tab ownership

`SessionTabSlot` remains responsible for rendering one tab and remembering newly
resolved title/directory information. It will no longer autonomously start full
message prefetch on mount.

The coordinator owns when a tab may prefetch. The existing session route owns
foreground session loading. This separation prevents a visual titlebar component
from creating unbounded startup data work.

## Data flow

```text
persisted tabs + persisted tabs.info
               |
        render titlebar tabs
          /             \
 routed active tab      inactive restored tabs
        |                       |
 foreground route load      idle coordinator
                                |
                      one session sync at a time
                                |
                  hover/focus may raise priority
```

Project close is independent:

```text
live project row
      |
capture immutable menu identity
      |
user selects Close
      |
remove normalized project identity + finish menu cleanup
      |
persist state without reading the disposed <Show> accessor
```

## Error and edge handling

- A project disappears while its menu is open: cleanup uses captured identity and
  must not read the disposed project accessor.
- Equivalent path spellings exist: close and open use `pathKey` consistently.
- A folder is missing: it remains visible until the user closes it; no automatic
  filesystem cleanup runs.
- A server is unavailable: persisted tab labels remain visible; background work
  skips or fails without blocking startup.
- A session was deleted: metadata resolution may display the existing unknown
  fallback, and the queue continues.
- A tab closes while queued: remove it without starting work.
- A tab closes while synchronization is already running: allow the deduplicated
  request to settle, but do not recreate the tab or schedule follow-up work.
- Idle callbacks are unavailable: use a post-paint fallback with the same
  cancellation and concurrency guarantees.
- The user interacts continuously: foreground work always wins; background
  prefetch may remain deferred.

## Verification plan

### Project close correctness

- Add a regression scenario that opens a project context menu, closes the project,
  and asserts that the row disappears without a `pageerror` or stale-read error.
- Verify a selected project returns Home to server-only selection.
- Verify equivalent path spellings are removed together and do not reopen as
  duplicates.
- Verify a stale, missing path can be closed and remains absent after persisted
  state is reloaded.

### Restore scheduling correctness

- Unit-test queue ordering, single concurrency, promotion, cancellation, failure
  continuation, and idle-callback fallback.
- Verify a routed active session starts immediately.
- Verify inactive restored tabs render from persisted information before session
  content is fetched.
- Verify clicking a not-yet-prefetched tab loads it correctly and does not create a
  duplicate synchronization request.

### Performance benchmark

Replace the benchmark assumption that every tab must prefetch concurrently with a
staged-restore benchmark. Using controlled mock responses and several persisted
tabs, record:

- session metadata request order;
- full message-sync start order;
- maximum concurrent inactive sync count;
- whether any inactive full sync starts before the startup observation point; and
- eventual completion after the idle queue is released.

The benchmark asserts scenario completion and scheduling invariants, then reports
timings and request counts without enforcing machine-specific duration limits.

### Package verification

- Run focused app unit and Playwright regression tests.
- Run the manual performance benchmark against the production app build.
- Run `bun typecheck` from `packages/app`.
- Run the app production build and `git diff --check`.
- Manually verify packaged Desktop startup with zero, one, and multiple persisted
  session tabs, then close the stale `分析` project entry.
