# Event-Driven V2 Subagent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V2 subagent delegation event-driven on both Desktop and TUI: `task` spawns asynchronously by default, each durable child completion can wake the parent independently, explicit foreground dependencies remain supported, and `get_task_output` provides ownership-safe snapshots and bounded waits.

**Architecture:** Preserve the provider turn's all-local-tool settlement rule. Make each V2 `task` call settle immediately unless `background: false` is explicit. Persist whether completion belongs to the direct tool result or the parent notification channel, atomically migrate delivery when a foreground task is promoted, enrich the durable notification with the child Session ID, and let the existing `TaskNotification` → `SessionInput` → `SessionExecution.wake` path resume the parent. Keep legacy V1 execution gated and unchanged. Modern Desktop and TUI both consume the same Core V2 behavior through `packages/server`.

**Tech Stack:** TypeScript, Effect 4.0-beta.83, Bun tests, Drizzle + SQLite generated migrations, Core canonical tools, SessionV2/EventV2, SolidJS Desktop, OpenTUI/SolidJS TUI.

## Global Constraints

- Target repo: `D:\opencode-bugfix\opencode-fork-private-dev`, branch `999.0.6`.
- Plan base commit: `ab6889a`. Use this immutable commit for whole-plan diff and review comparisons.
- Read `docs/superpowers/specs/2026-08-03-event-driven-subagent-loop-design.md` before implementation.
- Preserve unrelated and untracked user work, especially:
  - `docs/superpowers/plans/2026-08-03-project-close-stale-read.md`
  - `docs/superpowers/plans/2026-08-03-staged-session-tab-restore.md`
- Run tests from package directories, never from the repository root.
- Use `bun typecheck` from each changed package; never run `tsc` directly.
- Generate the Core database migration with `bun run migration --name task_completion_delivery` from `packages/core`. Do not hand-edit `schema.json`, `src/database/schema.gen.ts`, or `src/database/migration.gen.ts`.
- No public Protocol or Server `HttpApi` shape change is planned. If implementation changes one, run `bun run generate` from `packages/client` and never hand-edit generated client files.
- Do not edit `packages/sdk/openapi.json` for this work.
- Do not remove or bypass `awaitToolFibers` in `packages/core/src/session/runner/llm.ts`.
- Do not make legacy V1 `packages/opencode/src/tool/task.ts` async-by-default. Its experimental gate and foreground default remain compatibility behavior.
- Keep one canonical Core tool representation. Do not add a second registry or executor path.
- Use `Tool.withPermission(tool, "task")` for `get_task_output` so visibility follows the existing task permission.
- TypeScript style: `const` over `let`, early returns, no `else`, no `any`, no aliased/star imports, and named service bindings in Effect generators.
- Every behavior change starts with a failing test and lands in an atomic conventional commit.
- Do not push or create a PR unless the user explicitly requests it.

## Task 1: Graduate background subagents to a standard V2 capability

**Files:**

- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/server/src/handlers/capability.ts`
- Modify: `packages/core/test/tool-task.test.ts`
- Modify: `packages/opencode/test/server/httpapi-exercise/index.ts`
- Verify only: `packages/opencode/src/tool/task.ts`
- Verify only: `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts`

**Interfaces:**

- V2 `TaskTool.node` advertises the `background` input without requiring an environment variable.
- `TaskTool.nodeWithOptions({ background: false })` still creates a constrained foreground-only node for focused tests.
- V2 `/api/capability` returns `{ backgroundSubagents: true }`.
- Legacy V1 task and `/experimental/capabilities` continue to read `experimentalBackgroundSubagents`.

- [ ] **Step 1: Add a failing Core default-capability test**

In `packages/core/test/tool-task.test.ts`, add a test using the normal `TaskTool.node` (not `nodeWithOptions`) and an environment with no `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`. Materialize the tool definition and assert that the task input schema exposes `background`.

Keep the existing explicit `nodeWithOptions({ background: false })` coverage and assert that its schema still omits `background`.

- [ ] **Step 2: Add a failing V2 capability exercise assertion**

In `packages/opencode/test/server/httpapi-exercise/index.ts`, strengthen the existing `/api/capability` check from property existence to:

```ts
check(body.backgroundSubagents === true, "V2 background subagents should be enabled by default")
```

Do not change the legacy `/experimental/capabilities` assertion.

- [ ] **Step 3: Run the focused failures**

From `packages/core`:

```powershell
bun test --timeout 60000 test/tool-task.test.ts
```

Expected: the normal node omits `background` without the environment flag.

From `packages/opencode`:

```powershell
bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip
```

Expected: the V2 capability value is false.

- [ ] **Step 4: Enable V2 background support by default**

In `packages/core/src/tool/task.ts`, make the layer option authoritative and default it to true:

```ts
export interface LayerOptions {
  readonly background?: boolean
}

