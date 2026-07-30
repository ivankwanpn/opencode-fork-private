# Task 4 Report: Harden parent notification outbox replay/failure CAS boundary

## Changed files

- `packages/core/src/session/task-notification.ts`
- `packages/core/test/session-task-notification.test.ts`

## What changed

- Added a CAS predicate to `TaskNotification.fail` so a late failure can only mark rows that are still retryable:
  - `pending`
  - `error`
  - `delivered` with `time_woken IS NULL`
- Added a regression test that reproduces a late wake failure after a second concurrent drain has already completed the wake and woken the row, then asserts the outbox row remains `woken` and the parent input remains singular.

## Commands and outputs

### Red verification

Command:

```powershell
bun test test/session-task-notification.test.ts
```

Output:

- Existing TaskNotification tests passed.
- New regression failed as intended before the fix:
  - expected outbox status `"woken"`
  - received `"error"`

### Green verification

Command:

```powershell
bun test test/session-task-notification.test.ts
```

Output:

- `6 pass`
- `0 fail`
- `35 expect() calls`
- `Ran 6 tests across 1 file`

## Concerns

- Concurrent drains may still issue duplicate advisory wakes by design; the hardening here only prevents a late failure from rewriting an already-woken row into `error`.
- No changes were needed in `SessionCommand.admitSynthetic`; the deterministic replay and conflict behavior already matched the task brief.
