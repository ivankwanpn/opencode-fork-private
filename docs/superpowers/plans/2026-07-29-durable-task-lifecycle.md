# Durable Task Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace process-local subagent/background lifecycle state with durable task submission, exact child-input terminalization, idempotent parent notification, safe restart recovery, and ownership-tree cancellation.

**Architecture:** Add a Core-owned `TaskSubmission` domain backed by SQLite tables and deterministic IDs. TaskTool submits durable work and waits on the child input projection; process-local fibers only wake execution or dispatch outbox records. The V2 provider-attempt recovery state machine remains authoritative for ambiguous provider requests.

**Tech Stack:** Bun, TypeScript, Effect, Drizzle SQLite, EventV2, Bun test.

## Global Constraints

- Keep runtime dependencies directed from Schema to Core and Protocol, then Core and Protocol to Server; Client runtime code must not depend on Core or Server.
- Do not edit generated client files directly. This feature does not change public Protocol or Server `HttpApi`, so `packages/client` generation is not required.
- Use snake_case Drizzle column names and the existing migration generator: `bun script/migration.ts --name durable_task_lifecycle` from `packages/core`.
- Write production code only after a focused failing test has demonstrated the missing behavior.
- Run tests from package directories, never from the repository root; use `bun typecheck`, not direct `tsc`.
- Avoid `any`, unnecessary aliases, and unrelated refactors. The repository has no usable git metadata, so create inspectable patch checkpoints instead of commit commands.

---

### Task 1: Add durable task lifecycle schema

**Files:**
- Create: `packages/core/src/database/migration/20260729120000_durable_task_lifecycle.ts`
- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/database/migration.gen.ts` and `packages/core/src/database/schema.gen.ts` through the migration script
- Test: `packages/core/test/database-migration.test.ts`

**Interfaces:**
- Produces `TaskSubmissionTable`, `TaskNotificationOutboxTable`, and `SessionCancellationTable` Drizzle tables for later tasks.
- Extends `SessionInputTable` with nullable immutable terminal projection fields.

- [ ] **Step 1: Write the failing migration assertions.** Add a database migration test that applies the full migration set and asserts:

```ts
expect(await tableNames(db)).toContain("task_submission")
expect(await tableNames(db)).toContain("task_notification_outbox")
expect(await tableNames(db)).toContain("session_cancellation")
expect(await columns(db, "session_input")).toEqual(
  expect.arrayContaining(["terminal_outcome", "terminal_message_id", "terminal_error", "terminal_time", "terminal_seq"]),
)
```

- [ ] **Step 2: Run the migration test and verify RED.**

Run: `bun test test/database-migration.test.ts` from `packages/core`.

Expected: FAIL because the new tables and terminal columns do not exist.

- [ ] **Step 3: Define the schema.** Add snake_case fields with the following constraints:

```ts
task_submission:
  id primary key
  parent_session_id, assistant_message_id, tool_call_id
  child_session_id, child_input_id
  description, prompt, agent, model
  status, outcome, result_message_id, result_text, error
  time_created, time_completed

task_notification_outbox:
  id primary key
  submission_id, parent_session_id, message_id
  payload, status, attempts, error
  time_created, time_delivered, time_woken

session_cancellation:
  root_session_id primary key
  time_created, time_completed

session_input additions:
  terminal_outcome, terminal_message_id, terminal_error
  terminal_time, terminal_seq
