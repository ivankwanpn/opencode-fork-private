# Background and Follow-up Lifecycle Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining durable lifecycle gaps that can leave a background subagent or its parent follow-up stuck, duplicated, stale, or escaped from cancellation.

**Architecture:** Keep `TaskSubmission`, `session_input`, `TaskNotification` outbox, and provider-attempt projections as the source of truth. `SessionExecution` remains a process-global Session-ID wake/dispatch coordinator; `BackgroundJob` remains a process-local adapter and is removed from correctness decisions. Hardening is incremental: first make terminal inputs and exact results durable, then repair notification/restart/cancellation boundaries, then remove the redundant `extend()`-before-`start()` path from both task tool implementations.

**Tech Stack:** TypeScript, Bun, Effect, Drizzle SQLite, `bun:test`, V2 `SessionExecution`/`SessionRunner`, legacy OpenCode `TaskPromptOps` compatibility.

## Global Constraints

- The invocation identity is `(parentSessionID, assistantMessageID, toolCallID)` and exact retries must adopt the original durable submission and child input.
- A child result is selected by the exact `childInputID`; no task completion path may use `latestText()` or an unbounded newest-assistant lookup.
- Child terminal projection and parent notification outbox insertion commit in one database transaction.
- `admitSynthetic` uses a deterministic parent message/input ID and treats an equivalent existing input as idempotent success.
- `SessionExecution.wake()` is advisory and is called only after the durable admission commit.
- Provider attempts in `started` or `responding` state are never automatically resent after restart. A durable completed assistant may close the existing attempt without a new request; otherwise the task becomes `recovery-required`.
- Cancellation uses the recursive ownership tree, terminalizes durable inputs before post-commit interruption, and reports completion only after exact-session local execution quiesces.
- Runtime dependencies remain directed Schema -> Core/Protocol -> Server; Client runtime code must not depend on Core or Server.
- Do not edit generated sources directly. If a public Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client`.
- Tests run from package directories, never the repository root. Type checking runs with `bun typecheck` from each affected package directory.
- Use `apply_patch` for edits, follow the existing Effect/Drizzle patterns, avoid `any`, and use snake_case for new Drizzle fields.
- Use the existing branch `lifecycle-hardening`; use conventional commits with the affected scope.

## File and responsibility map

### Core lifecycle files

- `packages/core/src/session/input.ts`: durable prompt admission, promotion, pending discovery, and terminal-input filtering.
- `packages/core/src/session/task-submission.ts`: invocation identity, child input binding, terminal CAS, exact recovery result selection, and task outbox insertion.
- `packages/core/src/session/task-notification.ts`: durable parent follow-up outbox claiming, idempotent admission, wake ordering, and retry state.
- `packages/core/src/session/task-cancellation.ts`: recursive ownership cancellation, attempt abandonment, terminal projection, and post-commit quiescence.
- `packages/core/src/session/execution/local.ts`: startup safe-candidate discovery, ambiguous-attempt reconciliation, and outbox draining.
- `packages/core/src/background-job.ts`: process-local wait/promotion compatibility semantics only.
- `packages/core/src/tool/task.ts`: V2 task execution; durable submission is the source of task identity and result.

### Legacy compatibility files

- `packages/opencode/src/tool/task.ts`: legacy task execution through `TaskPromptOps`; it must use the same durable submission/outbox contract without relying on a local `extend()` race.
- `packages/opencode/src/background/job.ts`: adapter layer whose public types follow the Core `BackgroundJob` interface.

### Tests

- `packages/core/test/session-task-submission.test.ts`: invocation identity, exact child-input recovery, terminal CAS, and transaction rollback behavior.
- `packages/core/test/session-task-notification.test.ts`: deterministic parent admission, replay, conflict, wake ordering, and concurrent drain behavior.
- `packages/core/test/session-task-cancellation.test.ts`: recursive cancellation, provider-attempt abandonment, and submission/cancellation races.
- `packages/core/test/background-job.test.ts`: missing wait outcome, promotion wait termination, and local duplicate-run compatibility.
- `packages/core/test/session-execution-recovery.test.ts`: startup candidate filtering and ambiguous-attempt recovery.
- `packages/opencode/test/tool/task.test.ts`: legacy foreground/background task behavior, local-job loss handling, and durable follow-up delivery.

---

### Task 1: Add failing lifecycle regression tests

**Files:**
- Create: `packages/core/test/session-execution-recovery.test.ts`
- Modify: `packages/core/test/session-task-submission.test.ts`
- Modify: `packages/core/test/session-task-notification.test.ts`
- Modify: `packages/core/test/session-task-cancellation.test.ts`
- Modify: `packages/core/test/background-job.test.ts`
- Modify: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- Consumes the existing `TaskSubmission`, `TaskNotification`, `TaskCancellation`, `SessionExecutionLocal`, and `BackgroundJob` services.
- Produces executable regression tests that define the behavior required by later tasks without introducing test-only lifecycle logic.

- [ ] **Step 1: Add the exact child-input stale-result test**

Create two durable child inputs in one child session, record a completed assistant for the second input, and call recovery for the child session. Assert that the first unresolved submission remains unresolved and only the submission bound to the second input receives the assistant result.

```ts
const first = yield* submissions.submit({ ...base, toolCallID: "call-first", prompt: Prompt.make({ text: "first" }) })
const second = yield* submissions.submit({ ...base, toolCallID: "call-second", prompt: Prompt.make({ text: "second" }) })
const recovered = yield* submissions.recoverSession({ sessionID: childSessionID, messages })
expect(recovered).toBe(1)
expect(yield* submissions.get(first.id)).toMatchObject({ status: "accepted" })
expect(yield* submissions.get(second.id)).toMatchObject({ outcome: "completed", resultText: "second result" })
```

- [ ] **Step 2: Add terminal-input discovery tests**

Admit and terminalize a child input without promoting it, then assert `SessionInput.startupCandidates`, `hasPending`, `promoteSteers`, and `promoteNextQueued` do not return or publish that input.

- [ ] **Step 3: Add the restart and assistant-completion recovery test**

Seed a `session_provider_attempt` row in `responding` state and a completed assistant whose ID is the attempt’s `assistant_message_id`. Run the local startup recovery path and assert the task becomes `completed`, the attempt is not resent, and exactly one notification row exists. Add a second case with no completed assistant and assert `recovery-required` with no provider execution.

- [ ] **Step 4: Add notification crash/replay tests**

Make `admitSynthetic` succeed, make the wake callback fail, and assert the outbox remains replayable. Replay with the same deterministic ID and assert one `session_input` row; replay with a conflicting payload and assert an explicit delivery error.

- [ ] **Step 5: Add cancellation/attempt tests**

Seed a root, child, and grandchild with active provider attempts. Cancel the root and assert all owned submissions/inputs are terminally cancelled, active attempts are abandoned, all exact session IDs are interrupted and waited, and a submission after the cancellation commit is rejected or terminalized cancelled.

- [ ] **Step 6: Add BackgroundJob and legacy task tests**

Assert an unknown `waitForPromotion` completes with a missing outcome instead of waiting forever. Add a legacy task test where the process-local job is absent after durable submission and assert the task returns an explicit lifecycle error rather than a false successful empty result.

- [ ] **Step 7: Run the new tests and record the expected failures**

Run from the package directories:

```powershell
Set-Location packages/core
bun test test/session-task-submission.test.ts test/session-task-notification.test.ts test/session-task-cancellation.test.ts test/session-execution-recovery.test.ts test/background-job.test.ts
Set-Location ../opencode
bun test test/tool/task.test.ts
```

The new stale-result, terminal-input, assistant-completion recovery, cancellation-attempt, promotion-wait, and legacy missing-job assertions are expected to fail before implementation changes.

- [ ] **Step 8: Commit the failing test specification**

```powershell
git add packages/core/test packages/opencode/test/tool/task.test.ts
git commit -m "test(core): cover background lifecycle failures"
```

### Task 2: Stop terminal inputs from re-entering the runner

**Files:**
- Modify: `packages/core/src/session/input.ts`
- Test: `packages/core/test/session-execution-recovery.test.ts`
- Test: `packages/core/test/session-task-cancellation.test.ts`

**Interfaces:**
- Consumes terminal projections already stored on `SessionInputTable`.
- Produces the same `SessionInput` API with terminal rows excluded from pending checks, promotion, and startup recovery discovery.

- [ ] **Step 1: Add `isNull(SessionInputTable.terminal_outcome)` to pending/discovery predicates**

Apply the predicate to `hasPending` and `startupCandidates` so a terminalized input cannot make a session look runnable after restart.

- [ ] **Step 2: Add the same terminal predicate to promotion queries**

Apply it to `promote`, `promoteSteers`, and `promoteNextQueued`. Keep ordering by `admitted_seq` so filtering cancelled work does not change FIFO behavior for remaining inputs.

- [ ] **Step 3: Run the focused Core tests**

```powershell
Set-Location packages/core
bun test test/session-execution-recovery.test.ts test/session-task-cancellation.test.ts
```

Expected: the terminal-input tests pass and no existing session-input lifecycle test regresses.

- [ ] **Step 4: Commit the input lifecycle fix**

```powershell
git add packages/core/src/session/input.ts packages/core/test/session-execution-recovery.test.ts packages/core/test/session-task-cancellation.test.ts
git commit -m "fix(core): exclude terminal inputs from recovery"
```

### Task 3: Make task settlement and recovery use exact input identity

**Files:**
- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/session/attempt.ts`
- Modify: `packages/core/src/session/execution/local.ts`
- Test: `packages/core/test/session-task-submission.test.ts`
- Test: `packages/core/test/session-execution-recovery.test.ts`

