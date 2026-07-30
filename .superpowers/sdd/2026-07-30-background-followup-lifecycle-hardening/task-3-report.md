# Task 3 Report: Exact assistant/input recovery and transactional idempotent settlement

Date: July 30, 2026
Branch: `lifecycle-hardening`

## Scope completed

Implemented only the Task 3 requirements from `task-3-brief.md`:

- exact assistant-message-bound recovery for task settlement
- startup recovery ordering that prefers exact completed-assistant settlement before `recovery-required`
- test updates for the exact recovery contract and restart non-retryability

I did not modify provider transport or add a new in-memory retry loop.

## Changed files

- `packages/core/src/session/task-submission.ts`
- `packages/core/src/session/execution/local.ts`
- `packages/core/test/session-task-submission.test.ts`
- `packages/core/test/session-execution-recovery.test.ts`

## Implementation summary

### `packages/core/src/session/task-submission.ts`

- Changed `RecoveryInput` to require `assistantMessageID`.
- Updated `recoverSession(...)` to:
  - find the exact assistant by ID
  - require that assistant to be completed
  - choose only the unresolved submission whose `child_input_id` is the nearest preceding input for that assistant
  - settle only that one submission
- Kept terminal settlement flowing through the existing `terminalize(...)` path.

### `packages/core/src/session/execution/local.ts`

- Added a small exact-recovery helper that:
  - loads the durable projected attempt row with `SessionAttempt.get(...)`
  - reads `assistant_message_id`
  - loads projected session context
  - calls `submissions.recoverSession(...)` with the exact assistant ID
- Used that helper:
  - after a normal drain
  - during startup ambiguity reconciliation
- Startup ordering now attempts exact completed-assistant recovery first and only calls `markRecoveryRequired(...)` when nothing was settled.

### Tests

- Updated `session-task-submission` recovery tests to pass the exact assistant fixture ID.
- Extended the no-completed-assistant restart test to run startup recovery twice and verify it stays non-retryable without issuing provider work.

## TDD evidence

I updated the tests first, then ran the required command before production edits.

### Red run

Command:

```powershell
bun test test/session-task-submission.test.ts test/session-execution-recovery.test.ts
```

Result:

- failed `SessionExecution recovery > settles a responding task from an already completed assistant during restart recovery`
- failed `TaskSubmission > binds recovery results to the exact child input instead of the latest completed assistant`
- summary: `10 pass, 2 fail`

Failure highlights:

- completed-assistant restart recovery incorrectly produced `recovery-required`
- stale-result recovery settled `2` submissions instead of `1`

## Verification

Command:

```powershell
bun test test/session-task-submission.test.ts test/session-execution-recovery.test.ts
```

Output:

```text
bun test v1.3.14 (0d9b296a)

test\session-execution-recovery.test.ts:
(pass) SessionExecution recovery > does not rediscover or promote terminal inputs that never reached the runner [81.41ms]
(pass) SessionExecution recovery > settles a responding task from an already completed assistant during restart recovery [49.04ms]
(pass) SessionExecution recovery > marks a responding task as recovery-required when no completed assistant exists [36.21ms]

test\session-task-submission.test.ts:
(pass) TaskSubmission > derives stable IDs from the invocation identity [0.17ms]
(pass) TaskSubmission > changes the child input identity when the tool call changes [0.06ms]
(pass) TaskSubmission > adopts exact retries and terminalizes the child input once [25.72ms]
(pass) TaskSubmission > coalesces concurrent first submissions for one invocation [15.34ms]
(pass) TaskSubmission > rejects a conflicting retry for the same invocation identity [13.97ms]
(pass) TaskSubmission > claims an accepted input at most once [15.21ms]
(pass) TaskSubmission > recovers a completed assistant for the exact child input after a restart [24.78ms]
(pass) TaskSubmission > binds recovery results to the exact child input instead of the latest completed assistant [26.82ms]
(pass) TaskSubmission > terminalizes an ambiguous provider attempt as recovery-required [22.08ms]

 12 pass
 0 fail
 42 expect() calls
Ran 12 tests across 2 files. [1.98s]
```

## Remaining failures outside Task 3

- The Task 7 cancellation-attempt failure mentioned in the brief was not addressed here.
- I did not run the Task 7 cancellation test as part of this task because the brief scoped verification to the two Task 3 core test files above.

## Concerns

- No blocking concerns from the implemented scope.
- The exact recovery binding now assumes the correct durable `assistant_message_id` projection is present on the child session attempt row; if that projection is absent, startup falls through to `recovery-required`, which matches the Task 3 brief.