```

Create unique indexes for `(parent_session_id, assistant_message_id, tool_call_id)`, `child_input_id`, and the outbox `message_id`. Add foreign keys to session/input/message tables where the current schema supports them.

- [ ] **Step 4: Generate the migration and schema registry.**

Run: `bun script/migration.ts --name durable_task_lifecycle` from `packages/core`.

Expected: one new migration, updated `migration.gen.ts`, and updated `schema.gen.ts` with no manual generated-file edits.

- [ ] **Step 5: Run the migration test and verify GREEN.**

Run: `bun test test/database-migration.test.ts` from `packages/core`.

Expected: PASS with the new tables and columns present.

- [ ] **Step 6: Inspect the patch checkpoint.**

Run: `git diff --check` if git metadata becomes available; otherwise inspect the changed migration, SQL table definitions, and generated registry directly.

### Task 2: Implement deterministic IDs and TaskSubmission repository

**Files:**
- Create: `packages/core/src/session/task-submission.ts`
- Create: `packages/core/test/session-task-submission.test.ts`
- Modify: `packages/core/src/session/sql.ts` only if the repository needs additional indexes discovered by the tests

**Interfaces:**
- Produces `TaskSubmission.Invocation`, `TaskSubmission.Info`, `TaskSubmission.SubmitResult`, `TaskSubmission.TerminalResult`, and typed conflict/missing errors.
- Produces pure `TaskSubmission.inputID(invocation)` and `TaskSubmission.notificationID(submissionID)` functions.
- Produces database operations `submit`, `get`, `wait`, `terminalize`, `promote`, `cancelTree`, and `startupCandidates`.

- [ ] **Step 1: Write the failing deterministic identity tests.** Test that canonical invocation data always yields the same `msg_` child input ID and notification ID, while changing the tool call or prompt fingerprint changes the ID.

- [ ] **Step 2: Run the focused test and verify RED.**

Run: `bun test test/session-task-submission.test.ts` from `packages/core`.

Expected: FAIL because `TaskSubmission` does not exist.

- [ ] **Step 3: Implement deterministic identity and typed state.** Canonicalize the identity fields in fixed order, hash with the Bun-supported cryptographic API, and retain the required `msg_` prefix. Define status/outcome schemas without `any`.

- [ ] **Step 4: Write the failing submit tests.** Cover:

```ts
const first = yield* TaskSubmission.submit(invocation)
const retry = yield* TaskSubmission.submit(invocation)
expect(retry).toEqual(first)

const conflict = yield* TaskSubmission.submit({ ...invocation, prompt: changedPrompt }).pipe(Effect.flip)
expect(conflict).toBeInstanceOf(TaskSubmission.InvocationConflict)
```

Also run two distinct invocations concurrently against one resumed child and assert both child input IDs remain present.

- [ ] **Step 5: Implement transactional get-or-create.** Use the unique invocation index and `onConflictDoNothing`/read-back pattern. Validate immutable fields on an existing row. Reject submissions whose parent ownership tree has a durable cancellation marker.

- [ ] **Step 6: Write and run the failing terminal CAS tests.** Assert the first terminal transition succeeds, a duplicate transition returns the original terminal result, and a conflicting second outcome cannot overwrite it.

- [ ] **Step 7: Implement terminalization in one transaction.** Update only rows whose terminal fields are null, update the submission status/outcome, and insert exactly one outbox row with the deterministic notification ID before the transaction commits.

- [ ] **Step 8: Run the focused repository tests and inspect the patch.**

Run: `bun test test/session-task-submission.test.ts` from `packages/core`.

Expected: all identity, concurrency, CAS, and transaction tests PASS.

### Task 3: Bind SessionInput and runner completion to exact input IDs

**Files:**
- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/schema/src/session-input.ts`
- Modify: `packages/core/src/session/runner/llm.ts`
- Modify: `packages/core/src/session/runner/index.ts` if the runner result type needs promoted input IDs
- Create or modify: `packages/core/test/session-task-input.test.ts`
- Extend: `packages/core/test/session-runner.test.ts` with exact-input cases

**Interfaces:**
- `SessionInput.Admitted` exposes terminal projection information without changing admission identity.
- `SessionInput.promoteSteers` and `promoteNextQueued` return the promoted input IDs in addition to their existing count behavior, or provide a parallel ID-returning operation used only by the runner.
- `SessionRunner.run` exposes enough completion context for `TaskSubmission` to settle the specific child input.

- [ ] **Step 1: Write a failing stale-result test.** Seed a child session with an older assistant response, admit a new child input, make the runner produce a different response, and assert the task result references the new input's result message rather than the latest arbitrary assistant text.

- [ ] **Step 2: Run the test and verify RED.**

Run: `bun test test/session-task-input.test.ts test/session-runner.test.ts` from `packages/core`.

Expected: the exact-input assertion fails because current TaskTool/runner code does not retain the input identity.

- [ ] **Step 3: Add terminal projection readers and CAS helpers.** Decode terminal outcome, message ID, error, completion time, and sequence from `session_input`; make reads return an explicit missing result when the row does not exist.

- [ ] **Step 4: Return promoted IDs from the runner boundary.** Preserve existing steer/queue ordering and provider-attempt behavior. Do not change the `started/responding` recovery decision logic.

- [ ] **Step 5: Connect child completion to `TaskSubmission.terminalize`.** Use the exact input ID and result message ID; never call `SessionStore.context(...).findLast(...)` to select a task result.

- [ ] **Step 6: Run the exact-input and provider recovery tests.**

Run: `bun test test/session-task-input.test.ts test/session-runner.test.ts` from `packages/core`.

