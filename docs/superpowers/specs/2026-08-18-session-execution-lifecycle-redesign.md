# V2 Session Execution Lifecycle Redesign

## Status

Implemented in the `999.0.18` working tree after the production failure investigation on 2026-08-18.

The implemented tranche covers centralized drain finalization, deterministic orphan reconciliation, reliable detached interruption, explicit compaction/retry transitions, synthetic notification turn ownership, exact-ID conflict retry, active execution activity snapshots, timeline phase labels, and streaming Markdown tail finalization. Clustered execution ownership and the official worker-hosted Markdown parser remain separate follow-up work.

## Goal

Make V2 Session execution recoverable and internally consistent across normal completion, provider failure, tool waits, user interruption, process restart, compaction, steering, queued input, and synthetic task notifications.

The redesign must eliminate states where the UI reports idle while a durable turn or provider attempt remains open. A new user prompt must never be silently admitted into work that the runner can no longer execute.

## Production Evidence

The affected Session retained all of these states at once:

```text
session_turn.status       = active
session_turn.turn_id      = msg_task_notification_*
session_attempt.status    = responding
assistant.time.completed  = null
question tool             = error: Tool execution interrupted
process-local drain       = absent
```

The event log contained `ProviderAttempt.Started` and `ProviderAttempt.ResponseStarted`, followed by an interrupted question tool and a live `idle` notification. It did not contain `ProviderAttempt.Ended` or `Turn.Ended`.

Later prompts were durably admitted and some were promoted. Every successor drain then rejected the stale `responding` attempt with `RecoveryRequiredError`, while the coordinator again published `idle`. This produced the visible `busy -> idle` loop with no provider request.

Automatic compaction was not the direct orphaning event in this Session. Each compaction had a terminal `Ended` event. The long-running appearance came from as many as 24 provider attempts continuing inside one turn after compaction while the UI exposed only a generic busy state.

## Reference Designs

### Codex 0.147

Codex centralizes lifecycle ownership at the task spawn boundary:

- every task runs under one owner;
- normal completion is finalized by `on_task_finished`;
- interruption is finalized by `handle_task_abort`;
- terminal `TurnComplete` or `TurnAborted` publication is the owner's responsibility;
- thread idle is emitted only after the active task identity is cleared;
- explicit steer validates the expected active turn identity;
- compact is a distinct task kind and cannot be steered as a regular turn.

The useful design is the centralized owner and finalizer. The Rust task runtime and in-memory transcript model are not copied into V2.

### DeepSeek Harness

DeepSeek enforces a balanced durable event grammar:

```text
turn/start
  step/start
    assistant/tool events
  step/end
turn/end { reason }
```

Its deterministic crash repair closes unresolved tool calls, then an open step, then the open turn. Compaction has explicit start/summary/end markers and an inspectable request purpose. Follow-up and steer target different inbox boundaries.

The useful design is the invariant plus deterministic repair. Its plugin runtime and complete agent loop are not copied into V2.

## Design Decision

Keep the existing V2 durable Session, input, attempt, task submission, and event projection model. Rebuild the execution boundary around it.

Do not replace V2 with the Codex or DeepSeek runtime. Do not bridge back through the V1 loop. The target is one V2 owner/finalizer/reconciler that gives the current data model the lifecycle guarantees those systems already enforce.

## Required Invariants

1. Every committed `ProviderAttempt.Started` reaches exactly one terminal state: ended, interrupted, failed, abandoned, or an explicit retry transition.
2. Every committed `Turn.Started` reaches exactly one `Turn.Ended` with a terminal outcome.
3. An open provider attempt always belongs to an open turn.
4. A provider request is never automatically replayed after ownership becomes ambiguous.
5. Repair may abandon an ambiguous request and continue from a new human input. Abandonment is not a retry.
6. A synthetic Session notification may trigger work but may not reuse its message ID as the human turn identity.
7. `idle` is derived only after durable attempt and turn settlement. A coordinator finalizer may not publish idle unconditionally.
8. A pending human prompt remains durable across restart. Repair must not lose it merely to close an orphan turn.
9. Compaction has a terminal event on success, failure, and interruption, and its phase is observable independently from ordinary generation.
10. Frontend routing uses the authoritative execution snapshot. Visual busy state is never the authority for start versus steer.

## Durable State Model

### Turn

```text
pending -> active -> ended(completed)
                  -> ended(interrupted)
                  -> ended(failed)
                  -> ended(abandoned)
```

`Turn.Ended` carries an outcome. Completed turns still reject unresolved turn-scoped steer inputs. Abnormal settlement may close the old turn while preserving later durable human input for a successor turn.

### Provider attempt

```text
started -> responding -> ended(completed | failed | interrupted | abandoned)
                     -> retrying -> started(retryOf)
                     -> continuation
```

`started` or `responding` without a live owner is ambiguous. Reconciliation first accepts a fully durable completed assistant as proof of completion. Otherwise it closes unsettled tools and the assistant, then records `abandoned`. It never calls the provider.

### Execution snapshot

The server exposes one authoritative snapshot derived from durable projections plus current process ownership:

```text
idle
pending(turnID)
running(turnID, phase)
retrying(turnID, attemptID, next)
recovery-required(turnID, attemptID, reason)
```

Initial phases are:

```text
compacting
dispatching
responding
running-tool
waiting-user
```

The phase can be refined later without changing start/steer semantics.

## Execution Owner

`SessionExecutionLocal` remains the process-global, Session-ID coordinator. It becomes the only owner of drain finalization.

For each drain it must:

1. publish or derive running state;
2. invoke the Location-scoped runner;
3. capture the runner exit;
4. reconcile the active provider attempt;
5. settle the turn according to the exit and interruption cutoff;
6. drain terminal task notifications and bounded maintenance;
7. publish the state derived after settlement;
8. allow the coordinator to schedule a successor only after finalization completes.

