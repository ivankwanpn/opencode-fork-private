# Codex-Inspired Agent Loop Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port six codex-rust mechanisms into opencode-fork to harden the V2 agent loop: transaction-safe steer targeting, BackgroundJob-owned subagent concurrency limits, durable Stop/SubagentStop hooks, turn-scoped Responses WebSocket sessions, durable agent paths, and projection-repair tooling.

**Architecture:** Each mechanism lands as an independent, testable slice. P0-1 validates an optional `expectedActiveAttemptID` inside the EventV2 commit transaction and fails with a new typed error. P0-2 adds a `subagent_max_concurrency` config and a BackgroundJob-owned permit released only when the child execution scope closes. P1-3 introduces `session.stop`/`session.subagent.stop` plugin hooks with a bounded block counter. P1-4 reuses one Responses WebSocket connection across the inner continuation loop. P2-5 persists agent path metadata on `task_submission`. P2-6 adds a read-repair CLI/script that rebuilds projections from the durable event log.

**Tech Stack:** TypeScript, Effect 4.0-beta.83, Bun tests, Drizzle + SQLite migrations, Hono/OpenAPI protocol, generated client/SDK codegen, SolidJS app reducer.

## Global Constraints

- Target repo: `D:\opencode-bugfix\opencode-fork-private-dev`, branch `999.0.5`. Working tree must stay clean between commits; do not touch `packages/sdk/openapi.json` unless a task explicitly regenerates it.
- Run all tests from package directories, never from the repository root.
- After public Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client`; never hand-edit `packages/client/src/generated` or `packages/client/src/generated-effect`.
- Legacy JS SDK and tracked OpenAPI regenerate from the repo root via `bun ./script/generate.ts`; never hand-edit generated artifacts.
- App session/timeline changes require a production benchmark baseline before and a comparison after (run from `packages/app`).
- Do not push, do not create PRs unless the user explicitly asks.
- TypeScript style: `const` over `let`, early returns, no `else`, no `any`, no alias/star imports, Effect generators bind services to named variables.
- Drizzle schema fields use `snake_case`; DB migrations live in `packages/core/src/database/migration/` with a timestamp id.
- Each task commits atomically with a conventional message `type(scope): summary`.

---

### Task 1: Schema — new ActiveAttemptConflictError and delivery field passthrough

**Files:**
- Modify: `packages/core/src/session/command.ts:37` (add error class near PromptConflictError)
- Modify: `packages/core/src/session/input.ts` (admit signature, no schema change)
- Modify: `packages/core/src/session/runner/llm.ts:270-292` (promotion param plumbing)
- Test: `packages/core/test/session-input.test.ts`
- Test: `packages/core/test/session-runner.test.ts`

**Interfaces:**
- Produces: `ActiveAttemptConflictError` tagged error (`"Session.ActiveAttemptConflictError"`) with `{ sessionID, attemptID, expectedAttemptID }`.
- Produces: `SessionInput.admit` accepts an optional `expectedActiveAttemptID?: EventV2.ID` carried in the `commit` callback closure.
- Consumes: existing `SessionEvent.PromptAdmitted`, `SessionInput.Delivery`, `EventV2.latestSequence`.

- [ ] **Step 1: Write the failing error-class test**

In `packages/core/test/session-input.test.ts`, use the existing `inputIt` helper (from `./lib/effect`) and add the imports for `SessionAttempt`, `SessionMessage`, and `SessionSchema`:

```ts
import { SessionAttempt } from "@opencode-ai/core/session/attempt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"