**Interfaces:**
- Preserve `TaskSubmission.submit`, `claim`, `terminalize`, and `markRecoveryRequired` signatures.
- Change `RecoveryInput` to require `assistantMessageID: SessionMessage.ID` alongside `sessionID` and `messages`; `SessionExecutionLocal` supplies the projected attempt’s `assistant_message_id`, and tests pass the exact assistant fixture ID. Recovery never infers an assistant from the latest message.

- [ ] **Step 1: Make recovery select the attempt-bound assistant**

Read the child session’s `SessionAttemptTable` projection and use its `assistant_message_id` when reconciling a completed assistant. Validate that the selected assistant belongs to the child session and is complete before settling. Keep the child input ID check so an assistant from another unresolved task cannot settle this submission.

- [ ] **Step 2: Keep terminalization as a single CAS transaction**

Inside the existing database transaction, require both the submission outcome and the child input terminal outcome to be null. If another terminal transition won, return the durable existing `Info`; do not overwrite result text, error, terminal sequence, or result message ID. Insert the notification outbox only after both projections have succeeded.

```ts
const updated = yield* db.update(TaskSubmissionTable)
  .set(terminalProjection)
  .where(and(eq(TaskSubmissionTable.id, input.submissionID), isNull(TaskSubmissionTable.outcome)))
  .returning()
  .get()
```

