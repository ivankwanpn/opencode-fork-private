# Session Execution Test Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore deterministic compilation of OpenCode test graphs that directly include the intentionally unbound V2 `SessionExecution.node` but do not exercise model execution.

**Architecture:** Each affected top-level test graph will explicitly replace `SessionExecution.node` with `SessionExecution.noopLayer`. The replacement stays local to the graph that needs it; production graphs, shared instance fixtures, and tests that already bind execution remain unchanged.

**Tech Stack:** TypeScript, Bun test, Effect `LayerNode`/`AppNodeBuilder`, canonical `SessionExecution`.

## Global Constraints

- Work only in `D:\agent-complete\opencode-fork-private-999.0.15` on branch `999.0.17`.
- This is test infrastructure only; do not modify production code or public Protocol/HttpApi schemas.
- Bind `SessionExecution.noopLayer` only in test graphs that do not test provider-turn execution or process-local coordinator behavior.
- Do not alter `test/session/instruction.test.ts`; its focused run already passes 9 tests with 1 todo and has no unbound graph defect.
- Do not modify the shared `testInstanceStoreLayer`; the required binding must remain visible at each affected graph root.
- Do not add V1 fallback behavior or touch retained legacy `message` / `part` data.
- Run tests and `bun typecheck` from `packages/opencode`, never from the repository root.
- Manually edit files only with `apply_patch`.
- Do not modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`.
- Stage only the twelve test files named in Task 1.

---

### Task 1: Bind recording-only Session execution in isolated test graphs

**Files:**
- Modify: `packages/opencode/test/project/worktree-remove.test.ts`
- Modify: `packages/opencode/test/project/worktree.test.ts`
- Modify: `packages/opencode/test/provider/provider.test.ts`
- Modify: `packages/opencode/test/server/global-session-list.test.ts`
- Modify: `packages/opencode/test/server/httpapi-experimental.test.ts`
- Modify: `packages/opencode/test/server/httpapi-sync.test.ts`
- Modify: `packages/opencode/test/server/session-actions.test.ts`
- Modify: `packages/opencode/test/server/session-diff-missing-patch.test.ts`
- Modify: `packages/opencode/test/server/session-list.test.ts`
- Modify: `packages/opencode/test/server/session-messages.test.ts`
- Modify: `packages/opencode/test/server/session-select.test.ts`
- Modify: `packages/opencode/test/tool/plugin-compat-v2.test.ts`

**Interfaces:**
- Consumes: `SessionExecution.node` and the recording-only `SessionExecution.noopLayer` from `@opencode-ai/core/session/execution`.
- Produces: test-only root graphs that compile explicitly without constructing a local runner/coordinator and without changing the services under test.

- [ ] **Step 1: Verify deterministic RED at graph construction**

Run from `packages/opencode`:

```powershell
bun test test/project/worktree-remove.test.ts test/project/worktree.test.ts --timeout 30000
bun test test/provider/provider.test.ts test/server/global-session-list.test.ts test/server/httpapi-experimental.test.ts test/server/httpapi-sync.test.ts --timeout 30000
bun test test/server/session-actions.test.ts test/server/session-diff-missing-patch.test.ts test/server/session-list.test.ts test/server/session-messages.test.ts test/server/session-select.test.ts test/tool/plugin-compat-v2.test.ts --timeout 30000
```

Expected RED: all twelve files fail during module-load graph compilation with `Unbound layer node: @opencode/v2/SessionExecution`, before the affected tests execute. A different failure must be recorded separately and must not be hidden by this task.

- [ ] **Step 2: Add explicit imports in the twelve failing files**

Add the same direct Core import to each file named by this task, following its existing Core import grouping:

```ts
import { SessionExecution } from "@opencode-ai/core/session/execution"
```

Do not add this import to `test/session/instruction.test.ts`, which is already green.

- [ ] **Step 3: Bind the two worktree roots and the provider instance-store root**

In `worktree-remove.test.ts` and `worktree.test.ts`, extend the existing replacement list beside `InstanceStore.bootstrapNode` and `locationServiceMapReplacement`:

```ts
[SessionExecution.node, SessionExecution.noopLayer],
```

In `provider/provider.test.ts`, add the same replacement only to `instanceStoreLayer` near line 1943:

```ts
const instanceStoreLayer = LayerNode.compile(InstanceStore.node, [
  [InstanceStore.bootstrapNode, InstanceBootstrap.node],
  [SessionExecution.node, SessionExecution.noopLayer],
  locationServiceMapReplacement,
])
```

Do not add it to the earlier provider graph builders whose `locationServiceMapReplacement` already prevents this unbound dependency from being reached.

- [ ] **Step 4: Bind the legacy Session HTTP/read test roots**

For `global-session-list.test.ts`, `httpapi-experimental.test.ts`, `httpapi-sync.test.ts`, `session-actions.test.ts`, `session-diff-missing-patch.test.ts`, `session-messages.test.ts`, and `session-select.test.ts`, pass this replacement to the existing `LayerNode.compile(...)` call:

```ts
[[SessionExecution.node, SessionExecution.noopLayer]]
```

Preserve each file's existing `Layer.mergeAll(..., httpApiLayer)` shape and every existing replacement. For `session-list.test.ts`, append the replacement to the existing `AppNodeBuilder.build(...)` replacement list after `RuntimeFlags.node`:

```ts
[
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces })],
  [SessionExecution.node, SessionExecution.noopLayer],
]
```

These tests use Session CRUD/read behavior only. The noop layer supplies durable recording compatibility without starting model execution.

- [ ] **Step 5: Bind only the plugin parity harness**

In `tool/plugin-compat-v2.test.ts`, add the replacement only to `parityHarness()`'s `LayerNode.compile(...)` replacement list:

```ts
[SessionExecution.node, SessionExecution.noopLayer],
```

Leave `harness()` unchanged: its focused `LocationServiceMap` replacement already compiles, and widening both harnesses would obscure which graph owns the dependency.

- [ ] **Step 6: Verify each repaired graph reaches its real tests**

Run the same three commands from Step 1. Expected: no command reports `Unbound layer node: @opencode/v2/SessionExecution`. Tests must reach their actual assertions; record unrelated runtime/assertion failures without widening this task.

Then verify the known unaffected file remains green:

```powershell
bun test test/session/instruction.test.ts --timeout 30000
```

Expected: 9 pass, 0 fail, 1 todo.

- [ ] **Step 7: Run focused graph regressions and typecheck**

From `packages/opencode`, run:

```powershell
bun test test/control-plane/workspace.test.ts --timeout 30000 -t "sessionWarp applies source workspace patch to local target workspace"
bun test test/control-plane/workspace.test.ts --timeout 30000 -t "sessionWarp syncs previous remote history, replays it, steals, and claims the sequence"
bun typecheck
```

Expected: both Session warp tests pass 1/1 and `bun typecheck` exits 0.

- [ ] **Step 8: Run static and staged-file gates**

From the repository root:

```powershell
git diff --check
git status --short
git diff --name-only
```

Verify the tracked diff contains exactly the twelve test files in this task. Stage those paths explicitly, then run:

```powershell
git diff --cached --name-only
git diff --cached --check
```

The untracked provider-native tool-search design must remain unstaged.

- [ ] **Step 9: Commit the fixture repair**

Commit with:

```powershell
git -c core.hooksPath=.git/hooks commit -m "test(opencode): bind V2 session execution"
```

The task is complete only when all twelve graphs no longer fail at module-load compilation, actual test outcomes are accounted for, the unaffected instruction suite remains green, both Workspace warp regressions remain green, typecheck exits 0, and the commit contains only the named test files.