inputIt("rejects a stale expected active attempt id with ActiveAttemptConflictError", () =>
  Effect.gen(function* () {
    const sessionID = SessionSchema.ID.make("ses_attempt_target")
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const attemptID = EventV2.ID.make("evt_attempt_1")
    const assistantMessageID = SessionMessage.ID.create()
    yield* events.publish(SessionEvent.ProviderAttempt.Started, {
      sessionID,
      attemptID,
      assistantMessageID,
      timestamp: yield* DateTime.now,
      attempt: 1,
    })
    // advance the attempt so expectedAttemptID is stale
    yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
      sessionID,
      attemptID,
      assistantMessageID,
      timestamp: yield* DateTime.now,
      outcome: "completed",
      continuation: false,
    })
    const conflict = yield* SessionInput.admit(db, events, {
      id: SessionMessage.ID.create(),
      sessionID,
      prompt: Prompt.make({ text: "steer" }),
      delivery: "steer",
      expectedActiveAttemptID: attemptID,
      commit: (seq) =>
        SessionAttempt.get(db, sessionID).pipe(
          Effect.flatMap((row) =>
            row?.attempt_id === attemptID
              ? Effect.void
              : Effect.die(
                  new ActiveAttemptConflictError({
                    sessionID,
                    attemptID: row?.attempt_id ?? EventV2.ID.make(""),
                    expectedAttemptID: attemptID,
                  }),
                ),
          ),
        ),
    }).pipe(Effect.flip)
    expect(conflict).toBeInstanceOf(ActiveAttemptConflictError)
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-input.test.ts
```

Expected: FAIL with "ActiveAttemptConflictError is not defined".

- [ ] **Step 3: Add the error class**

In `packages/core/src/session/command.ts` next to `PromptConflictError` (line 37):

```ts
export class ActiveAttemptConflictError extends Schema.TaggedErrorClass<ActiveAttemptConflictError>()(
  "Session.ActiveAttemptConflictError",
  {
    sessionID: SessionSchema.ID,
    attemptID: EventV2.ID,
    expectedAttemptID: EventV2.ID,
  },
) {}
```

- [ ] **Step 4: Extend SessionInput.admit commit closure**

In `packages/core/src/session/input.ts`, change the `input` type to add `expectedActiveAttemptID?: EventV2.ID` and pass it into the `commit` closure signature so the caller can close over it (the actual validation lives in the caller-provided commit callback as shown in the test):

```ts
export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly synthetic?: Synthetic
    readonly delivery: Delivery
    readonly expectedActiveAttemptID?: EventV2.ID
    readonly commit?: (seq: number) => Effect.Effect<void>
  },
) {
```

- [ ] **Step 5: Run the test to verify it passes**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-input.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/command.ts packages/core/src/session/input.ts packages/core/test/session-input.test.ts
git commit -m "feat(core): add ActiveAttemptConflictError and expected-attempt admit hook"
```

### Task 2: P0-1 — wire expectedActiveAttemptID through prompt/command admit

**Files:**
- Modify: `packages/core/src/session/command.ts:272-357` (admit implementation)
- Modify: `packages/core/src/session.ts:547-651` (prompt/command pass-through)
- Modify: `packages/protocol/src/groups/session.ts:327-353` (prompt payload) and `:440-465` (command payload)
- Modify: `packages/server/src/handlers/session.ts` (prompt/command handlers)
- Test: `packages/core/test/session-runner.test.ts`
- Test: `packages/app/src/context/server-session-v2-reducer.test.ts` (if reducer touches error)

**Interfaces:**
- Consumes: Task 1 `ActiveAttemptConflictError`, `SessionInput.admit` `expectedActiveAttemptID`.
- Produces: `V2Session.prompt`/`V2Session.command` accept `expectedActiveAttemptID?: EventV2.ID`.
- Produces: Protocol `session.prompt`/`session.command` payloads accept optional `expectedActiveAttemptID`.

- [ ] **Step 1: Write the failing integration test**

In `packages/core/test/session-runner.test.ts`, add:

```ts
it.effect("rejects a steer targeting a finished provider attempt", () =>
  Effect.gen(function* () {
    yield* setup
    const session = yield* SessionV2.Service
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "First" }), resume: false })
    yield* session.resume(sessionID)
    const stale = EventV2.ID.create()
    const error = yield* session
      .prompt({
        sessionID,
        prompt: Prompt.make({ text: "Steer to stale attempt" }),
        expectedActiveAttemptID: stale,
      })
      .pipe(Effect.flip)
    expect(error).toBeInstanceOf(ActiveAttemptConflictError)
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-runner.test.ts
```

Expected: FAIL — `expectedActiveAttemptID` is not accepted by `session.prompt`.

- [ ] **Step 3: Implement the commit-time validation in command.admit**

In `packages/core/src/session/command.ts`, inside the `else` branch of `admit` (after exact-retry check, before `SessionInput.admit`), build a `commit` closure when `input.expectedActiveAttemptID` is provided:

```ts
const commit = input.expectedActiveAttemptID
  ? (seq: number) =>
      SessionAttempt.get(db, sessionID).pipe(
        Effect.flatMap((row) =>
          row?.attempt_id === input.expectedActiveAttemptID
            ? Effect.void
            : Effect.die(
                new ActiveAttemptConflictError({
                  sessionID,
                  attemptID: row?.attempt_id ?? EventV2.ID.make(""),
                  expectedAttemptID: input.expectedActiveAttemptID,
                }),
              ),
        ),
      )
  : undefined
admitted = yield* SessionInput.admit(db, events, {
  id: messageID,
  sessionID: input.sessionID,
  prompt,
  delivery,
  expectedActiveAttemptID: input.expectedActiveAttemptID,
  commit,
}).pipe(
  Effect.catchDefect((defect) =>
    defect instanceof ActiveAttemptConflictError
      ? Effect.fail(defect)
      : defect instanceof SessionInput.LifecycleConflict
        ? new PromptConflictError({ sessionID: input.sessionID, messageID })
        : Effect.die(defect),
  ),
)
```

Also extend the `Interface["admit"]` input type with `expectedActiveAttemptID?: EventV2.ID`.

- [ ] **Step 4: Wire pass-through in session.ts**

In `packages/core/src/session.ts`, add `expectedActiveAttemptID` to the `prompt` and `command` input types, and pass it into `commands.admit(...)` in both `prompt` (`:624`) and `command` (`:676`) call sites.

- [ ] **Step 5: Add protocol payload field**

In `packages/protocol/src/groups/session.ts`, add `expectedActiveAttemptID: Event.ID.pipe(Schema.optional)` to both `session.prompt` (`:330`) and `session.command` (`:447`) payload structs. The file already imports `Event` from `@opencode-ai/schema/event` (line 33). Add `ActiveAttemptConflictError` (or a generic conflict) to the `error` arrays.

- [ ] **Step 6: Add server handler passthrough**

In `packages/server/src/handlers/session.ts`, pass `expectedActiveAttemptID: ctx.payload.expectedActiveAttemptID` in the `session.prompt` (`:341`) and `session.command` handlers.

- [ ] **Step 7: Regenerate client and verify**

Run from `packages/client`:

```powershell
bun run generate
```

Run from repo root:

```powershell
bun ./script/generate.ts
git diff --stat -- packages/client/src/generated packages/sdk/js/src/v2/gen packages/sdk/openapi.json
```

Expected: generated diff contains only the new optional field and error union. If unrelated API changes appear, stop and investigate.

- [ ] **Step 8: Run the tests**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-runner.test.ts test/session-input.test.ts
bun run typecheck
```

Run from `packages/client`:

```powershell
bun run check:generated
bun run typecheck
```

Run from `packages/server`:

```powershell
bun run typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/session/command.ts packages/core/src/session.ts packages/protocol/src/groups/session.ts packages/server/src/handlers/session.ts packages/core/test/session-runner.test.ts packages/client/src/generated packages/client/src/generated-effect packages/sdk/js/src/v2/gen packages/sdk/openapi.json
git commit -m "feat(core): enforce expected active attempt id on steer submit"
```

### Task 3: P0-2 — subagent_max_concurrency config and BackgroundJob-owned permit

**Files:**
- Modify: `packages/core/src/config.ts:40-47` (add `subagent_max_concurrency`)
- Create: `packages/core/src/session/subagent-permit.ts`
- Modify: `packages/core/src/background-job.ts` (permit hook)
- Modify: `packages/core/src/tool/task.ts:120-330` (acquire permit)
- Test: `packages/core/test/session-task-submission.test.ts`
- Test: `packages/core/test/subagent-permit.test.ts`

**Interfaces:**
- Produces: `Config.Info.subagent_max_concurrency?: number` (default unset = unlimited).
- Produces: `SubagentPermit` service with `acquire(key: string): Effect.Effect<Reservation, SubagentLimitReached>` and `release(key)`.
- Consumes: `Config.latest(config, "subagent_max_concurrency")`, `BackgroundJob.Service.start`.

- [ ] **Step 1: Write the failing permit test**

Create `packages/core/test/subagent-permit.test.ts`:

```ts
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SubagentPermit } from "@opencode-ai/core/session/subagent-permit"
import { testEffect } from "./lib/effect"

