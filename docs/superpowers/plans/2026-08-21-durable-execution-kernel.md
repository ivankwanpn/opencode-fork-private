# Durable Execution Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current process-local Session runner with a durable, fenced, single-owner execution kernel, migrate every OpenCode product surface to it, and then delete the Classic engine without adding V1 projections or old-data migration.

**Architecture:** Keep the canonical V2 Session API and route each newly created Session to either the existing Classic engine or a new Kernel engine fixed at creation. Build Kernel from an atomic EventV2 batch primitive, a durable `session_execution` coordination row, a single PublicationActor, staged bounded tool scheduling, conservative recovery, and scoped plugin contributions. Roll out additively, observe both engines without duplicating real provider side effects, switch the new-Session default only after system gates pass, then remove Classic.

**Tech Stack:** TypeScript, Bun, Effect 4, Effect Schema/HttpApi, Drizzle SQLite, EventV2, `@opencode-ai/llm`, SolidJS, Electron Desktop, OpenCode TUI/ACP/CLI.

**Spec:** `docs/superpowers/specs/2026-08-21-durable-execution-kernel-redesign.md`

## Global Constraints

- Work only on branch `999.0.20`; do not push until the user explicitly requests it.
- Do not stage or commit `docs/superpowers/handoffs/`.
- Keep runtime dependency direction Schema → Core/Protocol → Server; Client may depend on Schema/Protocol, never Core/Server.
- Preserve `SessionV2.prompt`, `command`, `interrupt`, `status`, `history`, and `input.*` as the canonical product surface.
- A Session fixes `engine: "classic" | "kernel"` at creation and never changes engine.
- Existing rows without an engine decode as Classic; old Session data is not migrated into Kernel execution.
- Kernel capability absence fails with a typed error; Kernel never falls back to Classic.
- Keep EventV2 and Effect Layer/Scope/Location; do not import Cordis, Codex Rust crates, DSH packages, or `@i-harness/*`.
- Kernel startup may classify and reconcile but must perform zero root provider calls.
- Plugins never receive SQL handles, lease tokens, generation mutation, durable-sequence writes, projector transactions, terminal commit, or cancellation override.
- Every public Protocol or Server HttpApi change must be followed by `bun run generate` and `bun run check:generated` from `packages/client`.
- Run tests and `bun typecheck` from package directories, never the repository root.
- Keep each task as an independently reviewable conventional commit; do not mix unrelated V1-to-V2 cleanup into Kernel commits.

## File Structure

New Kernel code lives under `packages/core/src/session/kernel/`:

```text
index.ts                 Kernel Effect service and Location/process composition
types.ts                 engine, lease, snapshot, phase, outcome, and typed errors
lifecycle-store.ts       the only durable coordination writer
coordinator.ts           one process-local actor per active Kernel Session
publication-actor.ts     ordered provider-turn mutable publication state
provider-reader.ts       validates and forwards LLM events only
checkpoint.ts            transient-delta buffering and durable checkpoint policy
tool-scheduler.ts        ordered prepare, bounded dispatch, ordered finalize
recovery-planner.ts      read-only evidence classification
recovery-executor.ts     fenced application of a revalidated RecoveryPlan
status-projector.ts      derived transient status snapshots
plugin-host.ts           scoped typed Kernel extension seams
```

Existing files keep their current responsibilities:

- `packages/core/src/event.ts`: atomic durable event API and post-commit delivery.
- `packages/core/src/session/execution/local.ts`: Classic process-local implementation until Task 15 deletes it.
- `packages/core/src/session/execution.ts`: stable routing facade consumed by Session APIs and tools.
- `packages/core/src/session/sql.ts`: Session, shared inbox/task/outbox tables, Classic tables, and Kernel execution table.
- `packages/schema/src/session.ts` and `session-event.ts`: public engine/status/event schemas.
- `packages/core/src/session/runner/`: Classic runner; algorithms may be extracted, but Kernel must not call the Classic loop.
- `packages/core/src/tool/registry.ts`: canonical tool identity/materialization; Kernel scheduling is separate.
- `packages/core/src/plugin/host.ts` and `plugin/runtime.ts`: existing V2 contribution machinery extended in Task 11.
- `packages/protocol/src/groups/session.ts` and `packages/server/src/handlers/session.ts`: canonical HTTP surface.
- `packages/app`, `packages/session-ui`, `packages/desktop`, `packages/opencode`: product adapters and observability only; lifecycle truth stays in Core.

---

### Task 1: Freeze the Baseline and Add Per-Session Engine Routing

**Files:**

- Modify: `packages/schema/src/session.ts`
- Modify: `packages/core/src/session/command.ts`
- Modify: `packages/core/src/session/info.ts`
- Modify: `packages/core/src/session/sql.ts`
- Create: `packages/core/src/database/migration/20260821010000_session_execution_engine.ts`
- Modify: `packages/core/src/database/migration.gen.ts`
- Create: `packages/core/src/session/execution/router.ts`
- Modify: `packages/core/src/session/execution.ts`
- Modify: `packages/core/src/session/execution/local.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Test: `packages/core/test/database-migration.test.ts`
- Test: `packages/core/test/session-create.test.ts`
- Create: `packages/core/test/session-execution-router.test.ts`
- Test: `packages/client/test/promise.test.ts`

**Interfaces:**

- Produces `Session.ExecutionEngine = "classic" | "kernel"` and `Session.Info.engine`.
- Produces `SessionCommand.CreateInput.engine?: ExecutionEngine`; omission resolves from one process-level new-Session default, initially `classic`.
- Produces `SessionExecutionRouter.Interface.resolve(sessionID): Effect<SessionExecution.Interface, SessionNotFoundError | KernelUnavailableError>`.
- Preserves `SessionExecution.Interface` for every existing caller; its facade resolves the stored engine before delegating each method.

- [ ] **Step 1: Write failing schema, migration, creation, and routing tests**

```ts
it.effect("stores an immutable execution engine and defaults existing rows to classic", () =>
  Effect.gen(function* () {
    const classic = yield* sessions.create({ location, id: Session.ID.make("ses_classic") })
    const kernel = yield* sessions.create({ location, id: Session.ID.make("ses_kernel"), engine: "kernel" })
    expect(classic.engine).toBe("classic")
    expect(kernel.engine).toBe("kernel")
    expect((yield* sessions.get(kernel.id)).engine).toBe("kernel")
  }),
)

it.effect("never falls back when a kernel engine is unavailable", () =>
  Effect.gen(function* () {
    const session = yield* sessions.create({ location, engine: "kernel" })
    const error = yield* execution.resume(session.id).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "KernelUnavailableError", sessionID: session.id })
    expect(classicResumeCalls).toBe(0)
  }),
)
```

- [ ] **Step 2: Run the tests and verify the missing engine/router behavior fails**

Run from `packages/core`:

```powershell
bun test test/database-migration.test.ts test/session-create.test.ts test/session-execution-router.test.ts
```

Expected: FAIL because `engine`, `KernelUnavailableError`, and router dispatch do not exist.

- [ ] **Step 3: Add the additive engine schema and router**

Use this public schema and stored default:

```ts
export const ExecutionEngine = Schema.Literals(["classic", "kernel"])
export type ExecutionEngine = typeof ExecutionEngine.Type

export class KernelUnavailableError extends Schema.TaggedErrorClass<KernelUnavailableError>()(
  "KernelUnavailableError",
  { sessionID: Session.ID },
) {}

export const Info = Schema.Struct({
  // existing fields stay unchanged
  engine: ExecutionEngine,
})
```

The migration adds `session.engine TEXT NOT NULL DEFAULT 'classic'`. Creation writes the resolved value once. Do not add an update endpoint for `engine`.

The routing facade keeps the current method vocabulary:

```ts
export interface Interface {
  readonly resolve: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionExecution.Interface, SessionV2.NotFoundError | KernelUnavailableError>
}
```

`SessionExecution.Service` remains the dependency seen by callers; each call resolves the Session row and delegates to the matching implementation. `active` unions both engine snapshots. `kernel` resolution returns `KernelUnavailableError` until Task 3 installs the service.

- [ ] **Step 4: Expose explicit DEV/test creation without changing the production default**

Add optional `engine` to `POST /api/session` payload and pass it through the Server handler. Do not add a runtime engine-switch endpoint. Regenerate Client:

```powershell
cd packages/client
bun run generate
bun run check:generated
```

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test test/database-migration.test.ts test/session-create.test.ts test/session-execution-router.test.ts
bun typecheck
cd ../protocol
bun typecheck
cd ../server
bun typecheck
cd ../client
bun test
bun typecheck
git add packages/schema packages/core packages/protocol packages/server packages/client
git commit -m "feat(core): route sessions by execution engine"
```

