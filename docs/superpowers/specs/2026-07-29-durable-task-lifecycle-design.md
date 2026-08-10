# Durable Task Lifecycle Design

## Goal

Replace the process-local subagent/background lifecycle with a durable task submission protocol that preserves invocation identity, binds each task to its exact child input, delivers parent notifications idempotently, recovers safe work after restart, and cancels the complete ownership tree.

## Current failure boundary

`BackgroundJob` is intentionally process-local. `TaskTool` currently calls `extend` before `start`, and a later `start` with an already-running ID silently discards its run. The V2 task path admits a child input without retaining its ID, resumes the child session, and reads the latest assistant text. Parent completion notification is a scoped fiber and uses a generated synthetic input ID. The existing V2 provider-attempt state machine protects ambiguous provider requests, but it does not model task submission, child-input completion, or parent notification delivery.

## Invariants

1. One `(parentSessionID, assistantMessageID, toolCallID)` identifies one logical task invocation. An exact retry adopts the existing submission; a conflicting retry fails.
2. An accepted child input has one terminal projection at most. A terminal CAS cannot be overwritten by a later success, failure, cancellation, or recovery result.
3. A child terminal transition creates its parent notification outbox record in the same database transaction.
4. A parent notification has one deterministic `session_input` ID. Replaying the outbox is safe and produces one visible synthetic input.
5. Commit completes before execution wake. A crash after commit but before wake leaves durable work that the restart supervisor can discover.
6. `started` and `responding` provider attempts remain recovery-required after restart. The supervisor never guesses that an ambiguous provider request is safe to resend.
7. Cancellation serializes against submission. A descendant committed before cancellation is included in the cancellation tree; a descendant submitted after cancellation is rejected or terminalized as cancelled.
8. Cancellation returns only after every session in the selected ownership tree has been interrupt-requested and its local execution has quiesced.
9. Process-local fibers are wakeup and dispatch mechanisms only. They are never the source of accepted, terminal, delivered, or cancelled state.

## Durable model

### Task submission

Add a `task_submission` table with a unique invocation identity and these durable values:

- parent session, assistant message, and tool call identity;
- child session ID and deterministic child input ID;
- task description, prompt fingerprint, agent and model selection;
- lifecycle status: `accepted`, `running`, `completed`, `error`, `cancelled`, or `recovery-required`;
- terminal outcome, result message ID, error payload, accepted time, and terminal time;
- ownership root/session information needed by cancellation queries.

The submit operation is get-or-create by invocation identity. It validates all immutable fields when an existing identity is reused and returns the original child/input IDs.

### Child input terminal projection

Extend the durable child-input projection with immutable terminal data: outcome, result message ID or result text reference, error, completion time, and terminal event sequence. The terminal write uses a compare-and-set predicate that only permits an unterminalized row to transition.

The runner records the exact input IDs promoted for a child turn. Task completion waits for the submission's child input ID rather than querying the newest assistant message in the child session.

### Notification outbox

Add a durable outbox keyed by submission and parent notification message ID. It stores the exact synthetic prompt payload, delivery state, attempt metadata, and delivery/wake timestamps. The dispatcher:

1. reads pending or not-yet-woken records;
2. calls `admitSynthetic` with the deterministic message ID;
3. treats an equivalent existing input as success and a conflicting existing input as a terminal delivery error;
4. marks admission delivered;
5. calls `execution.wake(parentSessionID)`;
6. records the wake acknowledgement while allowing safe replay if the process dies before that acknowledgement.

The outbox is inserted with the child terminal projection, so a terminal child cannot exist without a recoverable notification record.

### Process-local adapter

Keep `BackgroundJob` for generic process-local work and compatibility, but change its wait result to a discriminated outcome that explicitly distinguishes `missing`, `timedOut`, and terminal information. TaskTool must no longer use the registry as its durable source of truth. Its local execution fiber only invokes the durable submission runner and waits for durable terminal state.

## State and data flow

### Submit

1. Validate parent, agent, permission, and immutable invocation input.
2. Create or adopt the child session.
3. In one transaction, create or adopt the task submission and deterministic child input, while checking cancellation ownership state.
4. Commit and return `accepted` with the submission ID, child session ID, and child input ID.
5. Wake the child session after commit.

If the process dies between steps 4 and 5, restart discovery wakes the accepted input. If two callers submit concurrently, the unique invocation identity returns one submission and no invocation loses its run.

### Child execution and settlement

The child execution coordinator drains durable inputs. It preserves provider-attempt recovery rules and reports the exact input IDs that reached a terminal task outcome. A single terminal transaction CASes the child input and submission, stores the result reference, and inserts the parent outbox row. Repeated settlement observes the existing terminal state and performs no second transition.

### Restart

At startup, the supervisor discovers:

- accepted or promoted task inputs with no terminal projection and no `started`/`responding` provider attempt;
- durable retry and continuation work;
- pending outbox records and records admitted but not yet woken.

It wakes or dispatches these records. Ambiguous provider attempts are surfaced as recovery-required and are not automatically retried.

### Cancellation

`cancelTree(rootSessionID)` executes a durable transaction with a recursive CTE over session ownership. It marks matching submissions and inputs terminally cancelled, marks active provider attempts abandoned, and creates cancellation notifications where the task contract requires a parent result. The transaction returns the exact session IDs to interrupt. After commit, the coordinator interrupts each exact session and waits for local quiescence before returning.

Submission checks the same durable cancellation state inside its transaction, preventing a descendant from escaping through a cancellation race.

## Error handling

- Exact invocation reuse with different immutable input returns a conflict.
- Missing durable submission/input is an explicit `missing` outcome, never an indefinite wait.
- Equivalent outbox replay is successful; payload conflict is surfaced and retained for operator-visible recovery.
- Provider `started`/`responding` remains recovery-required and is never silently converted into a retry.
- Cancellation is terminal and idempotent. Repeated cancellation waits for the same ownership tree without creating duplicate notifications.
- Wake and notification failures are retried by durable discovery; a failed process-local fiber does not lose the work.

## Testing and release gates

Add real implementation tests for:

- concurrent identical submit and exact retry adoption;
- concurrent distinct submissions, including two submissions targeting one resumed child session;
- stale assistant history proving result selection uses child input identity;
- crash after submission commit and before child wake;
- provider started/responding crash and completed-assistant/unfinished-attempt reconciliation;
- terminal settlement CAS, duplicate settlement, and terminal/outbox atomicity;
- parent admission success followed by crash before acknowledgement and idempotent outbox replay;
- missing BackgroundJob wait outcome and direct promotion-wait termination;
- ancestor cancellation racing descendant submission;
- cancellation quiescence across descendants;
- restart recovery proving accepted work does not remain permanently running.

Run the focused Core and OpenCode tests, then package-level `bun typecheck` from each affected package. Existing provider recovery tests remain release gates and must continue to pass.

## Scope boundaries

This design does not auto-retry ambiguous provider requests, introduce remote worker placement, or make generic shell/background jobs durable. Those require separate ownership and recovery contracts.