const permitIt = testEffect(LayerNode.group([SubagentPermit.node]))

permitIt("rejects a new subagent beyond the concurrency limit", () =>
  Effect.gen(function* () {
    const permits = yield* SubagentPermit.Service
    const first = yield* permits.acquire("ses_child_1")
    const second = yield* permits.acquire("ses_child_2")
    const error = yield* permits.acquire("ses_child_3").pipe(Effect.flip)
    expect(error).toBeInstanceOf(SubagentLimitReached)
    yield* permits.release(first.key)
    yield* permits.release(second.key)
  }),
)

permitIt("deduplicates re-acquire for the same child id", () =>
  Effect.gen(function* () {
    const permits = yield* SubagentPermit.Service
    const first = yield* permits.acquire("ses_child_1")
    const again = yield* permits.acquire("ses_child_1")
    expect(again.kind).toBe("existing")
    yield* permits.release(first.key)
  }),
)
```

Note: `SubagentPermit.node` uses the default unlimited layer. The concurrency-limit behavior is exercised through the layer factory in a follow-up integration test (Step 7); this unit test validates the dedup and exhaustion shape with an explicit `SubagentPermit.layer(2)` where needed.

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/subagent-permit.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the permit registry**

Create `packages/core/src/session/subagent-permit.ts`:

```ts
export * as SubagentPermit from "./subagent-permit"