### Task 2: Add Atomic EventV2 Batches

**Files:**

- Modify: `packages/core/src/event.ts`
- Modify: `packages/core/src/event/sql.ts`
- Create: `packages/core/test/event-batch.test.ts`
- Modify: `packages/core/test/event.test.ts`
- Modify: `packages/core/test/event-concurrency.test.ts`

**Interfaces:**

- Consumes existing `EventV2.Definition`, `Data<D>`, `Payload<D>`, projectors, expected aggregate sequence, and local commit hooks.
- Produces `EventV2.BatchItem`, `PublishBatchOptions`, and `Interface.publishBatch`.
- Existing `publish` becomes a one-item wrapper over `publishBatch` with identical external behavior.

- [ ] **Step 1: Write failure-injection tests for every atomicity boundary**

```ts
it.effect("rolls back events, sequence, projectors, and local coordination together", () =>
  Effect.gen(function* () {
    const exit = yield* events.publishBatch({
      aggregateID,
      expectedSeq: 0,
      events: [
        { definition: First, data: { aggregateID, value: 1 } },
        { definition: Second, data: { aggregateID, value: 2 } },
      ],
      commit: () => Effect.fail(new Error("injected commit failure")),
    }).pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
    expect(yield* EventV2.latestSequence(aggregateID)).toBe(0)
    expect(yield* readProjectedRows(aggregateID)).toEqual([])
  }),
)

it.effect("delivers a committed batch in order and wakes a durable subscriber once", () =>
  Effect.gen(function* () {
    const delivered = yield* publishAndCollectBatch()
    expect(delivered.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(durableWakeCount).toBe(1)
  }),
)
```

Cover ID duplication, Schema encoding failure, mixed aggregate IDs, stale `expectedSeq`, projector failure at item N, listener ordering, and a one-event `publish` parity case.

- [ ] **Step 2: Run the new tests and verify partial writes are observable before implementation**

```powershell
cd packages/core
bun test test/event-batch.test.ts test/event.test.ts test/event-concurrency.test.ts
```

Expected: FAIL because `publishBatch` is absent.

- [ ] **Step 3: Implement the typed batch contract**

```ts
export interface BatchItem<D extends Definition = Definition> {
  readonly definition: D
  readonly data: Data<D>
  readonly id?: ID
  readonly metadata?: Record<string, unknown>
}

export interface PublishBatchOptions {
  readonly aggregateID: string
  readonly expectedSeq?: number
  readonly location?: Location.Ref
  readonly events: readonly BatchItem[]
  readonly commit?: (result: {
    readonly firstSeq: number
    readonly finalSeq: number
    readonly events: readonly Payload[]
  }) => Effect.Effect<void>
}
```

Validate and encode all items before opening the transaction. Inside one transaction, check sequence once, allocate contiguous sequence numbers, insert and project in array order, run `commit`, and advance `event_sequence` to `finalSeq`. After commit, publish typed/all listeners in order and signal each durable aggregate subscriber once.

- [ ] **Step 4: Route the single-event API through the batch path**

Keep `replaceAggregate` isolated to single-event `publish`; reject it from multi-event batches. Preserve current typed errors and metadata. Add an assertion that transient definitions cannot enter a durable batch.

- [ ] **Step 5: Run Core gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/event-batch.test.ts test/event.test.ts test/event-concurrency.test.ts
bun typecheck
git add packages/core/src/event.ts packages/core/src/event/sql.ts packages/core/test/event-batch.test.ts packages/core/test/event.test.ts packages/core/test/event-concurrency.test.ts
git commit -m "feat(core): publish atomic event batches"
```

### Task 3: Add Kernel Coordination State, Lease Fencing, and LifecycleStore

**Files:**

- Modify: `packages/core/src/session/sql.ts`
- Create: `packages/core/src/database/migration/20260821020000_session_execution.ts`
- Modify: `packages/core/src/database/migration.gen.ts`
- Modify: `packages/schema/src/session-event.ts`
- Create: `packages/core/src/session/kernel/types.ts`
- Create: `packages/core/src/session/kernel/lifecycle-store.ts`
- Create: `packages/core/src/session/kernel/index.ts`
- Modify: `packages/core/src/session/execution/router.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/input.ts`
- Create: `packages/core/test/session-kernel-lifecycle-store.test.ts`
- Modify: `packages/core/test/session-projector.test.ts`
- Modify: `packages/core/test/database-migration.test.ts`

**Interfaces:**

- Consumes `EventV2.publishBatch`, `SessionInputTable`, shared TaskSubmission/outbox tables, and Kernel Session engine identity.
- Produces `ExecutionLease`, `ExecutionSnapshot`, `StaleExecutionError`, `InvariantError`, and `LifecycleStore.Interface`.
- Produces durable `SessionEvent.Input.Terminalized` and same-transaction projector behavior.

- [ ] **Step 1: Write failing migration, lease CAS, start, terminal, and stale-callback tests**

```ts
it.effect("atomically starts one kernel turn and fences the loser", () =>
  Effect.gen(function* () {
    const [left, right] = yield* Effect.all(
      [store.start(startInput).pipe(Effect.exit), store.start(startInput).pipe(Effect.exit)],
      { concurrency: "unbounded" },
    )
    expect([left, right].filter(Exit.isSuccess)).toHaveLength(1)
    const snapshot = yield* store.get(sessionID)
    expect(snapshot.state).toBe("active")
    expect(snapshot.phase).toBe("dispatching")
    expect(yield* durableTypes(sessionID)).toEqual([
      "session.next.prompted.1",
      "session.next.turn.started.1",
      "session.next.provider.attempt.started.1",
    ])
  }),
)

it.effect("rejects every commit made with a fenced lease", () =>
  Effect.gen(function* () {
    const lease = yield* store.start(startInput)
    yield* store.acceptInterrupt({ sessionID, expectedGeneration: lease.generation })
    const error = yield* store.checkpoint({ lease, events: [] }).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "StaleExecutionError" })
  }),
)
```

Also assert: idle rows have null identity fields; active rows have all identities; batch failure leaves generation unchanged; input promotes and terminalizes once; repeated terminal/interrupt calls are idempotent.

- [ ] **Step 2: Run tests and verify the missing table/store fails**

```powershell
cd packages/core
bun test test/database-migration.test.ts test/session-kernel-lifecycle-store.test.ts test/session-projector.test.ts
```

- [ ] **Step 3: Add `session_execution` and typed snapshots**

Create exactly the spec columns with snake_case Drizzle fields. Initial Kernel rows use generation `0`, `state: "idle"`, and null lease/identity/phase/retry/recovery/sequence fields.

```ts
export interface ExecutionLease {
  readonly sessionID: SessionSchema.ID
  readonly generation: number
  readonly token: string
}

export type ExecutionState = "idle" | "active" | "retry_wait" | "needs_recovery" | "cancelling"
export type ExecutionPhase = "admitting" | "dispatching" | "responding" | "tools" | "compacting" | "settling"
export type TurnOutcome = "completed" | "error" | "cancelled" | "recovery-required"
export type InterruptReason = "user" | "shutdown" | "tree-cancel" | "recovery"
export type RecoveryReason =
  | "ownership-lost"
  | "provider-dispatch-ambiguous"
  | "mutation-outcome-unknown"
  | "question-disconnected"
  | "compaction-partial"
  | "shell-process-unknown"
  | "sequence-inconsistent"

export interface TaskTerminalMutation {
  readonly submissionID: string
  readonly outcome: TurnOutcome
  readonly resultMessageID?: SessionMessage.ID
}

export interface TaskNotificationMutation {
  readonly id: string
  readonly submissionID: string
  readonly parentSessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly wake: boolean
}

export interface StartInput {
  readonly sessionID: SessionSchema.ID
  readonly inputID: SessionMessage.ID
  readonly turnID: SessionMessage.ID
  readonly attemptID: EventV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly processIncarnation: string
}

export interface TransitionInput {
  readonly lease: ExecutionLease
  readonly expectedState: ExecutionState
  readonly state: ExecutionState
  readonly phase?: ExecutionPhase
  readonly retryAt?: DateTime.Utc
  readonly recoveryReason?: RecoveryReason
  readonly events: readonly EventV2.BatchItem[]
}

export interface CheckpointInput {
  readonly lease: ExecutionLease
  readonly events: readonly EventV2.BatchItem[]
}

