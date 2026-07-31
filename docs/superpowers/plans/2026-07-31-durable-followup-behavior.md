# Durable Follow-up Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-local follow-up drafts with durable Queue/Steer session inputs so Enter and Ctrl+Enter have deterministic, restart-safe behavior.

**Architecture:** The existing Core V2 `session_input` table remains the only admission and promotion source of truth. Core exposes session-scoped pending, exact lookup, CAS promotion, and CAS cancellation operations; the Protocol and Server expose those operations after durable commit, and the App hydrates its follow-up dock from the server instead of deciding correctness from local state. Provider-attempt recovery remains unchanged: Steer waits for the next safe boundary and never resends an ambiguous attempt.

**Tech Stack:** TypeScript, Effect, Drizzle/SQLite, Effect HttpApi, generated `@opencode-ai/client`, SolidJS, TanStack Solid Query, Bun tests.

## Global Constraints

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior.
- Keep `SessionExecution` process-global and Session-ID based. Wakes are advisory and must occur only after the admission or promotion transaction commits.
- Steer promotes at the next safe provider-turn boundary; Queue remains pending until the Session would otherwise become idle, then one Queue input is promoted.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles only when Session, prompt, model/agent selection, and delivery agree; conflicting reuse is a prompt conflict.
- Do not automatically retry `started` or `responding` provider attempts after restart. Pending inputs may be discovered and woken, but ambiguous provider work remains recovery-required.
- Runtime dependency direction remains Schema -> Core/Protocol -> Server. Client runtime code does not depend on Core or Server.
- Do not edit `packages/client/src/generated` or `packages/client/src/generated-effect`; regenerate with `bun run generate` from `packages/client` after Protocol or Server HttpApi changes.
- Run tests from package directories, never from the repository root. Run `bun typecheck` from every changed package directory and `git diff --check` from the repository root.
- Use no database migration: `session_input` already has `delivery`, `promoted_seq`, `terminal_outcome`, `terminal_error`, `terminal_time`, and `terminal_seq`.

## File Map

- `packages/core/src/session/input.ts`: session-scoped pending reads and atomic promotion/cancellation behavior over `session_input`.
- `packages/core/src/session.ts`: public V2 Session service operations and post-commit wake ordering.
- `packages/core/test/session-input.test.ts`: focused Core admission, CAS, ordering, and terminal projection tests.
- `packages/core/test/session-execution-recovery.test.ts`: restart candidates and ambiguous provider-attempt assertions.
- `packages/protocol/src/errors.ts`: public missing/conflict error contracts for exact input operations.
- `packages/protocol/src/groups/session.ts`: public V2 input list, lookup, promote, and cancel endpoints.
- `packages/server/src/handlers/session.ts`: map endpoint requests to Core and wake only after successful durable operations.
- `packages/opencode/test/server/httpapi-session.test.ts`: route contracts, error mapping, and wake ordering for the shared server test fixture.
- `packages/client/src/generated/*`, `packages/client/src/generated-effect/*`: generated only by `bun run generate`.
- `packages/app/src/utils/server.ts`: preserve canonical prompt context and delivery through the current V2 client adapter.
- `packages/app/src/utils/server-compat.ts`: type and compatibility surface for the new session input methods; legacy servers must not become a local queue source of truth.
- `packages/app/src/context/settings.tsx`: persist Queue/Steer without rewriting Queue to Steer.
- `packages/app/src/components/prompt-input/contracts.ts`: submit callback delivery override type.
- `packages/app/src/components/prompt-input/submit.ts`: one submission path for prompt and command admission, deterministic message IDs, and explicit per-submit delivery.
- `packages/app/src/components/prompt-input.tsx`: native Enter/default and `mod+enter` forced-Steer keyboard routing.
- `packages/app/src/components/prompt-input-v2.tsx`: pass the same delivery-aware submission contract to the V2 composer.
- `packages/app/src/components/prompt-input/submit.test.ts`: delivery propagation, retry identity, empty-submit, command, and optimistic rollback tests.
- `packages/app/src/components/prompt-input/build-request-parts.ts`: canonical durable prompt/context conversion if the current adapter needs it.
- `packages/app/src/pages/session/composer/session-followup-state.ts`: server-backed follow-up state machine and reconciliation helper.
- `packages/app/src/pages/session.tsx`: remove persisted `FollowupDraft` correctness state and connect the durable controller to the composer and dock.
- `packages/app/src/pages/session/composer/session-followup-dock.tsx`: render durable pending inputs and report promotion/edit conflicts without duplicating them.
- `packages/app/src/pages/session/composer/session-composer-region-controller.ts`: keep the dock contract based on durable input IDs.
- `packages/app/src/context/settings.test.ts`: verify explicit Queue preference is preserved.
- `packages/app/src/pages/session/composer/session-followup-state.test.ts`: reload, lost response, promote/cancel races, and edit restoration tests.

