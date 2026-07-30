# CLI Native Client Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the interrupted Phase 8 dual-client wiring for `opencode run` without removing legacy event or loss-sensitive API paths.

**Architecture:** Keep the legacy `OpencodeClient` for event streaming, prompt transport, command/shell/fork/share, and other contracts without native parity. Pass a companion `OpenCode.make(...)` promise client through the same runtime boot context for native session reads, file discovery, permission replies, and question replies. Both clients must share the same base URL, fetch implementation, and attach headers.

**Tech Stack:** TypeScript, Bun 1.3, generated `@opencode-ai/client`, legacy `@opencode-ai/sdk/v2`, Bun test.

## Global Constraints

- Do not delete existing OpenCode data.
- Do not remove the protected V1 runtime or loss-sensitive fallbacks during this slice.
- Run OpenCode tests and typecheck from `D:\agent-admix\opencode-fork\packages\opencode`.
- Do not run tests from the repository root.
- Do not change generated client files directly.
- The checkout has no usable Git metadata, so commit steps are intentionally omitted.

---

### Task 1: Characterize the native runtime boundary

**Files:**

- Modify: `packages/opencode/test/cli/run/runtime.test.ts`
- Test: `packages/opencode/test/cli/run/runtime.test.ts`

**Interfaces:**

- Consumes: `runInteractiveMode(input, deps)` and `OpenCode.make(options)`.
- Produces: a regression test proving native file results are projected to path strings and native permission/question requests receive the active Session ID.

- [x] **Step 1: Add a real generated client backed by a recording fetch**

  Add a test helper that creates `OpenCode.make({ baseUrl, fetch })`, records each `Request`, returns a native file-search envelope for `/api/fs/find`, a native Session for `/api/session/:id`, and `204` for permission/question replies.

- [x] **Step 2: Add the failing runtime-boundary test**

  Run `runInteractiveMode` with the recording native client and a lifecycle test double that invokes:

  ```ts
  await input.findFiles("src")
  await input.onPermissionReply({ requestID: "permission-1", reply: "once" })
  await input.onQuestionReply({ requestID: "question-1", answers: [["yes"]] })
  ```

  Assert that file results equal `["src/index.ts"]` and native reply bodies contain `sessionID: "ses-1"`.

- [x] **Step 3: Verify RED**

  Run:

  ```text
  bun test --timeout 30000 test/cli/run/runtime.test.ts
  ```

  Expected: FAIL because the interrupted implementation returns native file result objects instead of path strings.

### Task 2: Complete the dual-client wiring

**Files:**

- Modify: `packages/opencode/src/cli/cmd/run/types.ts`
- Modify: `packages/opencode/src/cli/cmd/run/runtime.ts`
- Modify: `packages/opencode/src/cli/cmd/run.ts`
- Test: `packages/opencode/test/cli/run/runtime.test.ts`

**Interfaces:**

- Consumes: `NativeClient = ReturnType<typeof OpenCode.make>`.
- Produces: every `BootContext` contains both `sdk` and `native`; native file results are `string[]`; reply callbacks satisfy required native payloads.

- [x] **Step 1: Tighten footer reply types**

  Preserve the legacy request metadata fields while making the UI-produced payload mandatory:

  ```ts
  export type PermissionReply = Omit<Parameters<OpencodeClient["permission"]["reply"]>[0], "reply"> & {
    reply: NonNullable<Parameters<OpencodeClient["permission"]["reply"]>[0]["reply"]>
  }

  export type QuestionReply = Omit<Parameters<OpencodeClient["question"]["reply"]>[0], "answers"> & {
    answers: NonNullable<Parameters<OpencodeClient["question"]["reply"]>[0]["answers"]>
  }
  ```

- [x] **Step 2: Project native file results to paths**

  Change the native `files.find` continuation to:

  ```ts
  .then((result) => result.data.map((entry) => entry.path))
  ```

- [x] **Step 3: Construct the native client in local mode**

  Next to the legacy local client, create:

  ```ts
  const native = OpenCode.make({
    baseUrl: "http://opencode.internal",
    fetch: input.fetch,
  })
  ```

  Include `native` in the local boot result.

- [x] **Step 4: Pass the native client through attach mode**

  Include `native: input.native` in the attach boot result. In `run.ts`, construct the companion native client from `args.attach`, the same `attachHeaders`, and the normal fetch implementation, then pass it to `runInteractiveMode`.

- [x] **Step 5: Verify GREEN**

  Run:

  ```text
  bun test --timeout 30000 test/cli/run/runtime.test.ts
  ```

  Expected: all tests pass.

### Task 3: Verify the completed slice

**Files:**

- Verify: `packages/opencode/src/cli/cmd/run/types.ts`
- Verify: `packages/opencode/src/cli/cmd/run/runtime.ts`
- Verify: `packages/opencode/src/cli/cmd/run.ts`
- Verify: `packages/opencode/test/cli/run/runtime.test.ts`

**Interfaces:**

- Consumes: completed Task 2 wiring.
- Produces: formatted, type-safe CLI runtime with focused regression evidence.

- [x] **Step 1: Format only touched files**

  ```text
  bunx prettier --write src/cli/cmd/run/types.ts src/cli/cmd/run/runtime.ts src/cli/cmd/run.ts test/cli/run/runtime.test.ts
  ```

- [x] **Step 2: Run package typecheck**

  ```text
  bun run typecheck
  ```

  Expected: exit code `0` with no TypeScript errors.

- [x] **Step 3: Run focused CLI tests**

  ```text
  bun test --timeout 30000 test/cli/run/runtime.test.ts test/cli/run/stream.transport.test.ts test/cli/tui/attach.test.ts
  ```

  Expected: all selected tests pass with zero failures.

- [x] **Step 4: Re-scan legacy/native boundaries**

  Confirm that native calls are limited to contracts already migrated and legacy prompt/event/command/shell/fork/share paths remain present.

### Task 4: Close attach transport review gap

**Files:**

- Create: `packages/opencode/src/cli/cmd/run/clients.ts`
- Modify: `packages/opencode/src/cli/cmd/run.ts`
- Create: `packages/opencode/test/cli/run/clients.test.ts`
- Modify: `packages/opencode/test/cli/run/runtime.test.ts`

- [x] **Step 1: Reproduce the attach transport mismatch**

  Confirm that the legacy client creates a timeout-safe fetch when none is supplied while the native client otherwise captures `globalThis.fetch` directly.

- [x] **Step 2: Add the failing attach client boundary test**

  Verify that both clients use the same timeout-safe transport and carry the same attach authentication header.

- [x] **Step 3: Centralize attach client construction**

  Construct both clients together from one base URL, one shared timeout-safe fetch, and one authentication header set.

- [x] **Step 4: Assert native exit-title lookup**

  Record and verify the native `/api/session/:id` request when an interactive resumed session closes.

- [x] **Step 5: Re-run Phase 8 verification**

  Run package typecheck, focused native/transport tests, and the expanded CLI run suite from `packages/opencode`.
