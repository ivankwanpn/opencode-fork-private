# Workspace Instance Store Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Workspace.sessionWarp({ copyChanges: true })` reuse the process-global `InstanceStore.Service` so local workspace operations retain the application graph's `SessionExecution` binding.

**Architecture:** `Workspace.layer` will acquire `InstanceStore.Service` once and close over it in `runInWorkspace`. `Workspace.node` will declare `InstanceStore.node` as a dependency, and the two method-local `AppNodeBuilderV1.build(InstanceStore.node)` compilations will be removed so no detached coordinator/runtime graph is created during a warp.

**Tech Stack:** TypeScript, Bun, Effect, `LayerNode`, OpenCode process-global `InstanceStore`.

## Global Constraints

- Work only in `D:\agent-complete\opencode-fork-private-999.0.15` on branch `999.0.17`.
- Preserve one process-global Session execution ownership chain; do not bind `SessionExecutionLocal` or `SessionExecution.noopLayer` inside `Workspace.sessionWarp`.
- Do not change Session warp behavior, workspace routing, patch transport, fallback values, or public Protocol/HttpApi schemas.
- Do not add V1 fallback behavior or touch retained legacy `message` / `part` data.
- Use the existing real `sessionWarp applies source workspace patch to local target workspace` test as the RED guard; do not add a duplicate structural or mock-only test.
- Run tests and `bun typecheck` from `packages/opencode`, never from the repository root.
- Manually edit files only with `apply_patch`.
- Do not modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`.
- Stage only the production file named in Task 1. The plan document is committed separately before implementation.

---

### Task 1: Reuse the process-global InstanceStore in Session warp

**Files:**
- Modify: `packages/opencode/src/control-plane/workspace.ts`
- Existing test: `packages/opencode/test/control-plane/workspace.test.ts`

**Interfaces:**
- Consumes: the application/test graph's existing `InstanceStore.Service`, provided through `InstanceStore.node`.
- Produces: unchanged `Workspace.Service.sessionWarp(input)` behavior without a method-local layer compilation or a second Session execution ownership graph.

- [ ] **Step 1: Verify the existing behavioral test is RED for the detached graph**

Run from `packages/opencode`:

```powershell
bun test test/control-plane/workspace.test.ts --timeout 30000 -t "sessionWarp applies source workspace patch to local target workspace"
```

Expected: `0 pass`, `1 fail`, with `Unbound layer node: @opencode/v2/SessionExecution` originating from `Workspace.sessionWarp` at the first method-local `AppNodeBuilderV1.build(InstanceStore.node)` call. This is a valid RED because the test already exercises real source diff capture and target patch application.

- [ ] **Step 2: Capture the graph-owned InstanceStore in `Workspace.layer`**

In the service layer generator, acquire the service beside the other long-lived dependencies:

```ts
const instanceStore = yield* InstanceStore.Service
```

In `runInWorkspace`, keep the existing no-workspace and remote branches unchanged. In the local target branch, replace the method-local service lookup with the captured service:

```ts
if (target.type === "local") {
  return yield* instanceStore.provide({ directory: target.directory }, input.local())
}
```

This makes every local workspace operation use the same store and service graph that constructed `Workspace.Service`.

- [ ] **Step 3: Remove detached graph compilation from `sessionWarp`**

Delete the unused import:

```ts
import { AppNodeBuilderV1 } from "@/effect/app-node-builder-v1"
```

Remove only the two wrappers around `runInWorkspace(...)` in the source-patch and target-apply branches:

```ts
.pipe(Effect.provide(AppNodeBuilderV1.build(InstanceStore.node)))
```

Do not alter the callbacks, HTTP requests, patch ordering, or fallback results in either branch.

- [ ] **Step 4: Declare the real layer dependency**

Add `InstanceStore.node` to `Workspace.node.deps`. Keep a single entry and preserve the existing dependency order otherwise:

```ts
deps: [
  Auth.node,
  Session.node,
  SessionRunState.node,
  SessionExecution.node,
  InstanceStore.node,
  // existing dependencies continue unchanged
]
```

The outer production graph remains responsible for binding the unbound `SessionExecution.node`; `Workspace` must not supply a replacement itself.

- [ ] **Step 5: Verify both local and remote copy paths turn GREEN**

Run from `packages/opencode`:

```powershell
bun test test/control-plane/workspace.test.ts --timeout 30000 -t "sessionWarp applies source workspace patch to local target workspace"
bun test test/control-plane/workspace.test.ts --timeout 30000 -t "sessionWarp syncs previous remote history, replays it, steals, and claims the sequence"
```

Expected: both commands exit 0 with one passing test. The first proves local source and target operations use the retained store; the second proves the same ownership fix also covers a remote-history warp whose patch work crosses workspace targets.

- [ ] **Step 6: Run the graph regression set and typecheck**

Run from `packages/opencode`:

```powershell
bun test test/control-plane/workspace.test.ts --timeout 30000
bun test test/project/worktree-remove.test.ts test/project/worktree.test.ts --timeout 30000
bun test test/provider/provider.test.ts test/server/global-session-list.test.ts test/server/httpapi-experimental.test.ts test/server/httpapi-sync.test.ts test/server/session-actions.test.ts test/server/session-diff-missing-patch.test.ts test/server/session-list.test.ts test/server/session-messages.test.ts test/server/session-select.test.ts --timeout 30000
bun typecheck
```

Expected: no command reports `Unbound layer node: @opencode/v2/SessionExecution`. Record any unrelated baseline assertion or timeout separately; do not widen this task to fix it.

- [ ] **Step 7: Run static gates and commit the production fix**

From the repository root, run:

```powershell
git diff --check
rg -n "AppNodeBuilderV1\.build\(InstanceStore\.node\)|yield\* InstanceStore\.Service" packages/opencode/src/control-plane/workspace.ts
git status --short
git diff --name-only
```

Expected: no detached builder call remains; the only `InstanceStore.Service` acquisition is the layer-level captured service. Then stage exactly:

```powershell
git add -- packages/opencode/src/control-plane/workspace.ts
git diff --cached --name-only
git diff --cached --check
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): reuse workspace instance store"
```

The task is complete only when the original RED behavior is green, all graph regression commands have been accounted for, typecheck exits 0, and the commit contains only `packages/opencode/src/control-plane/workspace.ts`.