export interface TerminalInput {
  readonly lease: ExecutionLease
  readonly outcome: TurnOutcome
  readonly resultMessageID?: SessionMessage.ID
  readonly error?: SessionEvent.ErrorInfo
  readonly task?: TaskTerminalMutation
  readonly outbox?: TaskNotificationMutation
}

export interface InterruptInput {
  readonly sessionID: SessionSchema.ID
  readonly expectedGeneration?: number
  readonly reason: InterruptReason
}
```

- [ ] **Step 4: Implement LifecycleStore as the sole writer**

```ts
export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ExecutionSnapshot, SessionNotFoundError>
  readonly start: (input: StartInput) => Effect.Effect<ExecutionLease, ConflictError | InvariantError>
  readonly transition: (input: TransitionInput) => Effect.Effect<ExecutionSnapshot, StaleExecutionError>
  readonly checkpoint: (input: CheckpointInput) => Effect.Effect<readonly EventV2.Payload[], StaleExecutionError>
  readonly terminalize: (input: TerminalInput) => Effect.Effect<ExecutionSnapshot, StaleExecutionError>
  readonly acceptInterrupt: (input: InterruptInput) => Effect.Effect<ExecutionSnapshot, PersistenceError>
}
```

Every mutating statement predicates on `session_id`, `generation`, `lease_token`, and expected state. Updating zero rows yields `StaleExecutionError`; callers never reacquire and continue the old operation.

Add `Input.Terminalized` to durable definitions and project `terminal_seq`, outcome, result ID, and error into the shared inbox in the same terminal batch.

- [ ] **Step 5: Install an inert Kernel service, run gates, and commit**

The Kernel service may create/read/fence execution rows but must reject provider work with `KernelUnavailableError` until Task 5.

```powershell
cd packages/core
bun test --timeout 30000 test/database-migration.test.ts test/session-kernel-lifecycle-store.test.ts test/session-projector.test.ts
bun typecheck
cd ../schema
bun typecheck
git add packages/schema packages/core
git commit -m "feat(core): fence durable kernel execution"
```

### Task 4: Add Recovery Planning, Fenced Recovery Application, and Derived Status

**Files:**

- Create: `packages/core/src/session/kernel/recovery-planner.ts`
- Create: `packages/core/src/session/kernel/recovery-executor.ts`
- Create: `packages/core/src/session/kernel/status-projector.ts`
- Modify: `packages/core/src/session/kernel/index.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Create: `packages/core/test/session-kernel-recovery.test.ts`
- Create: `packages/core/test/session-kernel-status.test.ts`
- Modify: `packages/core/test/session-execution-recovery.test.ts`

**Interfaces:**

- Consumes immutable execution snapshots, durable EventV2 history, projected messages/inputs/tasks/outbox, and process incarnation UUID.
- Produces `RecoveryPlan` without side effects and `RecoveryExecutor.apply(plan)` with generation/sequence revalidation.
- Produces transient status derived from execution/input facts; it never writes a second status truth.

- [ ] **Step 1: Write the recovery matrix and zero-provider-startup tests**

```ts
it.effect("classifies ambiguous dispatched work without running a provider", () =>
  Effect.gen(function* () {
    yield* seedExecution({ state: "active", phase: "responding", processIncarnation: oldProcess })
    const plan = yield* planner.plan(sessionID)
    expect(plan.classification).toBe("needs-user-decision")
    expect(providerCalls).toBe(0)
    expect(executionWrites).toBe(0)
  }),
)

it.effect("revalidates generation and sequence before applying a plan", () =>
  Effect.gen(function* () {
    const plan = yield* planner.plan(sessionID)
    yield* advanceAggregate(sessionID)
    const error = yield* executor.apply(plan).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "RecoveryPlanStaleError" })
  }),
)
```

Cover the five classifications, terminal evidence repair, undispatched eligibility, uncertain mutation, partial compaction, lost question, unknown shell process, and outbox-only repair.

- [ ] **Step 2: Run tests and verify recovery currently mutates/runs too early**

```powershell
cd packages/core
bun test test/session-kernel-recovery.test.ts test/session-kernel-status.test.ts test/session-execution-recovery.test.ts
```

- [ ] **Step 3: Implement read-only RecoveryPlanner and revalidating executor**

```ts
export interface RecoveryPlan {
  readonly sessionID: SessionSchema.ID
  readonly generation: number
  readonly latestSeq: number
  readonly classification:
    | "no-action"
    | "settle-from-durable-output"
    | "safe-to-resume"
    | "needs-user-decision"
    | "abandon"
  readonly evidence: RecoveryEvidence
  readonly actions: readonly RecoveryAction[]
}

export interface RecoveryEvidence {
  readonly execution: ExecutionSnapshot
  readonly latestSeq: number
  readonly durableTypes: readonly SessionEvent.Type[]
  readonly ownerPresent: boolean
  readonly projectedOutputComplete: boolean
  readonly uncertainMutation: boolean
}

export type RecoveryAction =
  | { readonly type: "terminalize-from-output"; readonly messageID: SessionMessage.ID }
  | { readonly type: "mark-recovery-required"; readonly reason: RecoveryReason }
  | { readonly type: "abandon"; readonly reason: RecoveryReason }
  | { readonly type: "repair-task"; readonly submissionID: string }
  | { readonly type: "repair-outbox"; readonly outboxID: string }
```

Startup obtains plans and may automatically apply only idempotent terminal/read-model reconciliation. It publishes recovery snapshots but never calls `resume`, `wake`, provider, tool, shell, compaction, or notification-as-turn.

- [ ] **Step 4: Derive status and keep it transient**

Map `(ExecutionSnapshot, pending inputs, live process ownership)` to `idle`, `busy(phase)`, `retry`, `cancelling`, or `recovery`. Remove Kernel writes to durable `SessionEvent.Status`; Classic may continue emitting it until Task 15. Expose the derived result through the existing `SessionV2.status` and V2 HTTP endpoint.

- [ ] **Step 5: Run gates, regenerate Client, and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-recovery.test.ts test/session-kernel-status.test.ts test/session-execution-recovery.test.ts
bun typecheck
cd ../client
bun run generate
bun run check:generated
bun test
git add packages/schema packages/core packages/protocol packages/server packages/client
git commit -m "feat(core): plan fenced kernel recovery"
```

### Task 5: Run a Minimal Provider Turn Through TurnCoordinator and PublicationActor

**Files:**

- Create: `packages/core/src/session/kernel/coordinator.ts`
- Create: `packages/core/src/session/kernel/publication-actor.ts`
- Create: `packages/core/src/session/kernel/provider-reader.ts`
- Modify: `packages/core/src/session/kernel/index.ts`
- Modify: `packages/core/src/session/execution/router.ts`
- Modify: `packages/core/src/session/runner/model.ts`
- Modify: `packages/core/src/session/runner/to-llm-message.ts`
- Modify: `packages/schema/src/session-event.ts`
- Create: `packages/core/test/session-kernel-provider.test.ts`
- Create: `packages/core/test/session-kernel-interrupt.test.ts`
- Create: `packages/core/test/fixtures/recordings/session-kernel/openai-chat-streams-text.json`

**Interfaces:**

- Consumes LifecycleStore, Session history lowering, SessionRunnerModel resolution, `LLMClient.Service`, and one `llm.stream(request)` per physical attempt.
- Produces one process-local coordinator actor per active Kernel Session and one bounded PublicationActor per turn.
- Supports text/reasoning without tools, provider terminal errors, bounded retry scheduling, accepted/terminal interrupt, and atomic terminal batches.

- [ ] **Step 1: Write recorded transport, provider error, retry, and interrupt-race tests**

```ts
it.effect("runs one no-tool kernel turn and atomically settles every identity", () =>
  Effect.gen(function* () {
    const session = yield* sessions.create({ location, engine: "kernel" })
    const input = yield* sessions.prompt({ sessionID: session.id, prompt, resume: false })
    yield* sessions.resume(session.id)
    const snapshot = yield* lifecycle.get(session.id)
    expect(snapshot.state).toBe("idle")
    expect(yield* terminalCounts(session.id, input.id)).toEqual({ input: 1, turn: 1, attempt: 1 })
    expect(yield* assistantText(session.id)).toBe("Hello!")
  }),
)