---

### Task 1: Add Core Session-Input Operations

**Files:**
- Create: `packages/core/test/session-input.test.ts`
- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/core/src/session.ts`

**Interfaces:**
- `SessionInput.pending(db, sessionID, delivery?) -> Effect.Effect<ReadonlyArray<SessionInput.Admitted>>` returns only rows where `promoted_seq IS NULL` and `terminal_outcome IS NULL`, ordered by `admitted_seq ASC`.
- `SessionInput.findForSession(db, sessionID, inputID) -> Effect.Effect<SessionInput.Admitted | undefined>` prevents an ID from one Session being treated as a match in another Session.
- `SessionInput.cancelPending(db, sessionID, inputID) -> Effect.Effect<"cancelled" | "promoted" | "terminal" | "missing">` performs one SQL update guarded by Session, ID, `promoted_seq IS NULL`, and `terminal_outcome IS NULL`; the winner writes `terminal_outcome = "cancelled"`, `{ message: "Input cancelled by user" }`, `terminal_time`, and the current aggregate `terminal_seq`.
- `SessionV2.Interface.pending({ sessionID, delivery? }) -> Effect.Effect<ReadonlyArray<SessionInput.Admitted>, SessionV2.NotFoundError>` validates the Session before reading.
- `SessionV2.Interface.findInput({ sessionID, inputID }) -> Effect.Effect<SessionInput.Admitted | undefined, SessionV2.NotFoundError>` validates the Session and uses the session-scoped lookup.
- `SessionV2.Interface.promoteInput({ sessionID, inputID }) -> Effect.Effect<SessionInput.Admitted, SessionV2.NotFoundError | SessionV2.InputConflictError>` returns the already-promoted projection on replay and rejects unknown or terminal inputs.
- `SessionV2.Interface.cancelInput({ sessionID, inputID }) -> Effect.Effect<void, SessionV2.NotFoundError | SessionV2.InputConflictError>` succeeds only for the CAS cancellation winner.

- [ ] **Step 1: Write the failing tests**

Add focused tests that create one Session and admit inputs with admitted sequence values `1`, `2`, and `3`:

```ts
it.effect("lists only pending inputs in admitted order", () =>
  Effect.gen(function* () {
    const inputs = yield* SessionInput.pending(db, sessionID)
    expect(inputs.map((input) => input.id)).toEqual([first.id, second.id])
    expect((yield* SessionInput.pending(db, sessionID, "queue")).every((input) => input.delivery === "queue")).toBe(true)
  }),
)

it.effect("does not allow concurrent promotion and cancellation to both win", () =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const [promoted, cancelled] = yield* Effect.all(
      [session.promoteInput({ sessionID, inputID }), session.cancelInput({ sessionID, inputID })],
      { concurrency: "unbounded", mode: "either" },
    )
    expect(Number(promoted._tag === "Right") + Number(cancelled._tag === "Right")).toBe(1)
    const row = yield* db
      .select({ promoted: SessionInputTable.promoted_seq, terminal: SessionInputTable.terminal_outcome })
      .from(SessionInputTable)
      .where(eq(SessionInputTable.id, inputID))
      .get()
      .pipe(Effect.orDie)
    expect(Number(row !== undefined && row.promoted !== null) + Number(row !== undefined && row.terminal !== null)).toBe(1)
  }),
)
```

Use the existing test fixture/layer helpers from `session-prompt.test.ts` or `session-projector.test.ts`; do not mock the database or duplicate the SQL logic in assertions.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/core`:

```text
bun test test/session-input.test.ts
```

Expected: FAIL because the pending/session-scoped/CAS methods and the Core service methods do not exist, and the current promote path does not expose an idempotent exact-input operation.