Expected: exact-input tests and existing recovery tests PASS.

### Task 4: Add durable outbox dispatch and restart supervision

**Files:**
- Create: `packages/core/src/session/task-outbox.ts`
- Create: `packages/core/test/session-task-outbox.test.ts`
- Modify: `packages/core/src/session/execution/local.ts`
- Modify: `packages/core/src/session/execution.ts` only if the supervisor needs an explicit internal wake/dispatch boundary
- Modify: `packages/core/src/session/command.ts` to accept deterministic synthetic message IDs in the dispatcher path

**Interfaces:**
- `TaskOutbox.dispatchPending()` admits deterministic synthetic inputs, marks delivery, wakes parents, and records wake acknowledgement.
- `TaskOutbox.startupCandidates()` returns safe child sessions and pending outbox records.

- [ ] **Step 1: Write failing idempotent outbox tests.** Verify that dispatch after a child terminal projection creates one parent input, a second dispatch reuses it, and a payload conflict is not treated as success.

- [ ] **Step 2: Run the test and verify RED.**

Run: `bun test test/session-task-outbox.test.ts` from `packages/core`.

Expected: FAIL because no durable outbox dispatcher exists.

- [ ] **Step 3: Implement deterministic `admitSynthetic` dispatch.** Pass `input.id` from the outbox record, preserve the exact payload, classify equivalent reuse as delivered, and update delivery fields with CAS predicates.

- [ ] **Step 4: Add failure injection tests.** Simulate process loss after outbox admission and before wake, then run dispatch again and assert one visible input plus a later wake.

- [ ] **Step 5: Wire startup supervision.** On `SessionExecutionLocal` initialization, query accepted task inputs, safe retry/continuation rows, and pending/not-yet-woken outbox rows. Fork scoped work only after the durable query returns. Skip `started/responding` attempts.

- [ ] **Step 6: Run outbox and execution recovery tests.**

Run: `bun test test/session-task-outbox.test.ts test/session-execution-forwarding.test.ts test/session-runner.test.ts` from `packages/core`.

Expected: outbox replay is idempotent and provider recovery remains unchanged.

### Task 5: Route both TaskTool implementations through TaskSubmission