import { Context, Effect, Layer, Ref, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export class SubagentLimitReached extends Schema.TaggedErrorClass<SubagentLimitReached>()(
  "Subagent.SubagentLimitReached",
  { limit: Schema.Number },
) {}

export type Reservation = {
  readonly kind: "new" | "existing"
  readonly key: string
}

export interface Interface {
  readonly acquire: (key: string) => Effect.Effect<Reservation, SubagentLimitReached>
  readonly release: (key: string) => Effect.Effect<void>
  readonly active: Effect.Effect<ReadonlySet<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubagentPermit") {}

export const make = (options: { readonly limit: number | undefined }) =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<Set<string>>(new Set())
    const acquire = Effect.fn("SubagentPermit.acquire")((key: string) =>
      Ref.modify(ref, (active) => {
        if (active.has(key)) return [{ kind: "existing" as const, key }, active]
        if (options.limit !== undefined && active.size >= options.limit)
          return [new SubagentLimitReached({ limit: options.limit }), active] as const
        const next = new Set(active)
        next.add(key)
        return [{ kind: "new" as const, key }, next] as const
      }),
    )
    const release = Effect.fn("SubagentPermit.release")((key: string) =>
      Ref.update(ref, (active) => {
        const next = new Set(active)
        next.delete(key)
        return next
      }),
    )
    const active = Ref.get(ref)
    return Service.of({ acquire, release, active })
  })

export const layer = (limit: number | undefined) => Layer.effect(Service, make({ limit }))

export const node = makeGlobalNode({ service: Service, layer: layer(undefined), deps: [] })
```

- [ ] **Step 4: Run the permit test to verify it passes**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/subagent-permit.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Add the config field**

In `packages/core/src/config.ts` after `subagent_depth`:

```ts
subagent_max_concurrency: NonNegativeInt.pipe(Schema.optional).annotate({
  description: "Maximum number of concurrently running subagent child sessions per parent",
}),
```

- [ ] **Step 6: Wire permit into BackgroundJob start**

In `packages/core/src/background-job.ts`, add an optional `onAcquire?: Effect.Effect<void>` / `onRelease?: Effect.Effect<void>` to `StartInput`, and invoke them at job creation (`kind: "started"`) and job settle (`pending === 0`). Leave the default no-op so existing callers are unaffected.

- [ ] **Step 7: Acquire permit in task.ts**

In `packages/core/src/tool/task.ts` `execute`, after resolving `child` and before `submissions.submit`:

```ts
const permits = yield* SubagentPermit.Service
const limit = Config.latest(yield* config.entries(), "subagent_max_concurrency")
const reservation = yield* permits.acquire(child.id).pipe(
  Effect.mapError(() => new ToolFailure({ message: "Subagent concurrency limit reached" })),
)
```

Pass `onAcquire: permits.acquire(child.id).pipe(Effect.asVoid)`, `onRelease: permits.release(child.id)` into `background.start`, and release on the non-background path after `runTask` completes.

- [ ] **Step 8: Run task submission tests**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-task-submission.test.ts test/subagent-permit.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/session/subagent-permit.ts packages/core/src/background-job.ts packages/core/src/tool/task.ts packages/core/test/subagent-permit.test.ts packages/core/test/session-task-submission.test.ts
git commit -m "feat(core): limit subagent concurrency with BackgroundJob-owned permit"
```