- [ ] **Step 3: Write the minimal implementation**

Implement the SQL predicates in `packages/core/src/session/input.ts`. Reuse `fromRow`, `EventV2.latestSequence`, and the existing `LifecycleConflict` vocabulary. Make promotion idempotent by checking the exact row after a lost race: an already-promoted row with matching Session and input identity is returned; an unpromoted row is promoted once; a terminal row or missing row becomes an explicit conflict. Keep the visible `SessionEvent.Prompted` event deterministic for the input ID so a retry cannot create a second visible prompt.

Add `InputConflictError` to `packages/core/src/session.ts` and implement the four service methods next to the existing `prompt`, `command`, and `interrupt` methods. The service must not wake from the low-level input helper; callers decide whether to issue the advisory wake after the durable operation completes.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/core`:

```text
bun test test/session-input.test.ts test/session-prompt.test.ts test/session-projector.test.ts
bun typecheck
```

Expected: PASS, with existing promotion/projector tests retaining their current behavior and the new tests proving one winner for promotion/cancellation races.

- [ ] **Step 5: Commit**

```text
git add packages/core/src/session/input.ts packages/core/src/session.ts packages/core/test/session-input.test.ts
git commit -m "feat(core): expose durable follow-up input operations"
```

### Task 2: Preserve Admission, Promotion, and Recovery Ordering

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session/execution/local.ts`
- Modify: `packages/core/src/session/runner/llm.ts` only if a regression test proves the existing safe-boundary rule needs a correction
- Modify: `packages/core/test/session-prompt.test.ts`
- Modify: `packages/core/test/session-runner.test.ts`
- Modify: `packages/core/test/session-execution-recovery.test.ts`

**Interfaces:**
- Prompt and command continue accepting `delivery?: SessionInput.Delivery`.
- `SessionV2.prompt` and `SessionV2.command` return the admitted input, then call `execution.wake(sessionID)` only after `SessionInput.admit` and any requested promotion have committed.
- `SessionExecutionLocal.startupCandidates` remains the restart candidate source and must not convert `started` or `responding` provider attempts into automatic retries.

- [ ] **Step 1: Write the failing tests**

Add assertions for the release gates:

```ts
it.effect("wakes only after admission commit", () =>
  Effect.gen(function* () {
    const observed: string[] = []
    const admitted = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "queued" }), delivery: "queue" })
    observed.push((yield* SessionInput.find(db, admitted.id)) ? "committed" : "missing")
    expect(observed).toEqual(["committed"])
  }),
)

it.effect("keeps ambiguous provider attempts recovery-required after restart", () =>
  Effect.gen(function* () {
    yield* db
      .insert(SessionAttemptTable)
      .values({
        session_id: sessionID,
        attempt_id: EventV2.ID.make("evt_ambiguous_provider"),
        assistant_message_id: SessionMessage.ID.make("msg_ambiguous_provider"),
        status: "responding",
        attempt: 1,
        seq: 1,
        time_updated: 1,
      })
      .run()
      .pipe(Effect.orDie)
    expect(yield* SessionExecutionLocal.startupCandidates(db)).toContain(sessionID)
    expect(
      yield* db
        .select({ status: SessionAttemptTable.status, retryAt: SessionAttemptTable.retry_at })
        .from(SessionAttemptTable)
        .where(eq(SessionAttemptTable.session_id, sessionID))
        .all()
        .pipe(Effect.orDie),
    ).toEqual([{ status: "responding", retryAt: null }])
  }),
)
```

Extend existing runner tests to assert Steer is promoted at a safe provider-turn boundary, Queue remains pending while active, one Queue item is promoted at each idle boundary, and a wake failure after commit is recoverable by startup discovery.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/core`:

```text
bun test test/session-prompt.test.ts test/session-runner.test.ts test/session-execution-recovery.test.ts
```

Expected: the new ordering/recovery assertions fail before the service wake and idempotent promotion paths are wired completely.

- [ ] **Step 3: Write the minimal implementation**

Keep the runner’s `promoteSteers`, `promoteNextQueued`, and startup candidate predicates as the durable state machine. Move any newly added wake call outside the transaction boundary only after the Core method has returned the committed projection. Do not add an in-memory queue, provider retry, or interruption to Steer handling. If a restart candidate has a `started` or `responding` attempt, preserve its recovery-required decision and only wake safe pending/promoted continuation work.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/core`:

```text
bun test test/session-prompt.test.ts test/session-runner.test.ts test/session-execution-recovery.test.ts
bun typecheck
```

Expected: PASS, including all existing task lifecycle and provider recovery tests.

- [ ] **Step 5: Commit**

```text
git add packages/core/src/session.ts packages/core/src/session/execution/local.ts packages/core/src/session/runner/llm.ts packages/core/test/session-prompt.test.ts packages/core/test/session-runner.test.ts packages/core/test/session-execution-recovery.test.ts
git commit -m "fix(core): preserve durable follow-up recovery ordering"
```

### Task 3: Publish the V2 Input HTTP Contract

**Files:**
- Modify: `packages/protocol/src/errors.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`

**Interfaces:**
- `session.input.list`: `GET /api/session/:sessionID/input?delivery=queue|steer` returns `{ data: readonly SessionInput.Admitted[] }` ordered by `admittedSeq`.
- `session.input.get`: `GET /api/session/:sessionID/input/:inputID` returns `{ data: SessionInput.Admitted }` for an exact identity lookup; missing input returns the public input-not-found error.
- `session.input.promote`: `POST /api/session/:sessionID/input/:inputID/promote` returns `{ data: SessionInput.Admitted }`; repeated promotion returns the same projection, while missing/terminal input returns a conflict or input-not-found error.
- `session.input.cancel`: `DELETE /api/session/:sessionID/input/:inputID` returns `HttpApiSchema.NoContent`; cancellation of a promoted/terminal/missing input returns a conflict or input-not-found error.
- Existing `session.prompt` and `session.command` payloads keep optional `delivery` unchanged.

- [ ] **Step 1: Write the failing tests**

Add HTTP tests that admit two inputs, request both delivery filters, repeat exact lookup and promotion, and race cancel against promotion. Assert a wake spy sees the durable row before it is called and that a missing ID does not return a successful empty response:

```ts
expect(await client.session.input.list({ sessionID })).toEqual({ data: [expect.objectContaining({ id: firstID })] })
expect(await client.session.input.promote({ sessionID, inputID: firstID })).toEqual(
  await client.session.input.promote({ sessionID, inputID: firstID }),
)
expect((await client.session.input.list({ sessionID })).data).toHaveLength(1)
await expect(client.session.input.cancel({ sessionID, inputID: "missing" })).rejects.toMatchObject({ status: 404 })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/opencode`:

```text
bun test test/server/httpapi-session.test.ts
```

Expected: FAIL because the four routes and generated client methods are not present.

- [ ] **Step 3: Write the minimal implementation**

Add public errors `SessionInputNotFoundError` and `SessionInputConflictError` with `sessionID`, `inputID`, and a user-readable `message`. Add the four endpoints to `packages/protocol/src/groups/session.ts` under the existing `server.session` group and include `SessionLocationMiddleware`.

In `packages/server/src/handlers/session.ts`, validate the Session through `SessionV2.Service`, call the Core method, map Core errors to the public errors, and call `SessionExecution.wake(sessionID)` only after the successful durable result. The list and exact lookup handlers must not wake. The promote handler must not publish a second prompt on replay.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```text
bun test test/server/httpapi-session.test.ts
bun typecheck
```

Expected: PASS with documented success, missing, conflict, idempotent replay, and wake-order behavior.

- [ ] **Step 5: Commit**

```text
git add packages/protocol/src/errors.ts packages/protocol/src/groups/session.ts packages/server/src/handlers/session.ts packages/opencode/test/server/httpapi-session.test.ts
git commit -m "feat(server): expose durable follow-up input API"
```

### Task 4: Regenerate and Adapt the App Client Surface

**Files:**
- Regenerate: `packages/client/src/generated/*`
- Regenerate: `packages/client/src/generated-effect/*`
- Modify: `packages/app/src/utils/server.ts`
- Modify: `packages/app/src/utils/server-compat.ts`
- Modify: `packages/app/src/utils/server-compat.test.ts`

**Interfaces:**
- The generated V2 client exposes the input endpoints without any hand-edited generated file.
- `ServerApi.session.prompt` and `ServerApi.session.command` preserve `delivery` and the complete canonical prompt context when using the current V2 server.
- Legacy-compatible fallback never stores a follow-up in browser-local state; when the negotiated protocol is not V2, the App may submit immediately but must not claim durable Queue support.