it.effect("durably fences before interrupt returns accepted", () =>
  Effect.gen(function* () {
    const before = yield* lifecycle.get(sessionID)
    yield* sessions.interrupt(sessionID)
    const accepted = yield* lifecycle.get(sessionID)
    expect(accepted.generation).toBe(before.generation + 1)
    expect(accepted.lease).toBeUndefined()
    yield* releaseLateProviderCallback()
    expect(yield* durableEventsAfter(sessionID, accepted.updatedSeq)).toEqual([])
  }),
)
```

Assert provider error before/after response start, retryable transport, authentication, context overflow classification, duplicate EOF, and prompt admitted during cancellation.

- [ ] **Step 2: Run tests and verify Kernel reports capability unavailable**

```powershell
cd packages/core
bun test test/session-kernel-provider.test.ts test/session-kernel-interrupt.test.ts
```

- [ ] **Step 3: Implement the coordinator and bounded actor**

```ts
export type PublicationCommand =
  | { readonly type: "provider-event"; readonly event: LLMEvent }
  | { readonly type: "barrier"; readonly reply: Deferred.Deferred<void> }
  | { readonly type: "interrupt"; readonly reason: InterruptReason }
  | { readonly type: "close"; readonly outcome: TurnOutcome }
```

`InterruptReason` and `TurnOutcome` come from `kernel/types.ts`; do not redefine protocol-specific copies in the actor.

Use a bounded FIFO of 256 commands. The provider reader only validates and forwards ordered protocol events. The actor owns assistant identity, fragments, attempt/step state, errors, and close state. Backpressure the reader at capacity; reject normal commands after interrupt; never cross an in-flight LifecycleStore transaction.

TurnCoordinator coalesces same-Session wakes, allows different Sessions concurrently, creates the cancellation scope, waits for actor barriers and terminal commit, and releases local ownership only after durable settlement.

- [ ] **Step 4: Implement accepted and terminal interrupt milestones**

`interrupt` first calls `LifecycleStore.acceptInterrupt`; only after its transaction commits does it signal the coordinator/actor/provider scope. Terminal settlement closes partial content, settles step/attempt/turn/input exactly once, clears the execution row, and publishes derived status. Repeated interrupt is a no-op after the same terminal outcome.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-provider.test.ts test/session-kernel-interrupt.test.ts test/session-runner-model.test.ts test/session-runner-message.test.ts
bun typecheck
git add packages/schema packages/core
git commit -m "feat(core): run fenced kernel provider turns"
```

### Task 6: Add Durable Streaming Checkpoints and Reconnect Hydration

**Files:**

- Modify: `packages/schema/src/session-event.ts`
- Create: `packages/core/src/session/kernel/checkpoint.ts`
- Modify: `packages/core/src/session/kernel/publication-actor.ts`
- Modify: `packages/core/src/session/projector.ts`
- Modify: `packages/core/src/session/message-updater.ts`
- Modify: `packages/app/src/context/server-session-v2-reducer.ts`
- Modify: `packages/app/src/pages/session/timeline/projection.ts`
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Create: `packages/core/test/session-kernel-checkpoint.test.ts`
- Modify: `packages/core/test/session-projector.test.ts`
- Modify: `packages/app/src/context/server-session-v2-reducer.test.ts`
- Modify: `packages/app/src/pages/session/timeline/projection.test.ts`

**Interfaces:**

- Consumes PublicationActor fragments and LifecycleStore fenced batch writes.
- Produces durable `Text.Checkpoint`, `Reasoning.Checkpoint`, and `ToolInput.Checkpoint` facts containing only content since the previous checkpoint.
- Preserves transient live deltas; final `Ended` events remain authoritative.

- [ ] **Step 1: Write threshold, flush, replay, and stale-checkpoint tests**

```ts
it.effect("checkpoints at 250ms or 8KiB and flushes before terminal close", () =>
  Effect.gen(function* () {
    yield* actor.offer(textDelta("a".repeat(8192)))
    yield* actor.offer(textDelta("tail"))
    yield* actor.barrier
    expect(yield* checkpointChunks(sessionID)).toEqual(["a".repeat(8192), "tail"])
    expect(yield* projectedText(sessionID)).toBe("a".repeat(8192) + "tail")
  }),
)

it.effect("rejects a checkpoint emitted by a fenced generation", () =>
  Effect.gen(function* () {
    const lease = yield* activeLease(sessionID)
    yield* interrupt(sessionID)
    const error = yield* checkpoint.flush(lease).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "StaleExecutionError" })
  }),
)
```

- [ ] **Step 2: Run tests and verify reconnect loses nonterminal content**

```powershell
cd packages/core
bun test test/session-kernel-checkpoint.test.ts test/session-projector.test.ts
cd ../app
bun test src/context/server-session-v2-reducer.test.ts src/pages/session/timeline/projection.test.ts --preload ./happydom.ts --conditions=browser
```

- [ ] **Step 3: Implement checkpoint buffering and event schemas**

```ts
export interface CheckpointPolicy {
  readonly interval: Duration.DurationInput // 250 millis
  readonly bytes: number // 8192
}
```

Track UTF-8 bytes per open part/tool input. Flush on elapsed interval, byte threshold, part/tool boundary, actor barrier, interrupt, and close. Adjacent same-part deltas may coalesce before actor enqueue; durable boundary commands may not be dropped.

- [ ] **Step 4: Project checkpoints and hydrate every UI from canonical history**

Project chunks idempotently by event ID/sequence and append only to the matching open part. Ignore late checkpoints after an `Ended` event. The App and Session UI reducers must render hydrated partial text/reasoning/tool input after reconnect without inventing an active provider attempt.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-checkpoint.test.ts test/session-projector.test.ts
bun typecheck
cd ../app
bun run test
bun typecheck
cd ../session-ui
bun run test
bun typecheck
git add packages/schema packages/core packages/app packages/session-ui
git commit -m "feat(core): checkpoint kernel streams"
```

### Task 7: Add Ordered Prepare, Bounded Tool Dispatch, and Ordered Finalization

**Files:**

- Create: `packages/core/src/session/kernel/tool-scheduler.ts`
- Modify: `packages/core/src/session/kernel/publication-actor.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/core/src/tool/tool.ts`
- Modify: `packages/core/src/tool-output-store.ts`
- Modify: `packages/schema/src/session-event.ts`
- Create: `packages/core/test/session-kernel-tool-scheduler.test.ts`
- Create: `packages/core/test/session-kernel-tool-faults.test.ts`
- Modify: `packages/core/test/session-runner-tool-registry.test.ts`
- Modify: `packages/core/test/tool-output-store.test.ts`

**Interfaces:**

- Consumes collected provider tool calls, immutable ToolRegistry materialization, PermissionV2, plugin hooks, ToolOutputStore, and PublicationActor commands.
- Produces `PreparedToolCall`, `ToolConcurrency = "parallel" | "exclusive"`, and index-addressed `ToolSettlement` slots.
- Maximum active bodies is 10; default/unknown/MCP-without-declaration is exclusive; finalize commits only the contiguous settled prefix.

- [ ] **Step 1: Write deterministic ordering, exclusivity, error, and abort tests**

```ts
it.effect("runs parallel bodies concurrently but commits results in model order", () =>
  Effect.gen(function* () {
    const run = yield* scheduler.run([slowCall(0), fastCall(1), fastCall(2)])
    yield* fastCallsComplete
    expect(yield* committedIndexes).toEqual([])
    yield* slowCallCompletes
    expect(yield* run).toEqual([settlement(0), settlement(1), settlement(2)])
    expect(yield* committedIndexes).toEqual([0, 1, 2])
  }),
)

it.effect("drains parallel work around an exclusive call", () =>
  Effect.gen(function* () {
    yield* scheduler.run([parallel(0), exclusive(1), parallel(2)])
    expect(noOverlapWith(1)(executionWindows)).toBe(true)
  }),
)
```

Cover schema failure, denied permission, normal tool failure as model-visible result, post-hook failure, retention failure, stale catalog identity, stale lease, ten-body cap, never-started cancellation, active non-cooperative abandonment, and duplicate late completion.

- [ ] **Step 2: Run tests and verify the Classic eager tool loop cannot satisfy them**

```powershell
cd packages/core
bun test test/session-kernel-tool-scheduler.test.ts test/session-kernel-tool-faults.test.ts
```

- [ ] **Step 3: Implement ordered prepare and monotonic concurrency policy**

```ts
export type ToolConcurrency = "parallel" | "exclusive"

export interface PreparedToolCall {
  readonly index: number
  readonly call: ToolCall
  readonly settle: ToolRegistry.Materialization["settle"]
  readonly concurrency: ToolConcurrency
  readonly deadline: DateTime.Utc
}