- [ ] **Step 3: Reconcile completed assistants before marking ambiguous recovery**

In `SessionExecutionLocal`, for each `started`/`responding` recovery candidate, load the child context and call exact recovery first. Mark the task `recovery-required` only when no valid completed assistant was settled. Never call provider execution for this recovery pass.

- [ ] **Step 4: Add the completed-assistant/unfinished-attempt assertion**

Assert that the existing assistant message becomes the task result, `SessionAttemptTable` is not used to issue a second request, and the outbox has one row. Assert the no-assistant case ends in `recovery-required` and never changes to `running` on a second startup pass.

- [ ] **Step 5: Run Core submission and recovery tests**

```powershell
Set-Location packages/core
bun test test/session-task-submission.test.ts test/session-execution-recovery.test.ts
```

- [ ] **Step 6: Commit exact settlement/recovery**

```powershell
git add packages/core/src/session/task-submission.ts packages/core/src/session/attempt.ts packages/core/src/session/execution/local.ts packages/core/test/session-task-submission.test.ts packages/core/test/session-execution-recovery.test.ts
git commit -m "fix(core): settle tasks by exact child input"
```

### Task 4: Harden parent notification outbox replay

**Files:**
- Modify: `packages/core/src/session/task-notification.ts`
- Modify: `packages/core/src/session/command.ts`
- Test: `packages/core/test/session-task-notification.test.ts`

**Interfaces:**
- Preserve `TaskNotification.Interface.drain` and `TaskNotification.Admission`.
- Preserve `SessionCommand.admitSynthetic`; its deterministic ID conflict remains `PromptConflictError` and an equivalent existing row remains success.

- [ ] **Step 1: Make outbox failure updates compare-and-set**

Change `TaskNotification.fail` so a late failure cannot rewrite an already `woken` row to `error`. Only pending/error rows and delivered-but-not-woken rows may become retryable errors.

- [ ] **Step 2: Keep the durable operation order explicit**

Ensure `drain` performs `admitSynthetic`, commits `status: "delivered"`, calls `wake(parentSessionID)`, then commits `status: "woken"`. A wake failure must leave the row delivered with a null `time_woken` or an explicit retryable error, never a completed row without a replay candidate.

- [ ] **Step 3: Verify equivalent and conflicting replay**