- [ ] **Step 1: Write the failing tests**

Extend adapter tests with a canonical prompt containing text, file/agent attachments, context, and `delivery: "queue"`; assert the current V2 request receives all fields. Add a generated contract test that calls the new input methods by their generated names.

```ts
await api.session.prompt({ sessionID, id, text: "follow up", delivery: "queue", context: [{ text: "review" }] })
expect(currentPrompt).toMatchObject({ prompt: { text: "follow up", context: [{ text: "review" }] }, delivery: "queue" })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/app`:

```text
bun test src/utils/server-compat.test.ts
```

Expected: FAIL because the adapter currently strips canonical context and the generated input methods do not exist.

- [ ] **Step 3: Write the minimal implementation**

Run the required generator from `packages/client`:

```text
bun run generate
```

Update only non-generated adapters. Add the optional canonical context to the current prompt mapping, keep `delivery` unchanged, and expose the generated session input methods through the current V2 client. Keep legacy fallback explicit and free of local persistence.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```text
bun test src/utils/server-compat.test.ts
bun test test/contract-identity.test.ts
bun typecheck
```

Expected: PASS and generated files are consistent with Protocol. Verify from the repository root with `git diff --check` that only generator output and intended adapter files changed.

- [ ] **Step 5: Commit**

```text
git add packages/client/src/generated packages/client/src/generated-effect packages/app/src/utils/server.ts packages/app/src/utils/server-compat.ts packages/app/src/utils/server-compat.test.ts
git commit -m "chore(client): regenerate durable input API"
```

### Task 5: Implement Delivery-Aware Submission and Keyboard Semantics

**Files:**
- Modify: `packages/app/src/context/settings.tsx`
- Modify: `packages/app/src/context/settings.test.ts`
- Modify: `packages/app/src/components/prompt-input/contracts.ts`
- Modify: `packages/app/src/components/prompt-input/submit.ts`
- Modify: `packages/app/src/components/prompt-input.tsx`
- Modify: `packages/app/src/components/prompt-input-v2.tsx`
- Modify: `packages/app/src/components/prompt-input/submit.test.ts`

**Interfaces:**
- `PromptInputSubmission.handleSubmit(event, delivery?: "queue" | "steer")` uses the explicit override when supplied and otherwise uses the persisted default supplied by the caller.
- `PromptInputProps.defaultDelivery?: () => "queue" | "steer"` supplies the persisted default to both composer implementations; remove `shouldQueue` and `onQueue` as correctness hooks.
- `sendFollowupDraft` is changed to immediate durable admission with `{ delivery, messageID }`; it never waits for idle and never writes a local queue item.

- [ ] **Step 1: Write the failing tests**

Add tests proving:

```ts
let defaultDelivery: "queue" | "steer" = "steer"
await submit.handleSubmit({ preventDefault() {} } as Event, "steer")
expect(sentPrompts[0]).toMatchObject({ delivery: "steer", id: expect.stringMatching(/^msg_/) })

defaultDelivery = "queue"
await submit.handleSubmit({ preventDefault() {} } as Event)
expect(sentPrompts[0]).toMatchObject({ delivery: "queue" })

await submit.handleSubmit({ preventDefault() {} } as Event, "queue")
expect(sentPrompts[0].id).toBe(firstID)
await submit.handleSubmit({ preventDefault() {} } as Event, "queue")
expect(sentPrompts.map((input) => input.id)).toEqual([firstID, firstID])
```

