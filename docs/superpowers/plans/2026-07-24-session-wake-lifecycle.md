# Session Wake And Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure compatibility HTTP prompt/command admission cannot lose a busy-Session wake, and publish exactly one continuous native busy/idle lifecycle plus one execution-error projection per ownership chain.

**Architecture:** Keep durable admission in `SessionV2.prompt` / `SessionV2.command`, canonical scheduling in `SessionExecution.wake`, and observation in `SessionV2.wait`. Extend the process-local coordinator with ownership-transition hooks so lifecycle publication surrounds the entire current/successor chain, including exclusive ownership, rather than each individual runner drain. Compatibility handlers only admit, optionally wait, and map HTTP responses; they do not synthesize native status or execution-error events.

**Tech Stack:** TypeScript, Effect v4, Bun test, Core `SessionRunCoordinator`, Core `SessionExecution`, OpenCode typed `HttpApi`.

## Global Constraints

- The project owner explicitly rejected TDD for Phase 8. Author implementation and complete focused coverage together, but do not run tests, typecheck, formatter, build, imports, compilation, repository code, or Git until the complete Phase 8 gate.
- Preserve `SessionRunCoordinator.run()` as join-only and `wake()` as the sole coalesced-successor registration API.
- Preserve one process-global, Session-ID-keyed execution coordinator; Location-scoped runner services remain resolved only when an ownership drain starts.
- Native execution owns lifecycle and execution-error publication. Compatibility handlers must not publish duplicate native status or error events.
- One ownership chain emits exactly `busy` on absent-to-active and `idle` plus the legacy idle marker on active-to-absent. A coalesced or failure-replacement successor emits no intermediate lifecycle transition.
- Completion waiters do not return before the final idle publication for the ownership chain they observed.
- Preserve interruption, exclusive shell/compaction, concurrent different-Session execution, force/join/wait, and trampoline behavior.
- Do not modify protocol schemas or generated clients.
- This checkout has no Git metadata. Work in place, create filesystem baselines, review with `git diff --no-index`, and do not commit.

---

### Task 1: Canonical Wake, Ownership Lifecycle, And Compatibility Projection

**Files:**
- Modify: `packages/core/src/session/run-coordinator.ts`
- Modify: `packages/core/src/session/execution/local.ts`
- Modify: `packages/core/test/session-run-coordinator.test.ts`
- Modify as needed for native integration coverage: `packages/core/test/session-wait.test.ts`
- Modify as needed for native error/lifecycle coverage: `packages/core/test/session-runner.test.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Create: `.superpowers/sdd/phase8-session-lifecycle-report.md`

**Interfaces:**
- Consumes: `SessionV2.prompt()` and `SessionV2.command()` register `SessionExecution.wake(sessionID)` when `resume !== false` and `commit !== true`.
- Consumes: `SessionV2.wait(sessionID)` delegates to `SessionExecution.wait(sessionID)` and observes current plus registered successor ownership without starting a drain.
- Preserves: `SessionRunCoordinator.run(key)` joins active ownership and never records `pendingWake`.
- Produces: optional coordinator lifecycle hooks with no error channel:

```ts
type Lifecycle<Key> = {
  readonly onActive: (key: Key) => Effect.Effect<void>
  readonly onIdle: (key: Key) => Effect.Effect<void>
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
  readonly lifecycle?: Lifecycle<Key>
}): Effect.Effect<Coordinator<Key, E>, never, Scope.Scope>
```

- Produces: compatibility synchronous handlers admit with canonical wake enabled, then call `sessionV2.wait(canonicalID)` before selecting the response.
- Produces: compatibility async prompt admission registers the wake before returning `204` and does not wait.
- Produces: the compatibility status endpoint merges canonical active Session IDs as `{ type: "busy" }` with genuinely legacy `SessionStatus` entries.

- [ ] **Step 1: Preserve the root-cause evidence in the report**

Create `.superpowers/sdd/phase8-session-lifecycle-report.md` and record:

```markdown
# Phase 8 Session Wake And Lifecycle Report

## Root Causes

1. Compatibility handlers used `resume: false` and then `SessionV2.resume()`.
   `resume()` joins active ownership but cannot set `pendingWake`, so admitted
   work can remain pending after a busy drain passes its inbox cutoff.
2. `SessionExecutionLocal` published busy/idle around each drain instead of
   the coordinator's absent/active ownership transition.
3. Compatibility handlers and native execution both published status and
   execution-error events.