Use the deterministic `TaskSubmission.notificationID(submissionID)` in both replay cases. Assert equivalent replay creates one parent `session_input`; conflicting prompt/session/description replay returns an error and preserves the outbox row for operator-visible recovery.

- [ ] **Step 4: Test concurrent drain behavior**

Run two `drain` calls concurrently against one pending row. Assert the database contains one visible parent input and one outbox identity, while allowing duplicate advisory wakes.

- [ ] **Step 5: Run and commit notification changes**

```powershell
Set-Location packages/core
bun test test/session-task-notification.test.ts
git add packages/core/src/session/task-notification.ts packages/core/src/session/command.ts packages/core/test/session-task-notification.test.ts
git commit -m "fix(core): make task notifications replay-safe"
```

### Task 5: Remove the `extend()`-before-`start()` correctness path

**Files:**
- Modify: `packages/core/src/background-job.ts`
- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/opencode/src/tool/task.ts`
- Modify: `packages/opencode/src/background/job.ts`
- Test: `packages/core/test/background-job.test.ts`
- Test: `packages/opencode/test/tool/task.test.ts`

**Interfaces:**
- `BackgroundJob.wait` continues to return `{ info?, timedOut, outcome }` with `outcome: "missing" | "timed-out" | Status`.
- Change `waitForPromotion(id)` to return `Effect<Info | undefined>` so an unknown or already-terminal process-local job cannot wait forever.
- `TaskTool` continues to return the current public task output/metadata shape.

- [ ] **Step 1: Make promotion wait terminate for missing/terminal jobs**

Return `undefined` for a missing or non-running job. Keep background jobs immediately promotable when `metadata.background === true`; keep deferred promotion for foreground jobs that are still running.

- [ ] **Step 2: Make each task invocation call `BackgroundJob.start` once**

Remove the explicit `background.extend()` branch from both task tools. Pass the durable `runTask` effect to one `start({ id: childSessionID, ... })` call. Existing running local jobs are serialized by `BackgroundJob.start`/`extend`, while `TaskSubmission.claim` prevents a duplicate provider turn for an exact invocation.

- [ ] **Step 3: Handle missing/timed-out local observation explicitly**

When a foreground task races `wait` with promotion, handle `outcome: "missing"` and `outcome: "timed-out"` as lifecycle errors. Do not convert `undefined` or a missing local job into a successful empty task result. The durable submission/outbox remains available for restart recovery.

- [ ] **Step 4: Preserve legacy follow-up behavior through the outbox**

Keep the legacy `TaskPromptOps.prompt` adapter only as the delivery mechanism for an already admitted parent synthetic input. It must use the deterministic notification message ID and must not create a second parent prompt when the process-local job or notification fiber is replayed.

- [ ] **Step 5: Run Core and OpenCode task tests**

```powershell
Set-Location packages/core
bun test test/background-job.test.ts test/tool-task.test.ts
Set-Location ../opencode
bun test test/tool/task.test.ts test/background/job.test.ts
```

- [ ] **Step 6: Commit task/background adapter changes**

```powershell
git add packages/core/src/background-job.ts packages/core/src/tool/task.ts packages/opencode/src/tool/task.ts packages/opencode/src/background/job.ts packages/core/test/background-job.test.ts packages/opencode/test/tool/task.test.ts
git commit -m "fix(task): remove background start race"
```

### Task 6: Make restart discovery safe and non-permanent

**Files:**
- Modify: `packages/core/src/session/execution/local.ts`
- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/core/src/session/task-submission.ts`
- Test: `packages/core/test/session-execution-recovery.test.ts`

**Interfaces:**
- Preserve `SessionExecutionLocal.startupCandidates` and `startupRecoveryCandidates` return shapes.
- Startup remains process-local until clustering exists; recovery is driven by durable database rows.

- [ ] **Step 1: Enumerate durable recovery candidates directly**

Use terminal-filtered `session_input`, scheduled continuation/retry rows, and provider-attempt rows. Do not let a terminal input or an already abandoned attempt re-enter the candidate set.

- [ ] **Step 2: Reconcile safe and ambiguous rows in a deterministic order**

First settle valid completed assistants without a new provider call. Then mark unresolved `started`/`responding` task submissions `recovery-required`. Finally wake only safe pending/promoted inputs, explicit durable retry/continuation rows, and pending/unwoken outbox rows.

- [ ] **Step 3: Add restart idempotency assertions**

Run the recovery pass twice. Assert safe work is scheduled once at the durable input boundary, the second pass is a no-op, ambiguous provider attempts remain non-retryable, and no accepted safe input remains permanently `running`.