export interface ToolSettlement {
  readonly index: number
  readonly callID: string
  readonly outcome: "success" | "error" | "cancelled" | "abandoned"
  readonly result?: ToolRegistry.Settlement
  readonly error?: Tool.Failure
}
```

Prepare performs identity lookup, input decoding, exposure snapshot validation, permission, plugin policy, sandbox plan, approval, deadline, and classification in model order. Plugins may change `parallel` to `exclusive`, never the reverse.

- [ ] **Step 4: Implement the rolling pool and head-of-line finalizer**

Collect every call before dispatch. Replenish at most ten parallel bodies. Before an exclusive body, stop replenishing and await all active bodies; run it alone. Finalize in index order: post hooks, normalized output, retention/spill, content validation, lifecycle events, task updates, and additional context. Only corruption, ordering/identity violation, stale lease, projector failure, and persistence failure terminate Kernel.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-tool-scheduler.test.ts test/session-kernel-tool-faults.test.ts test/session-runner-tool-registry.test.ts test/tool-output-store.test.ts
bun typecheck
git add packages/schema packages/core
git commit -m "feat(core): schedule ordered kernel tools"
```

### Task 8: Integrate Shell Cancellation and Durable Background Ownership

**Files:**

- Modify: `packages/core/src/session/kernel/tool-scheduler.ts`
- Modify: `packages/core/src/background-job.ts`
- Modify: `packages/core/src/tool/bash.ts`
- Modify: `packages/core/src/tool/get-task-output.ts`
- Modify: `packages/core/src/tool/stop-task.ts`
- Modify: `packages/core/src/session/shell.ts`
- Modify: `packages/session-ui/src/components/session-turn.tsx`
- Modify: `packages/app/src/pages/session/timeline/rows.ts`
- Modify: `packages/desktop/src/main/sidecar.ts`
- Create: `packages/core/test/session-kernel-shell.test.ts`
- Modify: `packages/core/test/tool-bash.test.ts`
- Modify: `packages/core/test/background-job.test.ts`
- Create: `packages/desktop/src/main/kernel-shell-smoke.test.ts`

**Interfaces:**

- Consumes the existing BackgroundJob service and Bash process/output contract.
- Produces ownership transfer that terminalizes the foreground tool with a task ID while the OS process continues under BackgroundJob.
- Turn interrupt never cancels a transferred job; `stop_task` and explicit tree/shutdown policy do.

- [ ] **Step 1: Write real Windows and deterministic ownership tests**

```ts
it.effect("transfers a three-minute foreground shell without killing it", () =>
  Effect.gen(function* () {
    const call = yield* startForegroundShell(longCommand)
    yield* TestClock.adjust(Duration.minutes(3))
    const result = yield* call
    expect(result.taskID).toMatch(/^shell_/)
    expect(yield* background.get(result.taskID)).toMatchObject({ status: "running" })
    expect(processWasKilled).toBe(false)
  }),
)

it.effect("fences already-aborted and running process cancellation on Windows", () =>
  Effect.gen(function* () {
    expect(Exit.isFailure(yield* runAlreadyAborted().pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* abortRunningChild().pipe(Effect.exit))).toBe(true)
    expect(yield* childStillRunning).toBe(false)
  }),
)
```

- [ ] **Step 2: Run tests and verify both cancellation timing cases are covered**

```powershell
cd packages/core
bun test test/session-kernel-shell.test.ts test/tool-bash.test.ts test/background-job.test.ts
cd ../desktop
bun test src/main/kernel-shell-smoke.test.ts
```

- [ ] **Step 3: Attach process ownership to BackgroundJob, not the foreground waiter**

The Bash body publishes a job before process start, observes the process under the job scope, and lets the tool waiter race completion against auto/manual promotion. Promotion atomically changes ownership, returns the durable task ID, and prevents turn cancellation from reaching the process controller.

- [ ] **Step 4: Wire manual background and stop actions across App/Desktop**

Keep the existing shell-row action, but make it invoke the Kernel ownership transition and update from canonical BackgroundJob status. `get_task_output` reads live owned output and durable terminal state; `stop_task` terminates the owned process idempotently. A steer never calls shell abort.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-shell.test.ts test/tool-bash.test.ts test/background-job.test.ts test/tool-get-task-output.test.ts test/tool-stop-task.test.ts
bun typecheck
cd ../session-ui
bun run test
cd ../desktop
bun test
bun typecheck
git add packages/core packages/app packages/session-ui packages/desktop
git commit -m "feat(core): transfer kernel shells to background"
```

### Task 9: Make Compaction an Explicit Fenced Kernel Phase

**Files:**

- Modify: `packages/core/src/session/compaction.ts`
- Modify: `packages/core/src/session/kernel/publication-actor.ts`
- Modify: `packages/core/src/session/kernel/lifecycle-store.ts`
- Modify: `packages/core/src/session/kernel/coordinator.ts`
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/app/src/components/status-popover-body.tsx`
- Modify: `packages/app/src/pages/session/composer/session-composer-controls.ts`
- Create: `packages/core/test/session-kernel-compaction.test.ts`
- Modify: `packages/core/test/session-compaction.test.ts`
- Modify: `packages/core/test/session-compact.test.ts`
- Modify: `packages/app/src/components/status-popover-indicator.test.ts`

**Interfaces:**

- Consumes current Kernel lease, compaction policy, summary model, checkpoint flow, and projected history reload.
- Produces explicit `compacting` phase and durable Started/Ended/Failed facts; partial summaries never become context.

- [ ] **Step 1: Write success, interruption, overflow, and process-loss tests**

```ts
it.effect("reloads durable history after a completed fenced compaction", () =>
  Effect.gen(function* () {
    yield* kernel.compact({ sessionID, reason: "auto" })
    const history = yield* phaseHistory(sessionID)
    expect(history).toContain("compacting")
    expect(history).toContain("dispatching")
    expect(yield* nextProviderHistory(sessionID)).toEqual(yield* projectedCompactedHistory(sessionID))
  }),
)

it.effect("keeps original context authoritative after process loss", () =>
  Effect.gen(function* () {
    yield* seedPartialCompaction(sessionID)
    const plan = yield* recovery.plan(sessionID)
    expect(plan.classification).toBe("needs-user-decision")
    expect(yield* activeContext(sessionID)).toEqual(originalContext)
  }),
)
```

- [ ] **Step 2: Run tests and verify current compaction is not a Kernel phase**

```powershell
cd packages/core
bun test test/session-kernel-compaction.test.ts test/session-compaction.test.ts test/session-compact.test.ts
```

- [ ] **Step 3: Implement fenced compaction lifecycle**

Transition to `compacting`, publish Started, stream summary through the actor checkpoint policy, and publish Ended or Failed. Barrier and reload projected history before returning to `dispatching`. Context overflow may force one compaction; a second overflow terminates with the typed original provider error.

- [ ] **Step 4: Expose the phase without collapsing it into generic thinking**

App status must distinguish provider response, tools, compaction, retry wait, cancellation, and recovery. Stop during compaction uses the same durable interrupt fence and three-second terminal budget.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-compaction.test.ts test/session-compaction.test.ts test/session-compact.test.ts
bun typecheck
cd ../app
bun run test
bun typecheck
git add packages/schema packages/core packages/app
git commit -m "feat(core): fence kernel compaction"
```

### Task 10: Move Steer, Queue, Follow-up, Question, and Notification Boundaries into Kernel

**Files:**

- Modify: `packages/core/src/session/input.ts`
- Modify: `packages/core/src/session/kernel/coordinator.ts`
- Modify: `packages/core/src/session/kernel/lifecycle-store.ts`
- Modify: `packages/core/src/session/kernel/publication-actor.ts`
- Modify: `packages/core/src/tool/question.ts`
- Modify: `packages/core/src/question.ts`
- Modify: `packages/core/src/session/task-notification.ts`
- Modify: `packages/app/src/pages/session/composer/session-followup-state.ts`
- Modify: `packages/app/src/pages/session/composer/session-composer-state.ts`
- Create: `packages/core/test/session-kernel-input-delivery.test.ts`
- Create: `packages/core/test/session-kernel-question.test.ts`
- Modify: `packages/core/test/session-input.test.ts`
- Modify: `packages/core/test/session-task-notification.test.ts`
- Modify: `packages/app/src/pages/session/composer/session-followup-state.test.ts`

**Interfaces:**

- Consumes shared durable inbox order, actor barriers, tool-result commit cursor, compaction completion, and question request identity.
- Produces exact idle/steer/queue semantics plus `send_message` quiet delivery and `followup_task` waking delivery.
- A new prompt after a completed turn always acquires a new generation/turn; notifications never replace an active turn owner.

- [ ] **Step 1: Write delivery and race tests before changing orchestration**

```ts
it.effect("does not attach a post-completion prompt to the previous answer", () =>
  Effect.gen(function* () {
    const first = yield* completedTurn(sessionID)
    const next = yield* sessions.prompt({ sessionID, prompt: nextPrompt })
    yield* sessions.wait(sessionID)
    expect(yield* inputTurn(next.id)).not.toBe(first.turnID)
    expect(yield* terminalCounts(sessionID, next.id)).toEqual({ input: 1, turn: 1, attempt: 1 })
  }),
)