export const layerWithOptions = (options: LayerOptions = {}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      // ...
      const allowBackground = options.background ?? true
```

Remove the unused Core `Flag` import. Keep the explicit error when a constrained node receives `background: true`.

In `packages/server/src/handlers/capability.ts`, remove the `Flag` import and return:

```ts
Effect.succeed({ backgroundSubagents: true })
```

Do not modify the V1 RuntimeFlags service or V1 task tool.

- [ ] **Step 5: Re-run focused tests**

Run the two commands from Step 3. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/core/src/tool/task.ts packages/server/src/handlers/capability.ts packages/core/test/tool-task.test.ts packages/opencode/test/server/httpapi-exercise/index.ts
git commit -m "feat(core): enable V2 background subagents by default"
```

## Task 2: Persist completion delivery ownership

**Files:**

- Modify: `packages/core/src/session/sql.ts`
- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/opencode/src/tool/task.ts`
- Modify: `packages/core/test/session-task-submission.test.ts`
- Modify: `packages/core/test/session-task-notification.test.ts`
- Modify: `packages/core/test/session-task-cancellation.test.ts`
- Modify: `packages/core/test/session-execution-recovery.test.ts`
- Modify: `packages/core/test/tool-task.test.ts`
- Generated: `packages/core/schema.json`
- Generated: `packages/core/src/database/schema.gen.ts`
- Generated: `packages/core/src/database/migration.gen.ts`
- Generated: `packages/core/src/database/migration/<generated timestamp>_task_completion_delivery.ts`

**Interfaces:**

```ts
export type CompletionDelivery = "tool" | "parent"

export type Invocation = Identity & {
  // existing fields
  readonly completionDelivery: CompletionDelivery
}

export type Info = {
  // existing fields
  readonly completionDelivery: CompletionDelivery
}
```

The database column is `completion_delivery`, non-null, with migration default `"parent"`.

- [ ] **Step 1: Add failing submission round-trip tests**

In `packages/core/test/session-task-submission.test.ts`:

- Update the shared invocation fixture to include `completionDelivery: "parent"`.
- Assert `submit(...)`, exact retry, `get(...)`, `claim(...)`, and terminal recovery preserve the field.
- Add an invocation-conflict test that retries the same identity with `completionDelivery: "tool"` and expects `TaskSubmission.InvocationConflict`.

- [ ] **Step 2: Run the failing test**

From `packages/core`:

```powershell
bun test --timeout 60000 test/session-task-submission.test.ts
```

Expected: compile/runtime failure because `completionDelivery` is absent.

- [ ] **Step 3: Add the Drizzle field and domain types**

In `packages/core/src/session/sql.ts`, add:

```ts
completion_delivery: text().$type<"tool" | "parent">().notNull().default("parent"),
```

In `packages/core/src/session/task-submission.ts`:

- Export `CompletionDelivery`.
- Add `completionDelivery` to `Invocation` and `Info`.
- Map `row.completion_delivery` in `toInfo`.
- Insert `completion_delivery: input.completionDelivery` in `submit`.
- Include the field in the existing `matches(...)` exact-retry comparison.

Update every `TaskSubmission.Invocation` constructor found by:

```powershell
rg -n "submissions\.submit|TaskSubmission\.Invocation" packages/core packages/opencode -g "*.ts"
```

In the V2 Core task tool use `runInBackground ? "parent" : "tool"`. In the legacy V1 task tool add the same explicit field but do not change how `runInBackground` is calculated: omitted `background` must remain foreground and the V1 experimental gate must remain intact. Update test fixtures with the delivery mode their scenario actually represents.

- [ ] **Step 4: Generate, do not hand-write, the migration**

From `packages/core`:

```powershell
bun run migration --name task_completion_delivery
```

Inspect the generated migration. It must add a non-null column with default `"parent"` so existing databases migrate safely. Keep the same default in the declared Drizzle schema; `TaskSubmission.submit` still writes the intended delivery explicitly. Do not edit generated registry/schema files manually.

The resulting migration must preserve old unfinished rows as `completion_delivery = 'parent'`.

- [ ] **Step 5: Add migration coverage**

In `packages/core/test/database-migration.test.ts`, import the generated migration and add a focused test that:

1. Creates the pre-migration `task_submission` shape or applies migrations through the previous migration.
2. Inserts one task row.
3. Applies `task_completion_delivery`.
4. Asserts the old row reads `completion_delivery = "parent"`.

- [ ] **Step 6: Verify schema and tests**

From `packages/core`:

```powershell
bun run migration --check
bun test --timeout 60000 test/database-migration.test.ts test/session-task-submission.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Stage `sql.ts`, both task call sites, affected fixtures/tests, and every generated migration artifact, then:

```powershell
git commit -m "feat(core): persist task completion delivery"
```

## Task 3: Make foreground, background, and promotion delivery exact

**Files:**

- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/core/test/session-task-submission.test.ts`
- Modify: `packages/core/test/tool-task.test.ts`

**Interfaces:**

Add to `TaskSubmission.Interface`:

```ts
readonly promoteDelivery: (submissionID: string) => Effect.Effect<Info | undefined>
```

Rules:

- `terminalize` writes an outbox row only for `completionDelivery === "parent"`.
- `promoteDelivery` atomically changes `"tool"` to `"parent"`.
- If the row is already terminal, `promoteDelivery` inserts the deterministic outbox row in the same transaction.
- Repeated promotion and terminalization are idempotent.
- The TaskTool promotion callback drains notifications after promotion so a terminal-before-promotion race wakes the parent immediately.

- [ ] **Step 1: Add failing outbox ownership tests**

In `packages/core/test/session-task-submission.test.ts`, add four cases:

1. Terminal `"tool"` submission creates zero outbox rows.
2. Terminal `"parent"` submission creates exactly one outbox row.
3. Promote a running `"tool"` submission, then terminalize: exactly one outbox row.
4. Terminalize a `"tool"` submission, then promote: exactly one outbox row; repeat promotion and still get one.

- [ ] **Step 2: Run the failing tests**

From `packages/core`:

```powershell
bun test --timeout 60000 test/session-task-submission.test.ts
```

Expected: foreground terminalization still creates an outbox row and `promoteDelivery` does not exist.

- [ ] **Step 3: Centralize deterministic outbox insertion**

Inside the `TaskSubmission` layer, extract one nearby transaction-local helper that inserts the existing deterministic notification message ID and payload with `onConflictDoNothing()`. Reuse it from both `terminalize` and `promoteDelivery`; do not create a new service.

Keep `terminalize`'s SessionInput terminal projection update unchanged.

- [ ] **Step 4: Implement atomic promotion**

Implement `promoteDelivery` in one database transaction:

- Read by submission ID.
- Return `undefined` when absent.
- Update `completion_delivery` only when currently `"tool"`.
- If the resulting row is terminal, call the shared outbox insertion helper before committing.
- Return `Info` for the resulting row.

- [ ] **Step 5: Wire BackgroundJob promotion before checkpointing**

In `packages/core/src/tool/task.ts`, when submitting a task pass:

```ts
completionDelivery: runInBackground ? "parent" : "tool"
```

Change the `BackgroundJob.start({ onPromote })` effect so it:

1. calls `submissions.promoteDelivery(submission.id)`;
2. fails the task lifecycle with a `ToolFailure` if the submission is missing;
3. calls the existing `TaskNotification.drain` adapter;
4. publishes the existing background checkpoint.

The drain must happen after durable promotion and before returning the promoted running result. This handles a child that terminalized before promotion inserted its outbox row.

- [ ] **Step 6: Add the promotion race regression to TaskTool tests**

In `packages/core/test/tool-task.test.ts`, add a controlled child completion gate and race promotion against completion. Assert:

- the foreground call returns a running/background result after promotion;
- the durable submission ends with `completionDelivery: "parent"`;
- exactly one notification is delivered and the parent wake callback runs, including the terminal-before-promotion ordering.

- [ ] **Step 7: Run focused tests and commit**

From `packages/core`:

```powershell
bun test --timeout 60000 test/session-task-submission.test.ts test/tool-task.test.ts
```

Expected: PASS.

```powershell
git add packages/core/src/session/task-submission.ts packages/core/src/tool/task.ts packages/core/test/session-task-submission.test.ts packages/core/test/tool-task.test.ts
git commit -m "fix(core): make task completion delivery exact"
```

## Task 4: Add stable task identity to durable completion notifications

**Files:**

- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/src/session/task-notification.ts`
- Modify: `packages/core/test/session-task-notification.test.ts`
- Modify: `packages/core/test/session-task-submission.test.ts`

**Interfaces:**

New payload shape:

```ts
{
  taskID?: string
  state: "completed" | "error" | "cancelled" | "recovery-required"
  description: string
  text: string
}
```

New model-facing form:

```xml
<task id="ses_child" state="completed">
<summary>...</summary>
<task_result>...</task_result>
</task>
```

- [ ] **Step 1: Add failing notification identity tests**

In `packages/core/test/session-task-notification.test.ts`:

- Terminalize a parent-delivered submission.
- Drain the notification.
- Assert the admitted text contains the exact child Session ID in the `<task id="...">` attribute.
- Insert one legacy payload without `taskID`, drain it, and assert identity is recovered from the referenced `task_submission` row.

- [ ] **Step 2: Run the failing test**

From `packages/core`:

```powershell
bun test --timeout 60000 test/session-task-notification.test.ts
```

Expected: rendered notification has no ID.

- [ ] **Step 3: Write task ID in new outbox payloads**

In the shared outbox helper from Task 3, include:

```ts
taskID: updated.child_session_id
```

- [ ] **Step 4: Keep old payloads replayable**

In `packages/core/src/session/task-notification.ts`:

- Make `taskID` optional in `NotificationPayload`.
- During `attempt`, resolve `payload.taskID` or fetch `TaskSubmissionTable.child_session_id` by `row.submission_id`.
- Treat a missing referenced submission as an error so the outbox stays retryable/observable; do not render an empty ID.
- Pass the resolved ID to `renderPayload`.
- Keep deterministic admission ID, delivered/woken states, cancellation suppression, and wake order unchanged.

- [ ] **Step 5: Run notification and recovery tests**

From `packages/core`:

```powershell
bun test --timeout 60000 test/session-task-notification.test.ts test/session-execution-recovery.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/core/src/session/task-submission.ts packages/core/src/session/task-notification.ts packages/core/test/session-task-notification.test.ts packages/core/test/session-task-submission.test.ts
git commit -m "feat(core): identify durable task notifications"
```

## Task 5: Make V2 `task` asynchronous by default

**Files:**

- Modify: `packages/core/src/tool/task.ts`
- Modify: `packages/core/test/tool-task.test.ts`
- Modify: `packages/core/src/session/runner/prompt/default.txt`
- Modify: `packages/core/src/session/runner/prompt/kimi.txt`
- Verify only: `packages/core/test/session-runner.test.ts`

**Behavior:**

```ts
const requestedBackground = input.background === true
if (requestedBackground && !allowBackground) failCapability()
const runInBackground = allowBackground ? input.background !== false : false
```

- [ ] **Step 1: Add failing async-default tests**

In `packages/core/test/tool-task.test.ts`, use a child execution gate and assert:

1. With V2 default capability and omitted `background`, `task` returns `state="running"` before the child gate opens and metadata has `background: true`.
2. With `background: true`, behavior is the same.
3. With `background: false`, the tool remains pending until the child gate opens, returns the completed result directly, and creates no parent notification.
4. With `nodeWithOptions({ background: false })`, omitted `background` remains foreground and explicit true fails.

- [ ] **Step 2: Run the failing test**

From `packages/core`:

```powershell
bun test --timeout 60000 test/tool-task.test.ts
```

Expected: omitted background blocks.

- [ ] **Step 3: Change only the TaskTool default**

Implement the behavior formula above. Keep child creation, continuation through `task_id`, concurrency permit ownership, cancellation, checkpointing, and explicit foreground wait logic unchanged.

Update `BACKGROUND_DESCRIPTION` and the main tool description to state:

- async is the default;
- the parent is automatically notified and woken;
- `background: false` is for an immediate hard dependency;
- multiple foreground task calls must not be batched;
- repeated status polling is prohibited.

- [ ] **Step 4: Update provider guidance**

In `packages/core/src/session/runner/prompt/default.txt` and `kimi.txt`, keep parallel direct tools but distinguish them from delegation:

- Independent `task` calls are safe to issue together because they return handles.
- Do not issue multiple `background: false` task calls in one assistant message.
- Continue useful parent work; rely on completion input or a deliberate bounded `get_task_output` call.

Do not promise one provider request per completion because wake coalescing is valid.

- [ ] **Step 5: Preserve the provider barrier test**

Run the existing Core test named `starts recorded local tools eagerly and awaits settlement before continuing`. Do not weaken or delete it.

From `packages/core`:

```powershell
bun test --timeout 60000 test/tool-task.test.ts test/session-runner.test.ts
```

Expected: all tests pass; generic local tools still settle before provider continuation.

- [ ] **Step 6: Commit**

```powershell
git add packages/core/src/tool/task.ts packages/core/test/tool-task.test.ts packages/core/src/session/runner/prompt/default.txt packages/core/src/session/runner/prompt/kimi.txt
git commit -m "feat(core): spawn V2 tasks asynchronously by default"
```

## Task 6: Add ownership-safe `get_task_output`

**Files:**

- Create: `packages/core/src/tool/get-task-output.ts`
- Modify: `packages/core/src/tool/builtins.ts`
- Modify: `packages/core/src/session/task-submission.ts`
- Modify: `packages/core/test/tool-task.test.ts`
- Create: `packages/core/test/tool-get-task-output.test.ts`
- Modify: `packages/core/test/session-task-submission.test.ts`

**Interfaces:**

Add to `TaskSubmission.Interface`:

```ts
readonly latestByChild: (input: {
  readonly parentSessionID: SessionSchema.ID
  readonly childSessionID: SessionSchema.ID
}) => Effect.Effect<Info | undefined>
```

Tool input:

```ts
{
  task_ids: string[]
  timeout_ms?: number
}
```

Tool output is an array of durable status records in requested order. Cap input at 20 IDs.

- [ ] **Step 1: Add failing latest-invocation query tests**

In `packages/core/test/session-task-submission.test.ts`:

- Create two submissions from the same parent to the same child with different tool-call identities and times.
- Assert `latestByChild` returns the newer submission.
- Create the same child ID under another parent and assert parent ownership isolates the result.

- [ ] **Step 2: Implement `latestByChild`**

Query by both parent and child, order by `time_created DESC, id DESC`, limit one, and return `toInfo`.

- [ ] **Step 3: Write failing tool tests**

Create `packages/core/test/tool-get-task-output.test.ts` covering:

1. Trimming, deduplication, first-seen order, and the 20-ID cap.
2. Omitted/zero timeout returns an immediate durable snapshot.
3. Positive timeout waits for all process-local jobs or the common deadline, then re-reads durable state.
4. Completed/error/cancelled/recovery-required output mapping.
5. Unknown and non-owned IDs return the same `ToolFailure` text.
6. A durable running submission with no process-local BackgroundJob returns its current snapshot rather than polling.
7. The tool definition is hidden when the agent lacks `task` permission and visible when task permission exists.

- [ ] **Step 4: Run the failing test**

From `packages/core`:

```powershell
bun test --timeout 60000 test/tool-get-task-output.test.ts
```

Expected: module/tool not found.

- [ ] **Step 5: Implement the canonical tool**

In `packages/core/src/tool/get-task-output.ts`:

- Register the name `get_task_output` through `Tools.Service`.
- Capture `TaskSubmission.Service` and `BackgroundJob.Service` in the Location layer.
- Validate `task_ids` as 1..20 strings and `timeout_ms` as a non-negative bounded integer (maximum 600000 ms).
- Normalize IDs once at the tool boundary.
- Resolve each ID with `latestByChild({ parentSessionID: context.sessionID, childSessionID })`.
- On positive timeout, wait concurrently for nonterminal process-local jobs using one common deadline; do not loop or sleep.
- Re-query every ID after waiting.
- Return complete structured records and readable `<task id="..." state="...">` model text.
- Decorate the tool with `Tool.withPermission(tool, "task")`.

Extend the `TaskSubmission.Service.of(...)` test double in `packages/core/test/tool-task.test.ts` with `latestByChild` (and keep its Task 3 `promoteDelivery` implementation) so Core typechecking exercises the complete interface.

Do not call `SessionExecution.resume` or `wake` from this observation tool.

- [ ] **Step 6: Register the built-in**

Import the new namespace in `packages/core/src/tool/builtins.ts` and add its node next to `TaskTool.node`.

- [ ] **Step 7: Run focused tests and typecheck**

From `packages/core`:

```powershell
bun test --timeout 60000 test/session-task-submission.test.ts test/tool-get-task-output.test.ts test/tool-task.test.ts
bun typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add packages/core/src/tool/get-task-output.ts packages/core/src/tool/builtins.ts packages/core/src/session/task-submission.ts packages/core/test/tool-get-task-output.test.ts packages/core/test/session-task-submission.test.ts packages/core/test/tool-task.test.ts
git commit -m "feat(core): add durable task output queries"
```

## Task 7: Prove independent child completions resume the parent

**Files:**

- Create: `packages/core/test/session-subagent-loop.test.ts`
- Modify only if the test exposes a defect: `packages/core/src/session/execution/local.ts`
- Modify only if the test exposes a defect: `packages/core/src/session/run-coordinator.ts`
- Modify only if the test exposes a defect: `packages/core/src/session/task-notification.ts`

**Test harness contract:**

Use real `SessionExecution`, `SessionRunner`, `TaskSubmission`, `TaskNotification`, `SessionInput`, and `BackgroundJob` services with a deterministic fake model and child completion Deferreds. Do not mock the orchestration logic being tested.

- [ ] **Step 1: Write the two-child failing integration test**

The fake parent model should:

1. Emit two `task` calls with omitted `background` in its first response.
2. Record each subsequent provider request and the visible synthetic task inputs.

The child model should block child A and child B on separate Deferreds.

Assert before releasing either child:

- both TaskTool calls have settled as running;
- the parent provider turn has continued/returned without child completion;
- both children remain active.

Release only A and drain through the real completion path. Assert:

- one durable A notification exists;
- parent gets a new provider request containing A's task ID/result;
- B remains active.

Release B later. Assert a later parent provider request contains B's task ID/result.

- [ ] **Step 2: Add a coalescing test**

Release A and B before the parent reaches its next safe boundary. Assert:

- two distinct deterministic synthetic input records exist;
- one provider request may contain both;
- no result is lost or duplicated.

- [ ] **Step 3: Add restart replay coverage**

Simulate notification state `delivered` with no `time_woken`, rebuild the execution layer, and drain startup recovery. Assert:

- the existing synthetic input is not re-admitted;
- parent wake is retried;
- outbox reaches `woken` exactly once.

- [ ] **Step 4: Run the failing integration tests**

From `packages/core`:

```powershell
bun test --timeout 90000 test/session-subagent-loop.test.ts
```

Expected before Tasks 1–6: omitted task calls block or identity/delivery assertions fail. After Tasks 1–6, the test should pass without changing the provider barrier.

- [ ] **Step 5: Fix only proven orchestration defects**

If a test still fails, change only the smallest durable boundary responsible. Preserve:

- wake coalescing;
- one active drain per Session;
- input admission before wake;
- no interruption of an active provider stream;
- no polling.

- [ ] **Step 6: Run the adjacent recovery suite and commit**

From `packages/core`:

```powershell
bun test --timeout 90000 test/session-subagent-loop.test.ts test/session-task-notification.test.ts test/session-execution-recovery.test.ts test/session-runner.test.ts
```

Expected: PASS.

```powershell
git add packages/core/test/session-subagent-loop.test.ts packages/core/src/session/execution/local.ts packages/core/src/session/run-coordinator.ts packages/core/src/session/task-notification.ts
git commit -m "test(core): cover event-driven subagent resumption"
```

Stage only source files that actually changed.

## Task 8: Verify Desktop and TUI surface parity

**Files:**

- Modify: `packages/app/src/context/server-session-v2-reducer.test.ts`
- Modify: `packages/app/src/utils/server-compat.test.ts`
- Modify: `packages/tui/test/cli/tui/data.test.tsx`
- Modify only if a test exposes a defect: `packages/tui/src/context/data.tsx`
- Modify only if a test exposes a defect: `packages/tui/src/context/transcript-compat.ts`
- Verify only: `packages/tui/src/component/prompt/index.tsx`
- Verify only: `packages/tui/src/routes/session/index.tsx`

**Surface contract:**

- Desktop and TUI submit normal prompts through `/api/session/:sessionID/prompt`.
- Both surfaces consume V2 durable synthetic task inputs.
- Existing task cards continue to recognize `metadata.background === true` and child Session IDs.
- `get_task_output` may use the generic tool renderer in this release, but its output must remain readable.

- [ ] **Step 1: Strengthen the Desktop V2 route regression**

In `packages/app/src/utils/server-compat.test.ts`, extend the existing `translates current prompts to the nested V2 prompt contract` test to include a `legacyParts` value and assert protocol `v2` still sends only the canonical nested `prompt` to `/api/session/.../prompt`. `legacyParts` must remain a V1-adapter detail.

- [ ] **Step 2: Extend Desktop synthetic completion projection**

In `packages/app/src/context/server-session-v2-reducer.test.ts`, extend the existing durable background-result test so the synthetic text includes `<task id="ses_child">`. Assert the projected synthetic turn keeps the task ID text and description without becoming a normal user-authored prompt.

- [ ] **Step 3: Add the TUI equivalent**

In `packages/tui/test/cli/tui/data.test.tsx`, publish the V2 events for a synthetic task completion and assert the TUI Session store projects one synthetic user item containing the child task ID and description. Then publish the following assistant event and assert it appears as the parent's resumed response.

Do not add a second TUI event path; use the existing `session.next.synthetic`/transcript compatibility flow.

- [ ] **Step 4: Confirm TUI prompt and task presentation paths**

Review, without redesigning:

- `packages/tui/src/component/prompt/index.tsx` calls `sdk.native.sessions.prompt`.
- `packages/tui/src/routes/session/index.tsx` maps `task` to the specialized task component and reads `metadata.background`.
- Generic tool rendering safely displays `get_task_output`.

If the new tests reveal missing identity or unreadable generic output, fix only the projection/renderer adapter; do not duplicate Core lifecycle state in TUI.

- [ ] **Step 5: Run focused surface tests**

From `packages/app`:

```powershell
bun test --timeout 60000 src/utils/server-compat.test.ts src/context/server-session-v2-reducer.test.ts
bun typecheck
```

From `packages/tui`:

```powershell
bun test --timeout 60000 test/cli/tui/data.test.tsx
bun typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/app/src/context/server-session-v2-reducer.test.ts packages/app/src/utils/server-compat.test.ts packages/tui/test/cli/tui/data.test.tsx packages/tui/src/context/data.tsx packages/tui/src/context/transcript-compat.ts
git commit -m "test(ui): cover V2 task completion on desktop and TUI"
```

Stage only files that actually changed.

## Task 9: Full verification and implementation review

**Files:**

- Review: every file changed by Tasks 1–8
- Update: this plan's checkboxes and implementation notes only

- [ ] **Step 1: Inspect scope and generated artifacts**

From the repo root:

```powershell
git status --short
git diff --stat ab6889a
git diff --check
```

Confirm:

- no unrelated files are staged;
- the two pre-existing untracked plan files are untouched;
- no manual generated-client or SDK edits exist;
- the provider tool barrier remains intact;
- V1 task default/gate remains unchanged.

- [ ] **Step 2: Verify Core completely**

From `packages/core`:

```powershell
bun run migration --check
bun test --timeout 90000 test/database-migration.test.ts test/session-task-submission.test.ts test/session-task-notification.test.ts test/session-execution-recovery.test.ts test/tool-task.test.ts test/tool-get-task-output.test.ts test/session-subagent-loop.test.ts test/session-runner.test.ts
bun typecheck
```

Then run the full Core suite from `packages/core`:

```powershell
bun test --timeout 90000
```

- [ ] **Step 3: Verify server and compatibility surfaces**

From `packages/server`:

```powershell
bun typecheck
```

From `packages/opencode`:

```powershell
bun test --timeout 60000 test/tool/registry.test.ts test/server/httpapi-session.test.ts
bun run test:httpapi
bun typecheck
```

Expected: V2 capability is true; legacy capability/task behavior remains compatible.

- [ ] **Step 4: Verify Desktop and TUI**

From `packages/app`:

```powershell
bun test --timeout 60000 src/utils/server-compat.test.ts src/context/server-session-v2-reducer.test.ts
bun typecheck
bun run build
```

From `packages/tui`:

```powershell
bun test --timeout 60000 test/cli/tui/data.test.tsx
bun typecheck
```

- [ ] **Step 5: Perform a manual two-surface smoke test**

On Desktop and TUI separately:

1. Start one parent Session with an agent allowed to use `task`.
2. Ask it to launch two independent subagents with different completion times.
3. Confirm the parent continues after spawn without waiting for both.
4. Confirm the first completion causes a parent response while the second remains running.
5. Confirm the second completion later causes another parent response.
6. Confirm the child Session IDs shown in notifications open/continue the correct children.
7. Run one explicit `background: false` dependency and confirm no duplicate completion turn appears.

Record timestamps and screenshots in the implementation report; do not commit local Session data.

- [ ] **Step 6: Request whole-branch review**

Use `superpowers:requesting-code-review` against the pre-plan base commit and current HEAD. The reviewer must specifically audit:

- terminalize/promote race safety;
- exact-once notification admission;
- ownership isolation in `get_task_output`;
- timeout behavior without polling;
- V1 compatibility;
- Desktop/TUI parity;
- absence of provider-protocol shortcuts.

- [ ] **Step 7: Apply review fixes and re-run affected suites**

Use `superpowers:receiving-code-review` for every finding. Add a regression test before each fix. Repeat Steps 1–4 after any lifecycle or migration change.

- [ ] **Step 8: Final commit if review changed code**

```powershell
git commit -m "fix(core): harden event-driven task delivery"
```

Skip this commit when review required no changes. Leave the branch unpushed until the user asks.

## Definition of Done

- V2 `task` is async by default on Desktop and TUI.
- Explicit `background: false` remains foreground and does not duplicate completion delivery.
- Foreground-to-background promotion is durable and race-safe.
- Every terminal background child creates one durable, task-identified parent input.
- Separated child completions can trigger separated parent turns; raced completions may coalesce without loss.
- `get_task_output` is ownership-safe, non-polling, and bounded.
- Existing provider local-tool settlement guarantees still pass.
- V1 task execution remains gated and foreground-by-default.
- Core, server, opencode compatibility, Desktop, and TUI verification all pass.