- [ ] **Step 4: Run and commit restart changes**

```powershell
Set-Location packages/core
bun test test/session-execution-recovery.test.ts test/session-task-submission.test.ts
git add packages/core/src/session/execution/local.ts packages/core/src/session/input.ts packages/core/src/session/task-submission.ts packages/core/test/session-execution-recovery.test.ts
git commit -m "fix(core): make session restart recovery idempotent"
```

### Task 7: Close recursive cancellation and provider-attempt escape races

**Files:**
- Modify: `packages/core/src/session/task-cancellation.ts`
- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/session/attempt.ts`
- Test: `packages/core/test/session-task-cancellation.test.ts`

**Interfaces:**
- Preserve `TaskCancellation.cancelTree({ rootSessionID, interrupt, wait })` and `CancelResult`.
- Preserve `TaskSubmission.Cancelled` for submissions rejected after an ancestor cancellation is durable.

- [ ] **Step 1: Move ownership discovery into the cancellation transaction**

Insert the root cancellation record and compute the recursive ownership CTE within the same durable transaction that selects submissions and inputs. Return the session IDs from that transaction, so descendants committed before the cancellation boundary are included.

- [ ] **Step 2: Terminalize owned inputs and submissions with CAS**

Update only rows with null outcomes. For each successful submission CAS, write the matching child input terminal projection and deterministic cancellation outbox row in the same transaction. A late completion must observe the cancellation and cannot overwrite it.

- [ ] **Step 3: Abandon active provider attempts durably**

Mark `started`, `responding`, `retrying`, and `continuation` attempt projections as `abandoned` for owned sessions in the cancellation transaction. This prevents restart from treating cancellation as safe retry work.

- [ ] **Step 4: Keep post-commit interruption exact and quiescent**

After the transaction commits, call the supplied `interrupt` and `wait` hooks once per returned session ID. Do not hold a database transaction while invoking process-local hooks. Return only after every hook has completed.

- [ ] **Step 5: Test cancellation/submission concurrency**

Run concurrent `cancelTree` and descendant `submit` effects. Accept only these outcomes: the submission is rejected with `TaskSubmission.Cancelled`, or it is durably created and included in the cancellation result. Assert no descendant provider attempt or notification can escape afterward.

- [ ] **Step 6: Run and commit cancellation changes**

```powershell
Set-Location packages/core
bun test test/session-task-cancellation.test.ts test/session-task-submission.test.ts
git add packages/core/src/session/task-cancellation.ts packages/core/src/session/task-submission.ts packages/core/src/session/attempt.ts packages/core/test/session-task-cancellation.test.ts
git commit -m "fix(core): make task cancellation tree durable"
```

### Task 8: Run the complete focused verification set

**Files:**
- Test: `packages/core/test/session-task-submission.test.ts`
- Test: `packages/core/test/session-task-notification.test.ts`
- Test: `packages/core/test/session-task-cancellation.test.ts`
- Test: `packages/core/test/session-execution-recovery.test.ts`
- Test: `packages/core/test/background-job.test.ts`
- Test: `packages/core/test/tool-task.test.ts`
- Test: `packages/opencode/test/tool/task.test.ts`
- Test: `packages/opencode/test/background/job.test.ts`

**Interfaces:**
- No new interfaces; this task verifies the accumulated implementation against the spec’s release gates.

- [ ] **Step 1: Run focused Core tests**

```powershell
Set-Location packages/core
bun test test/session-task-submission.test.ts test/session-task-notification.test.ts test/session-task-cancellation.test.ts test/session-execution-recovery.test.ts test/background-job.test.ts test/tool-task.test.ts
```

- [ ] **Step 2: Run focused OpenCode tests**

```powershell
Set-Location packages/opencode
bun test test/tool/task.test.ts test/background/job.test.ts
```

- [ ] **Step 3: Run package typechecks**

```powershell
Set-Location packages/core
bun typecheck
Set-Location ../opencode
bun typecheck
```

- [ ] **Step 4: Inspect the final diff and status**

```powershell
Set-Location D:/opencode-bugfix/opencode-fork
git diff --check
git status --short --branch
```

The final diff must contain only the lifecycle implementation, its tests, and this plan/spec history; generated files and unrelated working-tree changes remain untouched.

- [ ] **Step 5: Commit the verification record if package fixes were required**

```powershell
git add packages/core packages/opencode
git commit -m "test: verify background follow-up lifecycle"
```