it.effect("admits a prompt during cancellation but never routes it to the old actor", () =>
  Effect.gen(function* () {
    const oldLease = yield* activeLease(sessionID)
    const [_, admitted] = yield* Effect.all([
      sessions.interrupt(sessionID),
      sessions.prompt({ sessionID, prompt: nextPrompt }),
    ])
    expect(yield* promotedByGeneration(admitted.id)).not.toBe(oldLease.generation)
  }),
)
```

Cover steer batching and one allowance reset, queue FIFO one-at-a-time, startup ignoring unpromoted queues, quiet delivery without wake, waking delivery only at idle/safe boundary, active/idle parent notification, stale question reply, and question interrupt terminalizing every lifecycle fact.

- [ ] **Step 2: Run delivery tests and confirm current cross-boundary assumptions fail**

```powershell
cd packages/core
bun test test/session-kernel-input-delivery.test.ts test/session-kernel-question.test.ts test/session-input.test.ts test/session-task-notification.test.ts
```

- [ ] **Step 3: Promote inputs only through LifecycleStore safe-boundary batches**

At a safe boundary require provider barrier, contiguous tool result commit, completed compaction, and position immediately before the next provider request. Promote admitted steers in order as one batch and reset step allowance once. When otherwise idle, promote exactly one queued input and re-evaluate continuation.

- [ ] **Step 4: Separate delivery from wake and bind questions to generation**

Persist mailbox/outbox delivery independently from a wake request. A wake creates no turn until the target is idle or safely fenced. Bind Question requests to `{ sessionID, generation, requestID, toolCallID }`; stale replies fail with a typed error. Interrupt settles Question, Tool, Step, Attempt, Turn, and Input in one terminal batch.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-input-delivery.test.ts test/session-kernel-question.test.ts test/session-input.test.ts test/session-task-notification.test.ts
bun typecheck
cd ../app
bun test src/pages/session/composer/session-followup-state.test.ts src/pages/session/composer/session-composer-state.test.ts --preload ./happydom.ts --conditions=browser
bun typecheck
git add packages/core packages/app
git commit -m "feat(core): route kernel input boundaries"
```

### Task 11: Run Subagents as Independent Kernel Sessions

**Files:**

- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/session/task-notification.ts`
- Modify: `packages/core/src/session/task-cancellation.ts`
- Modify: `packages/core/src/session/subagent-permit.ts`
- Modify: `packages/core/src/session/kernel/recovery-planner.ts`
- Modify: `packages/core/src/session/kernel/recovery-executor.ts`
- Modify: `packages/core/src/tool/get-task-output.ts`
- Create: `packages/core/test/session-kernel-subagent.test.ts`
- Create: `packages/core/test/session-kernel-subagent-restart.test.ts`
- Modify: `packages/core/test/session-task-submission.test.ts`
- Modify: `packages/core/test/session-task-cancellation.test.ts`
- Modify: `packages/core/test/session-subagent-loop.test.ts`

**Interfaces:**

- Consumes Kernel Session creation, per-Session execution rows, durable TaskSubmission/outbox, BackgroundJob observation, and bounded subagent permits.
- Produces independent child leases, actors, compaction, tools, and recovery; parent/child share no mutable publisher or cancellation controller.

- [ ] **Step 1: Write independent ownership, restart, notification, and tree-cancel tests**

```ts
it.effect("gives parent and child independent generations and leases", () =>
  Effect.gen(function* () {
    const submission = yield* startChild(parentID)
    const parent = yield* lifecycle.get(parentID)
    const child = yield* lifecycle.get(submission.childSessionID)
    expect(child.lease?.token).not.toBe(parent.lease?.token)
    expect(child.turnID).not.toBe(parent.turnID)
  }),
)

it.effect("reconciles completion after restart without replaying provider work", () =>
  Effect.gen(function* () {
    yield* seedCompletedChildWithUndeliveredOutbox()
    const plan = yield* recovery.plan(childID)
    yield* recoveryExecutor.apply(plan)
    expect(providerCalls).toBe(0)
    expect(yield* deliveredNotificationCount(submissionID)).toBe(1)
  }),
)
```

Cover foreground/background task, explicit promotion, same-invocation adoption, model override, depth/concurrency rejection, two child completions, parent active/idle delivery, cancellation tree, child terminalization after parent cancel, and interrupted/ambiguous child attempts.

- [ ] **Step 2: Run tests and verify current child lifecycle still depends on Classic coordination**

```powershell
cd packages/core
bun test test/session-kernel-subagent.test.ts test/session-kernel-subagent-restart.test.ts test/session-task-submission.test.ts test/session-task-cancellation.test.ts test/session-subagent-loop.test.ts
```

- [ ] **Step 3: Create children with `engine: "kernel"` and independent ownership**

Kernel parents create Kernel children. TaskSubmission creation, child input admission, and requested completion-delivery identity remain idempotent. Foreground waits observe the child; they do not own its drain. Background mode returns after durable admission.

- [ ] **Step 4: Atomically terminalize submissions and create outbox entries**

Child terminal commit updates TaskSubmission and creates one outbox row in the same LifecycleStore transaction. Delivery acknowledgment and wake are separate. Tree cancellation requests each child interrupt, then waits for each child to terminalize through its own Kernel.

- [ ] **Step 5: Run gates and commit**

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-subagent.test.ts test/session-kernel-subagent-restart.test.ts test/session-task-submission.test.ts test/session-task-cancellation.test.ts test/session-subagent-loop.test.ts test/tool-task.test.ts test/tool-get-task-output.test.ts
bun typecheck
git add packages/core
git commit -m "feat(core): run subagents on kernel sessions"
```

### Task 12: Add the Scoped Kernel Plugin and Capability Host

**Files:**

- Modify: `packages/schema/src/plugin.ts`
- Create: `packages/core/src/session/kernel/plugin-host.ts`
- Modify: `packages/core/src/plugin.ts`
- Modify: `packages/core/src/plugin/host.ts`
- Modify: `packages/core/src/plugin/runtime.ts`
- Modify: `packages/core/src/plugin/internal.ts`
- Modify: `packages/core/src/tool/registry.ts`
- Modify: `packages/opencode/src/plugin/index.ts`
- Modify: `packages/opencode/src/plugin/loader.ts`
- Modify: `packages/opencode/src/plugin/marketplace-runtime.ts`
- Create: `packages/core/test/session-kernel-plugin-host.test.ts`
- Modify: `packages/core/test/plugin.test.ts`
- Modify: `packages/core/test/plugin-runtime.test.ts`
- Modify: `packages/opencode/test/plugin/loader-shared.test.ts`

**Interfaces:**

- Consumes existing V2 registries and Effect scopes.
- Produces `PluginManifest`, `PluginModule.mount`, activation states, declared permissions/runtime class, and exact Kernel seams.
- Mount returns structured contributions and never mutates Config or raw lifecycle state.

- [ ] **Step 1: Write manifest, dependency, disposal, generation-fence, and policy tests**

```ts
it.effect("waits for required services and removes every owned contribution on dispose", () =>
  Effect.gen(function* () {
    const activation = yield* plugins.install(moduleRequiring("mcp:test"))
    expect(yield* activation.state).toBe("waiting_dependency")
    yield* services.provide("mcp:test", service)
    expect(yield* activation.state).toBe("ready")
    yield* activation.dispose
    expect(yield* ownedContributions(activation.generation)).toEqual([])
  }),
)

it.effect("fences late async registration after disable", () =>
  Effect.gen(function* () {
    const activation = yield* plugins.install(lateRegisteringPlugin)
    yield* plugins.disable(activation.id)
    yield* releaseLateRegistration()
    expect(yield* toolCatalog()).not.toContain("late_tool")
  }),
)
```

Cover eight-second mount deadline, five-second disposal deadline, dependency disappearance/reappearance, group isolation, observational hook failure isolation, deny-monotonic policy, immutable transform validation, around-hook at-most-once `next`, permission denial, and missing raw lease/SQL capabilities.