Also assert blank submit still calls `interrupt` and does not call prompt/command, and `settings.general.setFollowup("queue")` leaves the stored/read value as Queue.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/app`:

```text
bun test src/components/prompt-input/submit.test.ts src/context/settings.test.ts
```

Expected: FAIL because Queue is rewritten to Steer and busy submission still diverts into `FollowupDraft`.

- [ ] **Step 3: Write the minimal implementation**

Remove the settings effect and setter conversion that force Queue back to Steer. Change both composer call sites to pass the persisted default delivery. On native Enter, call `handleSubmit(event)`; on normalized `mod+enter` (`ctrl+enter` on Windows/Linux and the platform equivalent on macOS), prevent the form submit and call `handleSubmit(event, "steer")`. Keep IME, Shift+Enter, slash-popover navigation, and blank-submit abort behavior intact.

For prompt and command requests, generate the deterministic message ID before the request and pass `delivery` through the V2 adapter immediately even when the Session is busy. Keep optimistic UI rollback tied to that exact ID so a lost response can reconcile without creating a second ID.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```text
bun test src/components/prompt-input/submit.test.ts src/context/settings.test.ts
bun typecheck
```

Expected: PASS for both legacy and V2 composer construction, Queue/Steer selection, Ctrl/Cmd+Enter override, command delivery, retries, and blank interruption.

- [ ] **Step 5: Commit**

```text
git add packages/app/src/context/settings.tsx packages/app/src/context/settings.test.ts packages/app/src/components/prompt-input/contracts.ts packages/app/src/components/prompt-input/submit.ts packages/app/src/components/prompt-input.tsx packages/app/src/components/prompt-input-v2.tsx packages/app/src/components/prompt-input/submit.test.ts
git commit -m "feat(app): submit durable queue and steer follow-ups"
```

### Task 6: Replace the Local Follow-up Dock with Durable Reconciliation

**Files:**
- Create: `packages/app/src/pages/session/composer/session-followup-state.ts`
- Create: `packages/app/src/pages/session/composer/session-followup-state.test.ts`
- Modify: `packages/app/src/pages/session.tsx`
- Modify: `packages/app/src/pages/session/composer/session-followup-dock.tsx`
- Modify: `packages/app/src/pages/session/composer/session-composer-region-controller.ts`

**Interfaces:**
- `createSessionFollowupState(input)` returns `{ items, loading, sending, refresh, promote, edit, remove }` and stores only transient request state locally.
- `items` is derived from `GET /api/session/:sessionID/input?delivery=queue`; each item retains the durable `inputID`, canonical `prompt`, `delivery`, and `admittedSeq`.
- `promote(inputID)` calls the exact promote endpoint; an already-promoted replay is success and removes the item after refresh.
- `edit(inputID)` first calls exact cancel. On success it restores the canonical prompt/context into the composer; on conflict it keeps the durable input and reports the conflict without creating a duplicate.

- [ ] **Step 1: Write the failing tests**

Use a small real controller fixture with an API implementation that records calls:

```ts
const state = createSessionFollowupState({ sessionID: () => "ses_1", api })
await state.refresh()
expect(state.items().map((item) => item.id)).toEqual(["msg_queue_1"])
await state.promote("msg_queue_1")
expect(api.promoteCalls).toEqual(["msg_queue_1"])
await state.refresh()
expect(state.items()).toEqual([])
```

Add cases for reload hydration, a lost admission response reconciled by exact ID, promote replay, cancel/promote conflict, directory/session switch, and filtering out Steer inputs or terminal/promoted rows.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/app`:

```text
bun test src/pages/session/composer/session-followup-state.test.ts
```

Expected: FAIL because the controller and durable dock wiring do not exist.

- [ ] **Step 3: Write the minimal implementation**

Delete the persisted `followup.v1` items/failed/paused state from `packages/app/src/pages/session.tsx`. Create the controller using the directory-scoped V2 client, refresh it on Session load, reconnect, and directory switch, and reconcile exact admission responses by ID. Keep optimistic entries transient and replace them with server rows after the request settles.

Render stored canonical prompt previews, keep `Send now` and `Edit` disabled only for the matching in-flight item, and use the existing dock visual style. For Edit, restore `prompt.text`, stored file/agent/context entries, and the original model selection into the composer only after cancellation commits. A failed request removes only its optimistic entry and restores the submission snapshot where applicable.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```text
bun test src/pages/session/composer/session-followup-state.test.ts src/components/prompt-input/submit.test.ts
bun typecheck
```

Expected: PASS with a reloadable queue dock, no local correctness queue, exact-ID promotion/edit races, and the same behavior in both composer layouts.

- [ ] **Step 5: Commit**

```text
git add packages/app/src/pages/session.tsx packages/app/src/pages/session/composer/session-followup-state.ts packages/app/src/pages/session/composer/session-followup-state.test.ts packages/app/src/pages/session/composer/session-followup-dock.tsx packages/app/src/pages/session/composer/session-composer-region-controller.ts
git commit -m "fix(app): hydrate follow-up dock from durable inputs"
```