### Task 4: P1-3 — durable Stop / SubagentStop plugin hooks

**Files:**
- Modify: `packages/core/src/plugin/runtime.ts:6-24` (add HookName entries)
- Modify: `packages/core/src/session/runner/llm.ts` (invoke stop hooks before loop exit)
- Create: `packages/core/src/session/stop-hook.ts`
- Test: `packages/core/test/session-stop-hook.test.ts`

**Interfaces:**
- Produces: `HookName.sessionStop = "session.stop"`, `HookName.sessionSubagentStop = "session.subagent.stop"`.
- Produces: `StopHookOutcome { action: "stop" | "continue"; reason?: string; continuation?: PromptFragment[] }`.
- Consumes: `PluginRuntime.run`, `SessionInput.admitSynthetic` (via `SessionCommand`), `EventV2`.

- [ ] **Step 1: Write the failing hook test**

Create `packages/core/test/session-stop-hook.test.ts`:

```ts
it.effect("stop hook action=stop ends the turn without continuation", () =>
  Effect.gen(function* () {
    const runtime = yield* PluginRuntime.Service
    yield* runtime.hook(PluginRuntime.HookName.sessionStop, () =>
      Effect.succeed({ action: "stop", reason: "verification complete" }),
    )
    const outcome = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
    expect(outcome.action).toBe("stop")
  }),
)

it.effect("stop hook action=continue injects a synthetic input and respects the block cap", () =>
  Effect.gen(function* () {
    const runtime = yield* PluginRuntime.Service
    let calls = 0
    yield* runtime.hook(PluginRuntime.HookName.sessionStop, () => {
      calls++
      return Effect.succeed({
        action: "continue",
        continuation: [{ type: "text", text: "run tests" }],
      })
    })
    const first = yield* evaluateStopHooks({ lastAssistantMessage: "done" })
    expect(first.action).toBe("continue")
    expect(calls).toBe(1)
    // second evaluation exceeds the per-turn block cap → forced stop
    const second = yield* evaluateStopHooks({ lastAssistantMessage: "done", blockCount: 1 })
    expect(second.action).toBe("stop")
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-stop-hook.test.ts
```

Expected: FAIL — `evaluateStopHooks` and HookNames not defined.

- [ ] **Step 3: Add HookName entries**

In `packages/core/src/plugin/runtime.ts`:

```ts
sessionStop: "session.stop",
sessionSubagentStop: "session.subagent.stop",
```

- [ ] **Step 4: Implement stop-hook evaluation**

Create `packages/core/src/session/stop-hook.ts`:

```ts
export * as SessionStopHook from "./stop-hook"

import { Effect } from "effect"
import { PluginRuntime } from "../plugin/runtime"

export const MAX_BLOCKS_PER_TURN = 3

export type PromptFragment = { readonly type: "text"; readonly text: string }

export type StopHookOutcome =
  | { readonly action: "stop"; readonly reason?: string }
  | { readonly action: "continue"; readonly continuation?: readonly PromptFragment[] }

export const evaluateStopHooks = Effect.fn("SessionStopHook.evaluate")(function* (input: {
  readonly lastAssistantMessage?: string
  readonly blockCount: number
  readonly agent?: string
}) {
  const runtime = yield* PluginRuntime.Service
  if (input.blockCount >= MAX_BLOCKS_PER_TURN) return { action: "stop" as const }
  const hookName =
    input.agent === undefined
      ? PluginRuntime.HookName.sessionStop
      : PluginRuntime.HookName.sessionSubagentStop
  const result = yield* runtime.run(hookName, {
    lastAssistantMessage: input.lastAssistantMessage,
    blockCount: input.blockCount,
  })
  const outcome = result as Partial<StopHookOutcome>
  if (outcome.action === "continue") return { action: "continue", continuation: outcome.continuation }
  return { action: "stop", reason: outcome.reason }
})
```