Runner code remains responsible for the normal happy-path events and exact provider/tool data. The owner finalizer is the safety net for every exit path.

## Attempt Finalization

The provider-attempt region also has a local finalizer. Once `ProviderAttempt.Started` commits, leaving that region without an explicit retry or terminal attempt event publishes a conservative terminal event:

- interruption-only exit: `interrupted`;
- other failure or defect: `failed` while the process still owns the operation;
- restart reconciliation with no live owner: `abandoned`.

Before the attempt ends, any pending/running tool is failed and an incomplete assistant step receives `Step.Failed`. The finalizer does not overwrite an already terminal assistant or attempt.

## Crash And Restart Reconciliation

At startup, and before admitting a new explicit start into an inactive Session:

1. Load the projected attempt and turn.
2. If an active attempt has a completed assistant and no unresolved tools, publish the missing attempt end from that durable proof.
3. Otherwise close unresolved tools and the assistant, then publish `ProviderAttempt.Ended { outcome: abandoned }`.
4. Close the orphan turn as abandoned without replaying provider work.
5. Preserve eligible pending human input so the next drain can create a new turn.
6. Keep task-submission recovery atomic with its existing child terminal projection and parent outbox.
7. Wake only safe pending input, explicit retry/continuation, and notification work.

This changes the previous implementation detail that left non-task attempts permanently `recovery-required`. The safety property remains: the ambiguous provider request is not retried. The usability improvement is that the abandoned attempt no longer blocks all future prompts.

## Follow-up Admission

The client has three explicit operations:

- start: open a new turn when the authoritative snapshot is idle;
- steer: add input to the named active regular turn;
- queue: keep input for a later turn boundary.

On a start conflict, the client refreshes the execution snapshot once:

- if the refreshed snapshot is active and steerable, preserve the draft and report the conflict rather than changing semantics silently;
- if reconciliation made it idle, retry the same start once with the same message ID;
- otherwise preserve the draft and expose the recovery state.

Normal Enter after a completed answer is start. A user-selected Steer remains steer and never silently becomes start. Queue remains queue.

## Synthetic Task Notifications

A task notification is Session-scoped synthetic input. It may:

- join the currently active regular turn at a safe boundary; or
- wake an idle Session and open an internal turn with a distinct turn ID.

It may not make `msg_task_notification_*` the turn owner. Human start identity and synthetic wake identity remain separate.

## Compaction

Compaction remains a direct provider request with its existing durable markers, but it is no longer represented by recursive defects in the runner.

The runner uses an explicit transition result:

```text
settled
retry-provider
continue-after-compaction
continue-after-overflow-compaction
```

An iterative driver handles those results. One overflow recovery is allowed per provider attempt path. Compaction failure or interruption always reaches `Compaction.Failed`; outer turn finalization still runs.

Manual compaction is exclusive maintenance. Automatic compaction is turn-owned and occurs at a safe provider boundary. Both expose the compacting phase.

## UI Contract

The UI must stop combining unrelated local facts into lifecycle truth.

- The execution snapshot owns start/steer routing and the primary phase label.
- Live events refine the snapshot optimistically but reconnect replaces them with server truth.
- `idle` cannot clear a durable active/recovery identity unless the refreshed snapshot agrees.
- A turn conflict triggers one snapshot refresh and at most one exact-ID retry.
- Failed submission preserves the draft.
- Compaction, generation, tool execution, and user wait use distinct labels instead of one indefinite thinking state.

## Markdown Boundary

Markdown streaming is a separate projection concern. The same assistant text block identity must be reused from first delta through settled text. Streaming and settled renderers must produce equivalent DOM for the same final source.

The lifecycle redesign must not use Markdown remounts as a way to hide or clear stale execution state. Dedicated tests cover partial fences, lists, tail replacement, message completion, reconnect hydration, and earlier-answer stability after a later prompt.

## Implementation Slices

1. Add regressions for missing attempt/turn terminal events, restart abandonment, synthetic notification ownership, compaction interruption, and frontend conflict refresh.
2. Add provider-attempt and drain finalizers; correct the reversed completed-assistant recovery predicate.
3. Add abnormal turn outcomes and deterministic orphan reconciliation.
4. Replace recursive compaction defects with explicit iterative transitions.
5. Expose the authoritative execution snapshot and phase vocabulary through Protocol/Server/Client.
6. Route both composers from that snapshot and add one-refresh/one-retry conflict handling.
7. Add phase presentation and reconnect reconciliation.
8. Fix Markdown streaming/settled equivalence independently.

## Release Tests

Core regressions must prove:

- rejected or interrupted question tool produces terminal tool, assistant, attempt, and turn state;
- arbitrary runner failure after attempt start cannot leave `started` or `responding`;
- startup abandons a non-task ambiguous attempt without a provider call;
- a new human prompt after repair starts exactly one new turn;
- pending human input survives orphan repair;
- idle notification starts a distinct internal turn, not the notification message ID;
- active notification joins without changing turn owner;
- compaction success, failure, and interruption all leave a balanced turn;
- repeated finalization and restart repair are idempotent.

App regressions must prove:

- idle plus stale local turn identity cannot send an invalid start without refresh;
- active regular turn steers only with the authoritative expected ID;
- recovery/abandon refresh preserves and retries the same draft identity once;
- no settled answer is replaced when a later prompt streams;
- streaming Markdown and hydrated settled Markdown have equivalent output.

## Verification

Run tests and typechecks from package directories. Protocol or Server `HttpApi` changes require `bun run generate` from `packages/client`. Generated client files are never edited directly.