**Files:**
- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/core/src/tool/builtins.ts` only if dependency wiring requires it
- Modify: `packages/opencode/src/tool/task.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts`
- Create or extend: `packages/core/test/tool-task.test.ts`
- Extend: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- Core and legacy TaskTool call the same `TaskSubmission.submit`/`wait`/`promote`/`cancelTree` operations.
- Foreground TaskTool returns the terminal result for its submission; background TaskTool returns accepted metadata and relies on the outbox.
- Promotion operates on durable submission IDs/parent ownership rather than process-local job IDs.

- [ ] **Step 1: Write failing TaskTool regression tests.** Add tests for two concurrent first submissions, stale child history, process-local registry loss, deterministic parent notification ID, and a resumed child receiving two distinct inputs.

- [ ] **Step 2: Run Core and OpenCode TaskTool tests and verify RED.**

Run from `packages/core`: `bun test test/tool-task.test.ts`.

Run from `packages/opencode`: `bun test test/tool/task.test.ts`.

Expected: new regression assertions fail against current `extend/start`, latest-text, and fiber notification behavior.

- [ ] **Step 3: Replace Core TaskTool's `latestText` flow.** Build the invocation identity from `context.sessionID`, `context.assistantMessageID`, and `context.toolCallID`; submit the exact prompt; wake after commit; wait for the returned child input terminal projection.

- [ ] **Step 4: Replace legacy TaskTool's `BackgroundJob` orchestration.** Reuse the same durable service and preserve its existing permission/model/variant behavior. Keep abort handling, but cancel the durable submission/tree rather than only an in-memory job.

- [ ] **Step 5: Update promotion endpoint.** Have `sessionBackground` promote durable foreground submissions belonging to the requested parent session and return whether any submission changed state.

- [ ] **Step 6: Run both TaskTool suites and verify GREEN.**

Expected: existing normal-flow assertions and all new concurrency/restart/notification assertions PASS.

### Task 6: Implement durable cancelTree and connect all cancellation entry points

**Files:**
- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/opencode/src/session/run-state.ts`
- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` only if the handler needs to call the durable tree service explicitly
- Create: `packages/core/test/session-task-cancel.test.ts`
- Extend: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- `TaskSubmission.cancelTree(rootSessionID)` returns the durable tree and exact session IDs requiring interrupt.
- V2 `Session.interrupt` and legacy `SessionRunState.cancel` use the same durable cancellation boundary.

- [ ] **Step 1: Write failing cancellation race tests.** Start a descendant submission concurrently with ancestor cancellation; assert either the submission commits before the cancellation tree and is cancelled, or it is rejected/terminalized after the cancellation marker. Assert no descendant remains running after `cancelTree` returns.

- [ ] **Step 2: Run the cancellation tests and verify RED.**

Run: `bun test test/session-task-cancel.test.ts` from `packages/core`.

Expected: current process-local snapshot cancellation permits the race or lacks durable terminal state.

- [ ] **Step 3: Implement the recursive CTE transaction.** Select the root and all descendants, insert/update the cancellation marker, terminalize submissions and inputs with CAS, mark active provider attempts abandoned, and return exact session IDs after commit.

- [ ] **Step 4: Interrupt after commit and await quiescence.** Use `SessionExecution.interrupt` for every returned session ID with unbounded concurrency, then await the local coordinator cleanup before reporting done.

- [ ] **Step 5: Replace snapshot-based legacy cancellation.** Remove the one-time `background.list()` ownership walk from the authoritative path; retain only compatibility cleanup for jobs that have no durable submission.

- [ ] **Step 6: Run cancellation and existing provider-interrupt tests.**

Run from `packages/core`: `bun test test/session-task-cancel.test.ts test/session-runner.test.ts`.

Run from `packages/opencode`: `bun test test/tool/task.test.ts`.

Expected: cancellation is idempotent, descendants cannot escape, and provider interruption still finalizes local tools correctly.

### Task 7: Make BackgroundJob observation explicit and remove indefinite promotion waits

**Files:**
- Modify: `packages/core/src/background-job.ts`
- Modify: `packages/opencode/src/background/job.ts` if the wrapper exposes the result type
- Modify: `packages/core/test/background-job.test.ts`
- Modify: `packages/opencode/test/background/job.test.ts`

**Interfaces:**
- `WaitResult` becomes a discriminated union with `status: "missing" | "running" | "completed" | "error" | "cancelled"` and `timedOut` only for the running timeout case.
- `waitForPromotion` returns an explicit missing/terminal result instead of `Effect.never`.

- [ ] **Step 1: Write failing missing/terminal wait tests.** Assert missing IDs return `missing`, terminal IDs return immediately, and direct promotion waits never hang.

- [ ] **Step 2: Run Core and OpenCode BackgroundJob tests and verify RED.**

Run from `packages/core`: `bun test test/background-job.test.ts`.

Run from `packages/opencode`: `bun test test/background/job.test.ts`.

Expected: current optional-info result and `Effect.never` behavior fail the new assertions.

- [ ] **Step 3: Implement the discriminated results and update consumers.** Preserve existing running/timeout semantics, return missing explicitly, and make terminal promotion waits complete immediately.

- [ ] **Step 4: Run both BackgroundJob suites and verify GREEN.**

Expected: no consumer treats a missing process-local job as a completed task or waits forever.

### Task 8: Run release gates and perform final consistency review

**Files:**
- Modify: affected files only if verification exposes an integration defect
- Test: all focused files from Tasks 1-7

- [ ] **Step 1: Run the complete focused Core suite.**

Run from `packages/core`:

```powershell
bun test test/database-migration.test.ts test/session-task-submission.test.ts test/session-task-input.test.ts test/session-task-outbox.test.ts test/session-task-cancel.test.ts test/background-job.test.ts test/tool-task.test.ts test/session-execution-forwarding.test.ts test/session-runner.test.ts
```

Expected: zero failures and no unhandled fibers.

- [ ] **Step 2: Run the complete focused OpenCode suite.**

Run from `packages/opencode`:

```powershell
bun test test/background/job.test.ts test/tool/task.test.ts
```

Expected: zero failures and no hanging test process.

- [ ] **Step 3: Run package typechecks.**

Run from each affected package directory:

```powershell
bun typecheck
```

Expected: no new errors in changed files. If the known missing TypeScript native preview binary recurs, report it separately from code errors.

- [ ] **Step 4: Run the migration consistency check.**

Run from `packages/core`: `bun script/migration.ts --check`.

Expected: declared schema, snapshot, and migration registry are synchronized.

- [ ] **Step 5: Review the final diff and requirement matrix.** Verify each spec invariant has a test and implementation path, especially commit-before-wake, terminal/outbox atomicity, no ambiguous provider resend, exact-once visible notification, and cancel-tree quiescence.