- [ ] **Step 2: Run tests and verify existing generic hooks lack manifest ownership**

```powershell
cd packages/core
bun test test/session-kernel-plugin-host.test.ts test/plugin.test.ts test/plugin-runtime.test.ts
cd ../opencode
bun test test/plugin/loader-shared.test.ts
```

- [ ] **Step 3: Add manifest and structured contribution types**

```ts
export interface PluginManifest {
  readonly id: Plugin.ID
  readonly version: string
  readonly targets: readonly PluginTarget[]
  readonly requires: readonly ServiceRequirement[]
  readonly capabilities: readonly PluginCapability[]
  readonly permissions: readonly PluginPermission[]
  readonly runtime: "trusted-in-process" | "isolated-worker" | "external"
}

export type PluginTarget = "core" | "desktop" | "web" | "tui" | "cli" | "acp"

export interface ServiceRequirement {
  readonly id: string
  readonly optional?: boolean
}

export type PluginCapability =
  | "service"
  | "tool"
  | "hook"
  | "command"
  | "skill"
  | "agent"
  | "mcp"
  | "lsp"
  | "ui"

export type PluginPermission =
  | "session.history.read"
  | "session.metadata.read"
  | "session.context.transform"
  | "tool.register"
  | "tool.exposure.transform"
  | "tool.policy"
  | "tool.execute.wrap"
  | "filesystem.read"
  | "filesystem.write"
  | "process.spawn"
  | "network.request"
  | "credential.use"
  | "credential.read"
  | "provider.transform"
  | "mcp.manage"
  | "lsp.manage"
  | "background-job.manage"
  | "ui.command.register"
  | "ui.panel.register"

export type PluginActivationState =
  | "disabled"
  | "resolving"
  | "waiting_dependency"
  | "activating"
  | "ready"
  | "degraded"
  | "failed"
  | "disposing"

export interface PluginModule {
  readonly manifest: PluginManifest
  readonly mount: (
    context: PluginContext,
  ) => Effect.Effect<PluginContribution, PluginActivationError, Scope.Scope>
}
```

Support services, tools, hooks, commands, skills, agents, MCP, LSP, and UI contributions. Registries record plugin ID/version/generation/Location/group. Disable/dispose atomically detaches every contribution before asynchronous finalizer reclamation.

- [ ] **Step 4: Implement exact Kernel seams and permission checks**

Expose the spec seams only: request transform, response/turn observation, tool exposure, tool prepare decision, tool dispatch around, tool finalize transform, compaction policy/summary, recovery advice, and status observation. Exposure chooses from approved ToolCatalog and cannot create executables or increase permissions. `credential.use` returns an opaque use capability; only explicit `credential.read` may reveal a value.

- [ ] **Step 5: Migrate official contributions, run gates, and commit**

Move official auth, model/search/exposure, compaction, guard, skill, command, and Marketplace registration to manifests/scopes. Keep author-format V1 adapters at the outer loader only; Kernel consumes no V1 projection.

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-plugin-host.test.ts test/plugin.test.ts test/plugin-runtime.test.ts test/tool-search-deferred.test.ts
bun typecheck
cd ../opencode
bun test test/plugin/loader-shared.test.ts test/plugin/runtime-readiness.test.ts
bun typecheck
git add packages/schema packages/core packages/opencode
git commit -m "feat(plugin): mount scoped kernel capabilities"
```

### Task 13: Add DEV Product Opt-in Across Desktop, Web, TUI, CLI, and ACP

**Files:**

- Modify: `packages/app/src/context/settings.tsx`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `packages/app/src/pages/new-session/new-session-view.tsx`
- Modify: `packages/app/src/components/status-popover-body.tsx`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/opencode/src/cli/cmd/run/session.shared.ts`
- Modify: `packages/opencode/src/cli/tui/validate-session.ts`
- Modify: `packages/opencode/src/acp/session.ts`
- Modify: `packages/protocol/src/groups/session.ts`
- Modify: `packages/server/src/handlers/session.ts`
- Create: `packages/app/src/pages/new-session/execution-engine.test.ts`
- Create: `packages/opencode/test/cli/run/kernel-session.test.ts`
- Create: `packages/opencode/test/acp/kernel-session.test.ts`
- Modify: `packages/desktop/src/renderer/initialization.test.ts`

**Interfaces:**

- Consumes optional create-time engine and derived phase/recovery status.
- Produces a DEV-only Classic/Kernel selector for newly created Sessions; production stays Classic-default in this task.
- Every product surface reads/writes only the canonical V2 API.

- [ ] **Step 1: Write cross-surface creation and unsupported-capability tests**

```ts
test("DEV creates a kernel session without changing an existing tab", async () => {
  settings.setNewSessionEngine("kernel")
  const created = await createNewSession()
  expect(created.engine).toBe("kernel")
  expect(existingSession.engine).toBe("classic")
})

test("production does not expose the engine selector", () => {
  expect(renderNewSession({ dev: false }).queryByText("Kernel")).toBeNull()
})
```

CLI, TUI, and ACP tests must create an explicit Kernel Session, send one recorded prompt, observe ordered events/status, interrupt, reconnect, and finish without importing Classic state.

- [ ] **Step 2: Run product tests and verify explicit Kernel selection is not wired**

```powershell
cd packages/app
bun test src/pages/new-session/execution-engine.test.ts --preload ./happydom.ts --conditions=browser
cd ../opencode
bun test test/cli/run/kernel-session.test.ts test/acp/kernel-session.test.ts
```

- [ ] **Step 3: Wire DEV selector and canonical phase UI**

Persist only the preference for future Session creation. Existing Sessions show their stored engine read-only. Status UI renders `dispatching`, `responding`, `tools`, `compacting`, `settling`, `retry_wait`, `cancelling`, and `needs_recovery`. Session-local persistence errors use the neutral toast and closable Error tab; only startup/router/database-wide failures use fatal UI.

- [ ] **Step 4: Exercise every surface and regenerate Client**

```powershell
cd packages/client
bun run generate
bun run check:generated
cd ../app
bun run test
cd ../desktop
bun test
cd ../opencode
bun test test/cli/run/kernel-session.test.ts test/acp/kernel-session.test.ts
```

- [ ] **Step 5: Typecheck and commit**

```powershell
cd packages/protocol
bun typecheck
cd ../server
bun typecheck
cd ../client
bun typecheck
cd ../app
bun typecheck
cd ../desktop
bun typecheck
cd ../opencode
bun typecheck
git add packages/protocol packages/server packages/client packages/app packages/desktop packages/opencode
git commit -m "feat(app): opt into kernel sessions in dev"
```

### Task 14: Add Shadow Contracts, Fault Injection, Long-run Gates, and Cutover Evidence

**Files:**

- Create: `packages/core/src/session/kernel/diagnostics.ts`
- Create: `packages/core/test/session-kernel-shadow.test.ts`
- Create: `packages/core/test/session-kernel-fault-matrix.test.ts`
- Create: `packages/core/test/session-kernel-long-run.test.ts`
- Create: `packages/opencode/test/cli/serve/kernel-restart.test.ts`
- Create: `packages/desktop/src/main/kernel-restart.test.ts`
- Modify: `packages/opencode/test/server/httpapi-exercise/options.ts`
- Modify: `packages/opencode/test/server/httpapi-exercise/index.ts`
- Modify: `packages/opencode/test/server/httpapi-exercise/report.ts`
- Create: `docs/kernel/999.0.20-observation-report.md`

**Interfaces:**

- Consumes recorded/mock provider events so Classic and Kernel can be compared without duplicating external side effects.
- Produces invariant counters, latency histograms, zero-startup-provider evidence, progress-visible/shardable HttpApi gates, and an observation report used by Task 15.

- [ ] **Step 1: Write the complete fault-matrix harness**

```ts
for (const point of [
  "before-start",
  "inside-start",
  "after-start",
  "after-provider-dispatch",
  "after-checkpoint",
  "during-question",
  "during-tool-dispatch",
  "during-tool-finalize",
  "inside-terminal-projector",
  "after-terminal-before-listener",
  "during-outbox",
  "during-compaction",
  "during-interrupt",
] as const) {
  test(`recovers without permanent busy or duplicate effects at ${point}`, async () => {
    const result = await runInjectedLoss(point)
    expect([
      "no-action",
      "settle-from-durable-output",
      "safe-to-resume",
      "needs-user-decision",
      "abandon",
    ].includes(result.classification)).toBe(true)
    expect(result.permanentBusy).toBe(false)
    expect(result.repeatedUncertainMutation).toBe(false)
  })
}
```

