# Background and Follow-up Lifecycle Hardening

## Status

Proposed design for review.

This spec narrows the existing durable task lifecycle work to the failure modes that can leave a background task or its parent follow-up apparently stuck. It complements `2026-07-29-durable-task-lifecycle-design.md`; it does not replace that broader design.

## Goal

Make background subagent execution and its parent follow-up reliable across concurrent submission, process restart, provider ambiguity, notification delivery failure, and cancellation races.

The durable database protocol is the source of truth. Process-local fibers, `SessionExecution`, and `BackgroundJob` may wake or execute work, but they must not be the only record of accepted work, completion, delivery, or cancellation.

In this spec, “follow-up” means the durable parent-visible notification generated when a background task reaches a terminal outcome. It is not the separate UI preference for automatically composing another user turn.

## Scope

### In scope

- The `TaskSubmission` admission path and invocation identity.
- Binding a task to its exact child `session_input` ID.
- Durable child terminal projection and compare-and-set settlement.
- Parent notification outbox admission, replay, and wake acknowledgement.
- Restart discovery for safe work and explicit handling of ambiguous provider attempts.
- Durable recursive cancellation and post-commit exact-session interruption.
- Removing `BackgroundJob` ordering from the correctness path.
- Fault-injection and concurrency tests for the release gates below.

### Out of scope

- Remote or clustered worker placement.
- Automatic retry of an ambiguous provider request.
- Making generic shell/background jobs durable.
- A new generic reducer/effect runtime for all agent execution.
- The model catalog refresh and per-model context-window editor.
- Subagent ownership UX beyond the durable cancellation and identity contract needed here.

## Existing boundaries to preserve

The implementation already contains the relevant durable boundaries and should harden them in place:

```text
TaskSubmission + session_input + TaskNotification outbox
                         |
                 SessionExecution
                         |
                   SessionRunner
                         |
              provider attempt / tools
```

- `TaskSubmission` owns durable admission and invocation identity.
- `session_input` owns the exact prompt accepted by a child session and its terminal projection.
- `TaskNotification` owns the parent follow-up outbox.
- `SessionExecution` is process-global and Session-ID based; it coalesces advisory wakes and drains durable work.
- `BackgroundJob` remains a process-local adapter for generic jobs. It cannot determine whether a durable task was accepted or completed.

No new process-local queue is introduced as a substitute for `session_input`. Any in-memory queue used for responsiveness must be reconstructible from durable rows.

## Durable state machines

### Task submission

The invocation identity is the tuple:

```text
(parentSessionID, assistantMessageID, toolCallID)
```

One transaction must create or adopt the submission and its deterministic child input. The transaction records all immutable admission values needed to validate an exact retry, including the child session, child input, task prompt/fingerprint, agent, model selection, and ownership root.

The logical transitions are:

```text
accepted -> running -> completed
                    -> error
                    -> cancelled
                    -> recovery-required
accepted -> cancelled
```

`recovery-required` is a durable stop state. Restart discovery may surface it and notify the caller, but may not silently issue a new provider request. Reusing the same invocation adopts the original IDs only when immutable values match; a conflicting reuse fails explicitly.

### Child input terminal projection

The runner must carry the admitted child input ID through the complete child turn. Completion must use that ID, never `latestText()` or the newest assistant message in the child session.

The child input terminal projection contains, at minimum:

- terminal outcome;
- result assistant message ID or an equivalent durable result reference;
- error information;
- completion timestamp;
- terminal sequence/event value.

The terminal transition is a compare-and-set from a non-terminal row. At most one caller succeeds. A late provider/tool callback, duplicate settlement, or cancellation callback must observe the existing terminal projection and cannot overwrite it.

### Parent follow-up outbox

Child settlement and notification outbox insertion are one database transaction. The outbox stores the exact parent session, deterministic synthetic message/input ID, payload, submission identity, delivery state, attempt metadata, and timestamps.

The conceptual outbox transitions are:

```text
pending -> admitted -> delivered -> woken
             \          \            \
              replayable after any process crash
```

The dispatcher performs these operations in order:

1. Load a pending record or a record that is delivered but not acknowledged as woken.
2. Call deterministic `admitSynthetic` on the parent session.
3. Treat an equivalent existing synthetic input as success; retain a payload/identity conflict as an operator-visible delivery error.
4. Mark admission/delivery durably.
5. Call `SessionExecution.wake(parentSessionID)` after the admission commit.
6. Record the wake acknowledgement. A crash before this write leaves a safe replay candidate.

The synthetic message/input identity is unique and deterministic. Therefore delivery is at-least-once at the dispatcher boundary but exactly-once in the parent’s visible input history.

## Required flows

### Submit

1. Validate parent session, permission, agent, and immutable invocation input.
2. Create or adopt the child session according to the existing session identity rules.
3. In one transaction, check durable cancellation ownership and create/adopt the `TaskSubmission` and deterministic child `session_input`.
4. Commit and return the submission ID, child session ID, and child input ID as the accepted result.
5. Wake the child session only after commit.