### Task 7: Run Cross-Layer Release Gates and Finish the Branch

**Files:**
- Modify: `packages/core/test/session-input.test.ts`
- Modify: `packages/core/test/session-execution-recovery.test.ts`
- Modify: `packages/core/test/session-task-cancellation.test.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/app/src/components/prompt-input/submit.test.ts`
- Modify: `packages/app/src/pages/session/composer/session-followup-state.test.ts`

**Interfaces:**
- Every accepted input has one durable identity and one of: promoted/executed once, or terminally cancelled before promotion.
- Parent/child cancellation terminalizes pending descendants before post-commit exact-session interruption; no descendant can escape after cancellation wins.
- No terminal input is treated as pending; no visible prompt is published twice; no ambiguous provider attempt is automatically resent.

- [ ] **Step 1: Write the failing integration/release tests**

Add or complete tests for these exact fault points. Use the existing real database, EventV2, SessionExecution, HTTP, and TaskCancellation fixtures. The assertions below are the required test bodies, split into the existing package tests:

```ts
const admitted = yield* session.prompt({ sessionID, id: messageID, prompt, delivery: "queue", resume: false })
expect(yield* SessionInput.find(db, admitted.id)).toMatchObject({ id: messageID })
expect(yield* SessionInput.startupCandidates(db)).toContainEqual({ sessionID })

const retry = yield* session.prompt({ sessionID, id: messageID, prompt, delivery: "queue", resume: false })
expect(retry.id).toBe(messageID)
expect(yield* session.messages({ sessionID })).toHaveLength(0)

yield* cancellation.cancelTree({
  rootSessionID,
  interrupt: () => Effect.void,
  wait: () => Effect.void,
})
const escaped = yield* submissions.submit(descendantInvocation).pipe(Effect.flip)
expect(escaped._tag).toBe("TaskSubmission.Cancelled")
```

Place the first block in `packages/core/test/session-execution-recovery.test.ts`: construct the local execution layer only after the admission and let `SessionInput.startupCandidates` provide the recovery wake. Place the second block in `packages/core/test/session-prompt.test.ts` or the server HTTP test and verify the exact input ID has one projection after the simulated lost response. Place the third block beside the existing ownership-tree cancellation test in `packages/core/test/session-task-cancellation.test.ts`; retain its interrupt/wait ordering assertions and add the descendant submission rejection assertion.

- [ ] **Step 2: Run the complete focused suites to verify any remaining failures**

Run from each package directory:

```text
# packages/core
bun test test/session-input.test.ts test/session-prompt.test.ts test/session-runner.test.ts test/session-execution-recovery.test.ts test/session-task-cancellation.test.ts
bun typecheck

# packages/opencode
bun test test/server/httpapi-session.test.ts
bun typecheck

# packages/app
bun test src/components/prompt-input/submit.test.ts src/pages/session/composer/session-followup-state.test.ts src/context/settings.test.ts
bun typecheck
```

- [ ] **Step 3: Fix only the remaining behavioral failures**

Use the failure output to correct transaction ordering, exact-ID reconciliation, error mapping, or UI state cleanup. Do not weaken assertions by accepting duplicate IDs, stale prompt text, terminal-without-outbox state, guessed provider retries, or escaped descendants.

- [ ] **Step 4: Run all verification commands**

```text
cd packages/core; bun test test/session-input.test.ts test/session-prompt.test.ts test/session-runner.test.ts test/session-execution-recovery.test.ts test/session-task-cancellation.test.ts; bun typecheck
cd ../opencode; bun test test/server/httpapi-session.test.ts; bun typecheck
cd ../app; bun test src/components/prompt-input/submit.test.ts src/pages/session/composer/session-followup-state.test.ts src/context/settings.test.ts; bun typecheck
cd ../..; git diff --check
```

Expected: all focused suites and typechecks pass, generated client output is clean, and `git diff --check` has no whitespace errors.

- [ ] **Step 5: Commit the release-gate tests and implementation fixes**

```text
git add packages/core packages/protocol packages/server packages/client packages/opencode/test/server/httpapi-session.test.ts packages/app
git commit -m "test: close durable follow-up release gates"
```
