# Durable Follow-up Behavior

## Status

Design approved by the user on 2026-07-31.

## Goal

Make follow-up behavior a durable, user-controlled input mode. Enter uses the configured default mode, while Ctrl+Enter forces Steer. Queue and Steer submissions must survive client reloads and server restarts, remain idempotent under retries, and preserve the existing provider-attempt recovery contract.

## Context

The Core V2 lifecycle already models `SessionInput.Delivery` as `"queue" | "steer"` and the runner already has the intended promotion rules:

- Steer inputs are promoted at the next safe provider-turn boundary.
- Queue inputs remain pending while a Session is active.
- When the Session becomes idle, one queued input is promoted, then the runner reevaluates continuation and pending Steer inputs.

The application currently has a conflicting local implementation. A busy follow-up is stored as a browser-local `FollowupDraft`, while the settings context currently rewrites `queue` back to `steer`. This loses queued work across browser restarts, makes different clients disagree, and bypasses the durable `session_input` protocol.

This design connects the existing Core protocol to the application instead of introducing another queue state machine.

## Scope

In scope:

- Explicit Queue/Steer delivery on prompt and command submission.
- Enter/default and Ctrl+Enter/forced-Steer input semantics.
- Durable pending-input listing, promotion, cancellation, and idempotent reconciliation.
- Queue dock hydration from server truth.
- Restart, cancellation, commit/wake, provider ambiguity, and concurrent-operation tests.
- Regeneration of the public client after Protocol/Server HttpApi changes.

Out of scope:

- Automatic retry of `started` or `responding` provider attempts.
- Interrupting an active provider request merely because a Steer input was admitted.
- Remote worker placement or clustered Session execution.
- Model catalog refresh, per-model context editing, or broader subagent ownership UX.

## Behavior Contract

The application keeps `settings.general.followup` as the default delivery mode. The existing default remains `"steer"` for backward-compatible behavior; selecting Queue changes the default to `"queue"`.

For each normal prompt or command:

```text
effectiveDelivery = explicitSubmitDelivery ?? settings.general.followup
```

The normal Enter submit uses `effectiveDelivery`. The normalized platform shortcut `mod+enter` (Ctrl+Enter on Windows/Linux and the platform equivalent on macOS) submits with explicit `"steer"`, overriding the setting.

Delivery only changes the handling of an input while the Session is busy. If the Session is idle, both modes can be promoted immediately by the runner. If the Session is busy:

- `queue` is durable pending work and is promoted in admitted order after the current ownership chain becomes idle.
- `steer` is durable pending work and is promoted at the next safe provider-turn boundary. It does not forcibly terminate the current provider request.

Every accepted input keeps its caller-selected message ID. A retry with the same Session, ID, prompt, model, agent, and delivery adopts the existing input. A conflicting reuse remains a prompt conflict.

## Architecture

### Core durable input slice

Keep `SessionInput.Delivery` and the existing runner promotion logic as the source of truth. Extend the Core input boundary with these operations:

- `pending(db, sessionID, delivery?)` returns admitted rows whose `promoted_seq` and `terminal_outcome` are both null, ordered by `admitted_seq`.
- `find(db, inputID)` remains the exact identity lookup used to reconcile a request after a lost response.
- `promote(db, events, sessionID, inputID)` is CAS-based and returns the existing admitted row when the input was already promoted. It returns no result for an unknown or terminal input.
- `cancelPending(db, sessionID, inputID)` CAS-cancels only an unpromoted input by writing the existing terminal projection fields: `terminal_outcome = "cancelled"`, cancellation error, terminal time, and terminal sequence. A promoted or already terminal input is a conflict, not a successful cancellation.

No database migration is required because the current `session_input` table already contains delivery, promotion, and terminal projection columns.

### Protocol and HTTP API

Add the following V2 Session endpoints to the public Protocol and server HttpApi. Use the existing Session location middleware and error vocabulary.

| Operation | Route | Contract |
| --- | --- | --- |
| List pending | `GET /api/session/:sessionID/input` | Return `{ data: SessionInput.Admitted[] }`, ordered by `admittedSeq`; optional delivery filter may restrict the result to `queue` or `steer`. |
| Exact lookup | `GET /api/session/:sessionID/input/:inputID` | Return `{ data: SessionInput.Admitted }` for idempotent client reconciliation, including an input that has already been promoted. |
| Promote | `POST /api/session/:sessionID/input/:inputID/promote` | Return `{ data: SessionInput.Admitted }`; pending promotion and already-promoted replay are both success. Unknown or terminal inputs are explicit errors. |
| Cancel | `DELETE /api/session/:sessionID/input/:inputID` | CAS-cancel an unpromoted input and return success. A concurrent promote returns a conflict. |

The existing prompt and command endpoints continue to accept optional `delivery`. Their handlers must pass it through unchanged and call `SessionExecution.wake(sessionID)` only after the admission or promotion transaction commits.

The promote handler must not wake before its durable commit. A repeated promote must not publish a second visible prompt. The cancel handler must not mutate an immutable input or remove an already visible message.

After changing the public Protocol or Server HttpApi, run `bun run generate` from `packages/client`. Generated files are never edited directly.

### Application submission

Make the shared `createPromptSubmit` path accept an explicit per-submit delivery override. Both the legacy composer and V2 composer use the same submit contract so the two layouts cannot diverge:

