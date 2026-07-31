# Task 1 Implementation Report

Date: 2026-07-31
Task: Add Core durable session_input operations

## Changed Files

- `packages/core/src/session/input.ts`
- `packages/core/src/session.ts`
- `packages/core/test/session-input.test.ts`

## Summary

Implemented the Core durable session-input helpers and the SessionV2 wrappers that later Protocol/Server/App work can call:

- Added session-scoped durable input lookup and pending-input listing.
- Added CAS-style pending input cancellation with explicit outcome reporting.
- Added SessionV2 `pending`, `findInput`, `promoteInput`, and `cancelInput`.
- Made exact input promotion idempotent and race-safe by re-reading the exact row after publish conflicts.
- Prevented terminalized inbox rows from being promoted later by the projector.
- Added integration-style tests using the real Database/EventV2/SessionProjector fixtures.

## Commands Run And Outputs

### Red test

Command:

```text
bun test test/session-input.test.ts
```

Output summary:

- Failed as expected before implementation.
- Missing APIs included `SessionInput.cancelPending`, `SessionInput.findForSession`, `SessionV2.pending`, `SessionV2.promoteInput`, and `SessionV2.cancelInput`.

### Focused green test

Command:

```text
bun test test/session-input.test.ts
```

Output:

```text
7 pass
0 fail
24 expect() calls
```

### Required verification

Command:

```text
bun test test/session-input.test.ts test/session-prompt.test.ts test/session-projector.test.ts
```

Output:

```text
53 pass
0 fail
145 expect() calls
```

Command:

```text
bun typecheck
```

Output:

```text
$ tsgo --noEmit
```

## Test Coverage Added

`packages/core/test/session-input.test.ts` covers:

- pending input listing in admitted order
- delivery filtering for pending inputs
- session-scoped input lookup
- cancel outcome mapping for pending / terminal / promoted / missing
- SessionV2 session validation for pending/findInput
- exact promotion replay returning the same promoted projection
- exact promotion rejecting missing or terminal inputs
- promote/cancel race allowing only one winner

## Self-Review Findings

- Exact promotion uses a deterministic `Prompted` event ID derived from the input ID, then re-reads the exact row after projector/event conflicts so exact retries return the already-promoted projection instead of creating a duplicate visible prompt.
- `SessionInput.cancelPending(...)` only updates rows that are still unpromoted and non-terminal, then reports `cancelled`, `promoted`, `terminal`, or `missing` based on the post-CAS row state.
- `SessionInput.projectPrompted(...)` now also guards on `terminal_outcome IS NULL`, which prevents a cancelled/terminal input from being promoted afterward during replay or races.
- Existing prompt/projector behavior remained green under the required neighboring suites.

## Concerns

- No blocking concerns for Task 1.
- Follow-on tasks should remember that `terminal_seq` records the aggregate sequence at cancellation time and can legitimately be lower than later durable event sequences in the same Session.