```

- [ ] **Step 2: Author coordinator ownership-transition coverage**

Add focused tests to `packages/core/test/session-run-coordinator.test.ts` using `Deferred` readiness signals, never fixed sleeps. The tests must assert exact transition arrays and cover:

```ts
expect(transitions).toEqual(["busy:session", "idle:session"])
```

- one initial drain;
- multiple coalesced successful wakes;
- failed drain followed by a registered replacement successor;
- interruption without a successor;
- wake during interruption cleanup followed by a successor;
- `exclusive()` ownership;
- two different keys running concurrently;
- `wait()` remains blocked while `onIdle` is gated and completes only after the idle hook finishes.

The hooks must default to no-ops so existing coordinator consumers remain source-compatible.

- [ ] **Step 3: Move lifecycle publication to coordinator ownership hooks**

In `packages/core/src/session/run-coordinator.ts`, invoke `onActive` once before the first owner work for a previously absent key. Keep the key owned across successful coalesced successors and failure-replacement successors. Invoke `onIdle` once before the final chain completion becomes observable to `wait()` and joined owners.

The state machine must distinguish:

```text
absent -> active: onActive
active -> successful successor: no hook
active -> failure replacement successor: no hook
active -> stopping cleanup + wake successor: no hook
active -> absent: onIdle
```

Do not clear a wake that arrives during interruption cleanup. Do not let lifecycle-hook execution create concurrent owner fibers or an unbounded self-retry.

- [ ] **Step 4: Make native execution the lifecycle/error owner**

In `packages/core/src/session/execution/local.ts`:

- Keep runner lookup and `SessionRunner.run({ sessionID, force })` in `drain`.
- Keep exactly one non-interruption `SessionV1.Event.Error` publication and one log for each failed native drain.
- Remove per-drain busy/idle publication.
- Supply coordinator hooks that load the Session Location and publish:

```ts
SessionStatusEvent.Status { status: { type: "busy" } }
SessionStatusEvent.Status { status: { type: "idle" } }
SessionStatusEvent.Idle
```

Publish `busy` only in `onActive`; publish `idle` followed by the legacy idle marker only in `onIdle`.

- [ ] **Step 5: Route compatibility admission through wake plus wait**

In `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`:

- Delete the helper that wraps `SessionV2.resume()` with `SessionStatus.Service.set(busy/idle)`.
- For synchronous canonical `prompt`, `command`, and `init`, allow admission to register the canonical wake, then call `sessionV2.wait(canonicalID)` before response lookup/return.
- Preserve `noReply` prompt semantics: `commit: true` promotes without starting execution and returns the projected user message immediately.
- For canonical `promptAsync`, allow admission to register the wake and return `204` without waiting.
- Do not publish `Session.Event.Error` for a native async drain failure; native execution already owns that projection. Keep request-context logging if it remains useful.
- Keep legacy-only prompt/command branches unchanged.
- Implement status as deterministic merge where canonical active IDs override stale legacy entries as busy:

```ts
const legacy = Object.fromEntries(yield* statusSvc.list())
const active = yield* sessionV2.active
return Object.fromEntries([
  ...Object.entries(legacy),
  ...Array.from(active, (sessionID) => [sessionID, { type: "busy" } as const]),
])
```

- [ ] **Step 6: Author busy compatibility and projection coverage**

In `packages/opencode/test/server/httpapi-session.test.ts`, reuse the real typed route and LLM readiness helpers. Add discriminating coverage for:

- a synchronous prompt admitted while the Session is busy registers a successor, consumes the new input, and waits for the successor response;
- canonical command and init admission while busy cannot lose the successor wake;
- canonical async prompt returns before the registered successor completes;
- the status endpoint reports canonical active Sessions as busy without requiring compatibility `SessionStatus.set`;
- one native drain failure produces exactly one legacy Session error event;
- one coalesced successor chain produces one busy and one final idle, with no intermediate idle/busy pair.

Assertions must observe readiness via LLM request counts, `Deferred`, event subscriptions, or status state. Do not use fixed sleeps.

- [ ] **Step 7: Perform static self-review only**

Without executing repository code, inspect all changed call sites and confirm:

- no compatibility canonical path still combines `resume: false` with `SessionV2.resume()`;
- no compatibility canonical path republishes native status or execution errors;
- `wait()` cannot finish before `onIdle`;
- failure replacement and interruption-cleanup wake preserve one ownership lifecycle;
- legacy-only branches remain unchanged;
- all requested tests are authored and use readiness signals.

Append exact files changed, coverage map, remaining concerns, and an explicit no-executable-verification statement to the report.