- [ ] **Step 5: Invoke stop hooks in the runner loop**

In `packages/core/src/session/runner/llm.ts` `runTurnAttempt`, after `endAttempt` and before returning `{ needsContinuation: continuation, step }` when `!continuation`, evaluate stop hooks and, on `action: "continue"`, admit a synthetic input. Load the last assistant text from the store (`store.message(assistantMessageID)`) so the hook receives real output:

```ts
let stopBlockCount = 0
```

Declare `stopBlockCount` next to `needsContinuation` in `runTurnAttempt` (near line 280). Then, in the finalization block where `continuation` is computed (after `endAttempt`, around line 801):

```ts
if (!continuation && stream._tag === "Success" && !publisher.hasProviderError()) {
  const lastStored = yield* store.message(assistantMessageID)
  const lastText = lastStored?.sessionID === session.id && lastStored.message.type === "assistant"
    ? lastStored.message.content
        .filter((part): part is SessionMessage.AssistantText => part.type === "text")
        .map((part) => part.text)
        .join("")
    : undefined
  const stop = yield* SessionStopHook.evaluate({
    lastAssistantMessage: lastText,
    blockCount: stopBlockCount,
    agent: agent.id,
  })
  if (stop.action === "continue" && stop.continuation && stop.continuation.length > 0) {
    stopBlockCount += 1
    yield* commands
      .admitSynthetic({
        sessionID: session.id,
        text: stop.continuation.map((f) => f.text).join("\n"),
        description: "stop hook continuation",
      })
      .pipe(Effect.asVoid)
    continuation = true
  }
}
```

Note: `SessionMessage.AssistantText` is already imported in `llm.ts`. Import `SessionStopHook` at the top of the file.