If the process dies between steps 4 and 5, restart discovery must find the committed input. Concurrent identical submissions must return the same durable invocation; no caller may create a second child input.

If cancellation committed first, a new submission is rejected or returned as a durable cancelled outcome. If submission wins the transaction race, the same cancellation operation must include the newly committed descendant.

### Child execution and settlement

The child coordinator promotes only eligible durable inputs and passes the exact input ID to the runner. The runner reloads projected history before a continuation and performs one explicit provider stream per provider turn.

When the child reaches a terminal task outcome, one transaction:

1. CASes the child input terminal projection;
2. CASes the submission status/result projection;
3. inserts the parent notification outbox record with its deterministic ID.

If any part fails, the transaction rolls back and the input remains discoverable. A repeated settlement returns the existing terminal state and does not create a second visible result.

If a durable assistant completion exists while its provider attempt is not yet ended, the reconciler may close that attempt and settle from the already-recorded assistant completion. It must not start another provider request. Without a valid durable completion, a `started` or `responding` attempt becomes `recovery-required`.

### Restart

On startup, the supervisor discovers and wakes or dispatches:

- accepted/promoted inputs that have no terminal projection and no ambiguous provider attempt;
- durable continuation/retry records whose retry contract is explicit;
- pending outbox rows;
- admitted/delivered outbox rows whose parent wake was not acknowledged.

It must not guess that a provider request is safe to resend. `started` and `responding` attempts are reconciled to `recovery-required`, unless an already-recorded valid assistant completion closes the attempt without a new request.

The recovery pass is idempotent and must leave no accepted input permanently in an unexamined `running` state: it either schedules safe work, reaches a terminal outcome, or records `recovery-required`.

### Cancellation

`cancelTree(rootSessionID)` performs a durable transaction using the session ownership tree, including recursive descendants. It:

- marks matching inputs and submissions terminally cancelled;
- marks active provider attempts abandoned;
- creates any required cancellation follow-up outbox records;
- returns the exact session IDs whose local execution must be interrupted.

After commit, the coordinator calls `interrupt(sessionID)` for each returned ID and waits for local execution quiescence before reporting cancellation complete. `done` cannot be reported while an owned descendant can still produce a new provider turn, tool execution, or parent notification.

Late completion, wake, and submit callbacks are checked against the durable terminal/cancellation CAS and become no-ops or explicit conflicts.

## BackgroundJob compatibility contract

`BackgroundJob` is a process-local convenience layer only.

- Task correctness must not depend on `extend()` followed by `start()`.
- A running local job must not cause a later durable `run` to be silently discarded.
- `wait()` must return a discriminated `missing` outcome immediately for an unknown ID, and must distinguish it from timeout and terminal status.
- Task follow-up waiting must observe the durable child input/submission terminal projection, not only the local registry.
- Local fibers may be restarted or lost without losing a committed submission or notification.

## Failure-injection release gates

Tests must exercise the real implementation at these boundaries:

1. Two concurrent first submits with the same invocation identity.
2. Submit commit succeeds, then the process dies before `wake()`.
3. Provider attempt is `started` or `responding` when the process dies.
4. Assistant completion is durable but the provider attempt end record is missing.
5. Child terminal CAS and outbox insertion fail or are retried midway.
6. Parent synthetic admission commits, then the process dies before delivery/wake acknowledgement.
7. Outbox replay encounters an equivalent existing input and a conflicting existing input.
8. Unknown `BackgroundJob` ID and direct durable promotion wait.
9. Ancestor cancellation races a descendant submission.
10. Cancellation waits for all descendant local executions to quiesce.
11. Restart recovery proves no accepted safe input remains permanently `running` and no ambiguous provider request is resent.

The assertions are:

- every accepted child input is executed at most once by the durable admission protocol;
- no result is selected from stale assistant history;
- no terminal child exists without a recoverable parent outbox record;
- each parent visible synthetic notification appears exactly once;
- ambiguous provider requests are never automatically resent;
- cancellation cannot be escaped by a descendant;
- restart leaves no safe accepted work permanently stuck in `running`.

## Implementation slices

Implementation should proceed in this order after approval:

1. Add failing tests around the existing `TaskTool`/`TaskSubmission` boundaries, especially the `BackgroundJob` compatibility path and exact child input identity.
2. Close admission and child-input identity gaps without changing the public task tool shape.
3. Make child terminal settlement and parent outbox insertion one durable transaction and make replay conflict-aware.
4. Harden startup recovery and outbox draining around commit-before-wake and ambiguous provider attempts.
5. Harden recursive cancellation and post-commit quiescence.
6. Run focused Core/OpenCode tests and package-level `bun typecheck` from each affected package.

Model catalog refresh, per-model context editing, and broader subagent ownership UX remain separate follow-up work after this lifecycle foundation is verified.