- [ ] **Step 2: Make verification observable and bounded before starting long runs**

Add `--progress`, `--shard-index`, and `--shard-count` to the HttpApi exerciser. Always print `RUN`, elapsed time, and a final summary; isolate coverage/auth/effect modes in separate processes. Add a watchdog that reports the current scenario before exiting. Repair the existing background-job test leak by ensuring every test scope closes all job extensions/fibers. Gate fsmonitor tests with a real capability probe, and make version tests assert the injected version instead of ambient process state.

- [ ] **Step 3: Run recorded shadow comparison and fault tests**

Compare normalized requests, event order, visible transcript, tool result order, terminal outcome, and status transitions. Exclude lease tokens, generation, checkpoint row packing, and timing from equality.

```powershell
cd packages/core
bun test --timeout 30000 test/session-kernel-shadow.test.ts test/session-kernel-fault-matrix.test.ts
```

- [ ] **Step 4: Run mandatory system and scale gates**

Run and record: real server restart; installed Desktop restart; Windows abort before/after spawn; long shell transfer; question interrupt; prompt during interrupt; provider output then transport loss; compaction loss; active/idle parent child completion; plugin late callback after disable/re-enable; OAuth failure without proxy; 1,000 scripted turns; 100 concurrent Sessions; ten parallel-safe calls; repeated interrupt/resume; large reasoning plus SQLite contention.

Acceptance values are exact:

```text
interrupt durable acceptance p95 <= 500ms under normal DB conditions
interrupt terminal p95 <= 3s without an external background job
checkpoint rate <= 4/s/active part outside boundaries
first live delta regression <= 10% versus Classic
startup root provider calls = 0
permanently pending plugins = 0
duplicate/missing terminal facts = 0
valid active leases per Session <= 1
```

Record every metric separately on Windows, Linux, and macOS. A platform without an executed gate is reported as missing evidence, not as a pass.

- [ ] **Step 5: Publish local evidence and commit**

The observation report records commands, OS, Bun/Node/Git versions, pass/fail/skip totals, latency percentiles, resource peaks, every known environment limitation, and the exact commit tested.

```powershell
git add packages/core packages/opencode packages/desktop docs/kernel/999.0.20-observation-report.md
git commit -m "test(core): gate durable kernel cutover"
```

### Task 15: Make Kernel Default and Delete Classic

**Files:**

- Modify: `packages/core/src/session/command.ts`
- Modify: `packages/core/src/session/execution.ts`
- Delete: `packages/core/src/session/execution/local.ts`
- Delete: `packages/core/src/session/turn.ts`
- Delete: `packages/core/src/session/attempt.ts`
- Modify: `packages/core/src/session/sql.ts`
- Create: `packages/core/src/database/migration/20260821030000_delete_classic_execution.ts`
- Modify: `packages/core/src/database/migration.gen.ts`
- Modify: `packages/schema/src/session.ts`
- Modify: `packages/schema/src/session-event.ts`
- Modify: `packages/app/src/context/settings.tsx`
- Modify: `packages/app/src/pages/new-session.tsx`
- Modify: `V1-to-V2-migration.md`
- Create: `packages/core/test/session-kernel-only.test.ts`
- Modify: `packages/core/test/v1-isolation.test.ts`
- Modify: `packages/opencode/test/cli/serve/serve-process.test.ts`

**Interfaces:**

- Consumes Task 14 evidence with every mandatory gate passing.
- Produces Kernel as the only execution engine and removes runtime selection/fallback.
- Classic Sessions become export/delete-only or hidden; no migration and no Classic execution path is retained.

- [ ] **Step 1: Write deletion and no-fallback tests before removing files**

```ts
it.effect("creates only kernel sessions and cannot resolve a classic runner", () =>
  Effect.gen(function* () {
    const session = yield* sessions.create({ location })
    expect(session.engine).toBe("kernel")
    expect(yield* runtimeSourceMatches("SessionExecutionLocal")).toEqual([])
  }),
)

it.effect("never executes an old classic session", () =>
  Effect.gen(function* () {
    const old = yield* seedClassicSession()
    const error = yield* sessions.resume(old.id).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "ClassicSessionUnavailableError" })
    expect(providerCalls).toBe(0)
  }),
)
```

- [ ] **Step 2: Require the observation report gate**

Do not proceed if any acceptance metric, platform cancellation gate, restart gate, terminal invariant, or product-surface gate is missing or failed. The agent must stop and report the exact failed gate rather than weakening the test.

- [ ] **Step 3: Switch the default, remove selector, and delete Classic wiring**

New Session creation always writes Kernel. Remove the DEV engine selector and engine router switch; keep a read-only engine field only if export/UI diagnostics still need it. Delete `SessionExecutionLocal`, Classic startup recovery/repair helpers, Classic-only Status writes, and any adapter that can run a Classic Session.

- [ ] **Step 4: Remove Classic coordination tables/events and prove zero runtime references**

Drop `session_turn` and `session_provider_attempt` or retain only a redesigned append-only attempt-history table that Kernel owns. Remove old mutable projectors and classic repair tests. Run:

```powershell
rg -n "SessionExecutionLocal|SessionTurn|SessionAttemptTable|SessionTurnTable|classic.*resume|engine.*classic" packages/core/src packages/server/src packages/opencode/src packages/app/src
```

Expected: no executable Classic runner, fallback, mutable coordination table, or selector reference. Explicit export/delete labeling for old rows may remain.

- [ ] **Step 5: Run every final gate, update migration status, and commit**

```powershell
cd packages/core
bun test --timeout 30000
bun typecheck
cd ../protocol
bun typecheck
cd ../server
bun typecheck
cd ../client
bun run generate
bun run check:generated
bun test
bun typecheck
cd ../opencode
bun run test:httpapi
bun typecheck
cd ../app
bun run test
bun typecheck
cd ../session-ui
bun run test
bun typecheck
cd ../desktop
bun test
bun typecheck
git add packages V1-to-V2-migration.md docs/kernel/999.0.20-observation-report.md
git commit -m "refactor(core): retire classic session execution"
```

## Spec Coverage Map

| Spec requirement | Implementing task |
|---|---|
| Product boundary and fixed per-Session engine | Task 1, Task 13, Task 15 |
| TurnCoordinator and single local owner | Task 5 |
| LifecycleStore, execution snapshot, generation, and lease | Task 3 |
| Atomic event batches and projector transaction | Task 2 |
| Prompt/turn/attempt/input terminal lifecycle | Task 3, Task 5, Task 10 |
| Retry, process incarnation, and conservative recovery | Task 4, Task 5 |
| PublicationActor and provider reader separation | Task 5 |
| Live deltas and durable checkpoints | Task 6 |
| Collect-before-dispatch, bounded tools, exclusivity, ordered results | Task 7 |
| Tool cancellation and shell background ownership | Task 8 |
| Steer, queue, quiet/waking delivery, and Question | Task 10 |
| Independent child kernels and notifications | Task 11 |
| Explicit compaction phase and context authority | Task 9 |
| Error policy and phase-aware product UI | Task 13 |
| Scoped plugin services, permissions, and Kernel seams | Task 12 |
| Fault matrix, acceptance budgets, and platform gates | Task 14 |
| Kernel default, Classic deletion, and no fallback | Task 15 |

## Final Review Checklist

- [ ] Every Session execution commit carries the current generation and opaque lease token.
- [ ] Atomic batch failure changes no event, sequence, read model, input/task/outbox row, or execution snapshot.
- [ ] Every promoted input, turn, physical attempt, and tool call has exactly one terminal outcome.
- [ ] Startup performs zero root provider calls and never promotes an unpromoted queue.
- [ ] Interrupt acceptance is durable before UI acknowledgment; late callbacks cannot commit.
- [ ] Tool bodies are bounded and may run concurrently, while policy and result commit remain ordered.
- [ ] Foreground shell transfer never kills the process and transferred jobs outlive turn interruption.
- [ ] Partial compaction never becomes model context; recovery never silently replays uncertain work.
- [ ] Parent and child Sessions have independent actors, leases, cancellation scopes, and recovery.
- [ ] Plugins are scoped, generation-fenced, permissioned, and excluded from raw lifecycle authority.
- [ ] Desktop, Web, TUI, CLI, ACP, SDK, Provider, Plugin, shell, compaction, and subagent gates run on Kernel.
- [ ] Classic cannot be selected, resolved, or invoked, and no hidden fallback remains.
- [ ] `docs/superpowers/handoffs/` remains untracked and uncommitted.