- [ ] **Step 6: Run the tests**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-stop-hook.test.ts test/session-runner.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/plugin/runtime.ts packages/core/src/session/stop-hook.ts packages/core/src/session/runner/llm.ts packages/core/test/session-stop-hook.test.ts
git commit -m "feat(core): add durable stop and subagent-stop plugin hooks"
```

### Task 5: P1-4 — turn-scoped Responses WebSocket reuse (phase 1: connection reuse)

**Files:**
- Modify: `packages/llm/src/route/transport/websocket.ts` (pooling)
- Modify: `packages/core/src/session/runner/llm.ts` (turn-scoped transport)
- Test: `packages/llm/test/websocket-pool.test.ts` (new)

**Interfaces:**
- Produces: `WebSocketPool` keyed by `url + headers` with `acquire`/`release`, reusing an open connection until an error or explicit close.
- Consumes: `WebSocketExecutor.Service.open`, `LLMRequest`.

- [ ] **Step 1: Write the failing pool test**

Create `packages/llm/test/websocket-pool.test.ts`:

```ts
it.effect("reuses an open connection for repeated sends on the same key", () =>
  Effect.gen(function* () {
    const opened = yield* Ref.make(0)
    const executor = makeExecutorWithOpenCounter(opened)
    const pool = yield* WebSocketPool.make({ executor })
    const key = "ws://mock/key"
    const first = yield* pool.acquire(key)
    yield* pool.release(first)
    const second = yield* pool.acquire(key)
    expect((yield* opened.get)).toBe(1)
    expect(second).toBe(first)
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/llm`:

```powershell
bun test --timeout 30000 test/websocket-pool.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement WebSocketPool**

Add to `packages/llm/src/route/transport/websocket.ts`:

```ts
export type WebSocketPoolKey = { readonly url: string; readonly headersKey: string }

export interface WebSocketPool {
  readonly acquire: (key: WebSocketPoolKey) => Effect.Effect<WebSocketConnection, LLMError>
  readonly release: (connection: WebSocketConnection) => Effect.Effect<void>
  readonly closeAll: Effect.Effect<void>
}

export const makePool = (executor: Interface) =>
  Effect.gen(function* () {
    const cache = yield* Ref.make(new Map<WebSocketPoolKey, WebSocketConnection>())
    const acquire = (key: WebSocketPoolKey) =>
      Ref.modify(cache, (map) => {
        const existing = map.get(key)
        if (existing) return [Effect.succeed(existing), map] as const
        return [
          executor
            .open({ url: key.url, headers: Headers.fromInput({}) })
            .pipe(Effect.tap((conn) => Ref.update(cache, (m) => new Map(m).set(key, conn)))),
          map,
        ] as const
      }).pipe(Effect.flatten)
    const release = (connection: WebSocketConnection) =>
      Ref.update(cache, (map) => new Map(map)).pipe(
        Effect.andThen(connection.close),
      )
    const closeAll = Ref.get(cache).pipe(
      Effect.flatMap((map) =>
        Effect.forEach(Array.from(map.values()), (conn) => conn.close.pipe(Effect.ignore)),
      ),
      Effect.asVoid,
    )
    return { acquire, release, closeAll }
  })
```

- [ ] **Step 4: Run the pool test**

Run from `packages/llm`:

```powershell
bun test --timeout 30000 test/websocket-pool.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Wire the pool into the runner loop**

In `packages/core/src/session/runner/llm.ts`, create one pool per `runTurn` invocation, reuse it across `needsContinuation` iterations, and call `closeAll` in the run-loop `Effect.ensuring`. Only apply this path when the provider protocol is `openai-responses` and a WebSocket executor is available; otherwise fall back to per-request connections.

- [ ] **Step 6: Run runner tests**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-runner.test.ts
bun run typecheck
```

Run from `packages/llm`:

```powershell
bun test --timeout 30000 test/websocket-pool.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm/src/route/transport/websocket.ts packages/llm/test/websocket-pool.test.ts packages/core/src/session/runner/llm.ts
git commit -m "feat(llm): reuse Responses WebSocket within a turn continuation loop"
```

### Task 6: P2-5 — durable agent path on task_submission

**Files:**
- Modify: `packages/core/src/session/sql.ts:184-220` (add `agent_path` column)
- Create: `packages/core/src/database/migration/20260802XXXXXX_add_task_agent_path.ts`
- Modify: `packages/core/src/session/task-submission.ts` (row projection + submit)
- Modify: `packages/core/src/tool/task.ts` (compute agent path)
- Test: `packages/core/test/session-task-submission.test.ts`

**Interfaces:**
- Produces: `TaskSubmissionTable.agent_path: text` (nullable) — durable path like `/root/researcher`.
- Consumes: existing `parent_session_id` chain in `task.ts`.

- [ ] **Step 1: Write the failing projection test**

In `packages/core/test/session-task-submission.test.ts`:

```ts
it.effect("persists and recovers an agent path on the submission", () =>
  Effect.gen(function* () {
    // submit with agentPath "/root/researcher"
    const info = yield* submissions.submit({ ...baseInvocation, agentPath: "/root/researcher" })
    const recovered = yield* submissions.get(info.id)
    expect(recovered?.agentPath).toBe("/root/researcher")
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-task-submission.test.ts
```

Expected: FAIL — `agentPath` not accepted.

- [ ] **Step 3: Add the column and migration**

In `packages/core/src/session/sql.ts`, add `agent_path: text()` to `TaskSubmissionTable`. Create a migration file `packages/core/src/database/migration/20260802120000_add_task_agent_path.ts`:

```ts
import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802120000_add_task_agent_path",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task_submission\` ADD \`agent_path\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
```

- [ ] **Step 4: Update the task submission row type**

In `packages/core/src/session/task-submission.ts`, add `agentPath` to the `Invocation` type and to `toInfo`/`fromRow` mapping.

- [ ] **Step 5: Compute the agent path in task.ts**

In `packages/core/src/tool/task.ts`, build the path from the parent chain before `submissions.submit`:

```ts
const parentPath = await computeAgentPath(parent) // "/root" for root, "/root/worker" for nested
const agentPath = `${parentPath}/${agent.id}`
```

Pass `agentPath` into `submissions.submit`.

- [ ] **Step 6: Run the tests**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-task-submission.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/session/sql.ts packages/core/src/database/migration/20260802120000_add_task_agent_path.ts packages/core/src/session/task-submission.ts packages/core/src/tool/task.ts packages/core/test/session-task-submission.test.ts
git commit -m "feat(core): persist durable agent path on task submissions"
```

### Task 7: P2-6 — projection repair tool

**Files:**
- Create: `packages/core/src/session/repair.ts`
- Create: `packages/core/script/repair-projections.ts`
- Test: `packages/core/test/session-repair.test.ts`

**Interfaces:**
- Produces: `repairSession(db, events, sessionID): Effect.Effect<{ repaired: boolean }>` that replays durable events for a session and rebuilds any missing/divergent projection tables.
- Consumes: `EventV2.readAggregate`, `SessionAttempt.projectStarted`, `SessionInput.projectAdmitted`, existing projectors.

- [ ] **Step 1: Write the failing repair test**

Create `packages/core/test/session-repair.test.ts`:

```ts
it.effect("rebuilds a missing session_attempt row from the durable log", () =>
  Effect.gen(function* () {
    // publish Started/Ended events, then delete the attempt row
    // expect repairSession to restore it
    const result = yield* repairSession(db, events, sessionID)
    expect(result.repaired).toBe(true)
    const row = yield* SessionAttempt.get(db, sessionID)
    expect(row?.status).toBe("ended")
  }),
)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-repair.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement repairSession**

Create `packages/core/src/session/repair.ts`:

```ts
export * as SessionRepair from "./repair"

import { Effect, Option } from "effect"
import { EventV2 } from "../event"
import { SessionAttempt } from "./attempt"
import { SessionInput } from "./input"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { SessionEvent } from "./event"
import { SessionSchema } from "./schema"
import type { Database } from "../database/database"

export const repairSession = Effect.fn("SessionRepair.repairSession")(function* (
  db: Database.Interface["db"],
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
) {
  const history = yield* EventV2.readAggregate(db, {
    aggregateID: sessionID,
    limit: 10_000,
    manifest: SessionDurable,
  })
  let changed = false
  for (const event of history.events) {
    if (event.type === SessionEvent.ProviderAttempt.Started.type && event.durable) {
      const existing = yield* SessionAttempt.get(db, sessionID)
      if (!existing || existing.attempt_id !== event.data.attemptID) {
        // projectStarted expects the full Started event value (its caller replays from the log)
        yield* SessionAttempt.projectStarted(db, event as SessionEvent.ProviderAttempt.Started)
        changed = true
      }
    }
    if (event.type === SessionEvent.PromptAdmitted.type && event.durable) {
      const existing = yield* SessionInput.find(db, event.data.messageID)
      if (!existing) {
        yield* SessionInput.projectAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          synthetic: event.data.synthetic,
          delivery: event.data.delivery,
          timeCreated: event.data.timestamp,
        })
        changed = true
      }
    }
  }
  return { repaired: changed }
})
```

- [ ] **Step 4: Add the CLI entrypoint**

Create `packages/core/script/repair-projections.ts` that loads the database, accepts a `--session` argument, runs `repairSession`, and prints `repaired` or `up-to-date`.

- [ ] **Step 5: Run the tests**

Run from `packages/core`:

```powershell
bun test --timeout 30000 test/session-repair.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/repair.ts packages/core/script/repair-projections.ts packages/core/test/session-repair.test.ts
git commit -m "feat(core): add durable projection repair tool"
```

---

## Global Acceptance Checks

1. Every durable `PromptAdmitted` for a steer with a stale `expectedActiveAttemptID` fails with `ActiveAttemptConflictError`, and no `session_input` row or `PromptAdmitted` event is left behind (transaction rollback).
2. `subagent_max_concurrency` limits simultaneously running child sessions per parent; the permit outlives the tool call for background subagents and is released only when the child scope closes.
3. `session.stop`/`session.subagent.stop` hooks can stop or continue a turn; continuation injects a synthetic input; a per-turn block cap prevents infinite continuation; hook failures do not block normal turn ending.
4. Responses WebSocket connections are reused across continuation steps within one turn (phase 1); fallback preserves existing per-request behavior for other protocols.
5. `task_submission.agent_path` is durable and round-trips through submit/get.
6. `repairSession` rebuilds missing `session_attempt`/`session_input` projection rows from the durable event log.

## Out of Scope

- Durable subagent queueing (`task_submission` scheduler + crash recovery) — separate feature.
- `x-codex-turn-state` / incremental request (phase 2 of P1-4).
- Full agent role system (only `agentPath` is persisted).
- Generalizing unknown durable event backward compatibility.