- Native form submission passes no override and uses the persisted setting.
- The `mod+enter` key path prevents the normal form submit and invokes the same handler with `{ delivery: "steer" }`.
- Busy Queue submission calls the prompt or command API immediately with `delivery: "queue"`; it never waits for the Session to become idle and never stores the draft as the correctness source.
- Busy Steer submission calls the API immediately with `delivery: "steer"`.
- Empty input keeps the existing abort behavior and never admits a Queue or Steer input.

The deterministic message ID is generated before the request. If a response is lost after admission, retrying with that ID is safe and must adopt the existing input. The UI may show a transient optimistic state while the request is in flight, but it must reconcile against the returned or exact-looked-up durable input.

### Queue dock

Replace the local `FollowupDraft` queue used for correctness with server-backed pending inputs:

- On Session load, reconnect, and directory switch, load pending queue inputs from the new list endpoint.
- Reconcile live admissions and exact request responses by input ID.
- Render queue previews from the stored prompt. Do not show Steer inputs in the queue dock once they have been promoted.
- `Send now` invokes the exact-input promote endpoint. A replay that discovers the input was already promoted is treated as success.
- Edit first cancels the exact unpromoted input, then restores its prompt and context into the composer. If promotion wins the race, keep the original input and report the conflict instead of creating a duplicate.
- A failed admission or failed cancellation removes only the corresponding optimistic state and restores the composer when appropriate.

The existing dock can remain visually similar. The important change is that its items are derived from durable input identity and can be reconstructed after a restart.

## Failure and Recovery Rules

1. Admission commits before wake. A crash between them is recovered by the existing startup candidate discovery and advisory wake path.
2. A client timeout after a successful commit is reconciled by the original message ID. No new ID or different prompt is generated automatically.
3. Promote is one-success CAS. The first successful promotion publishes the visible prompt; later calls return the existing projection.
4. Cancel and promote are mutually exclusive terminal/promotion races. Exactly one operation wins.
5. Steer means next safe provider-turn boundary, not provider interruption. It must not turn an ambiguous provider attempt into an automatic retry.
6. `started` and `responding` attempts remain recovery-required after restart. Pending follow-up work may be discovered and woken, but provider work with ambiguous ownership is never guessed.
7. `cancelTree(rootSessionID)` terminalizes pending inputs in the ownership tree before post-commit exact-session interruption. `done` remains after descendant local execution reaches quiescence.

## Ownership and Dependency Boundaries

- Schema owns `Delivery` and `SessionInput.Admitted` definitions.
- Core owns durable input queries, CAS promotion/cancellation, runner semantics, and execution wake ordering.
- Protocol owns endpoint schemas and public route contracts.
- Server maps Protocol endpoints to Core services and performs post-commit wake calls.
- Client owns generated API types only.
- App owns persisted default mode, keyboard intent, optimistic rendering, and server reconciliation. It never decides whether a prompt was accepted, promoted, terminal, or recovered from local state.

Runtime dependency direction remains Schema -> Core/Protocol -> Server. Client runtime code does not depend on Core or Server.

## Test Plan and Release Gates

### Core

- Pending input listing filters terminal and promoted rows and preserves admitted order.
- Concurrent promote has one durable winner and one visible projection.
- Concurrent cancel/promote has exactly one winner and explicit loser behavior.
- Runner promotes Steer at the safe boundary, Queue only at idle, and one queue item per idle boundary.
- Admission commit followed by wake failure is recovered after restart.
- `started` and `responding` attempts remain recovery-required and are not automatically resent.
- Ownership cancellation prevents pending descendant input from escaping.

### Protocol and Server

- Prompt and command delivery survives the request/handler boundary.
- List, exact lookup, promote, and cancel return their documented success, missing, conflict, and idempotent outcomes.
- Post-commit wake ordering is verified for admission and promotion.
- Generated client code matches the public API after `bun run generate`.

### App

- Enter uses the persisted Queue/Steer default.
- `mod+enter` always sends Steer regardless of the default setting.
- Both composer implementations use the same delivery selection and do not reintroduce local-only queueing.
- A busy Queue prompt is admitted immediately and appears in the durable queue view.
- A lost response reconciles by the original message ID without a duplicate request identity.
- Queue items hydrate after reload and support promote/edit/cancel races.
- Blank submit still interrupts active work instead of creating an input.

### Invariants

- Every accepted input either executes once or is durably cancelled before promotion; no accepted input executes twice or becomes visible twice.
- Queue order is stable; Steer cannot be indefinitely hidden behind Queue.
- No stale result is bound to a different input identity.
- No terminal task/input is left without its required durable notification or projection.
- Ambiguous provider requests are not guessed or resent.
- Cancellation leaves no executing descendant outside the cancelled ownership tree.
- Restart does not leave safe pending work permanently stuck.

## Verification Commands

Run tests from package directories, never from the repository root:

From `packages/core`:

```text
bun test test/session-prompt.test.ts test/session-runner.test.ts test/session-execution-recovery.test.ts
bun typecheck
```

From `packages/opencode`:

```text
bun test test/server/httpapi-session.test.ts
bun typecheck
```

From `packages/app`:

```text
bun test src/components/prompt-input/submit.test.ts
bun typecheck
```

From the repository root, run `git diff --check`.
