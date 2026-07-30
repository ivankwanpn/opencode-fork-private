# Task 1: OAuth Attempt Lifecycle Controller

## Context

The V2 provider dialog must own and dispose OAuth attempts. This task adds the
small generic lifecycle controller only; dialog integration is a later task.

## Files

- Create: `packages/app/src/utils/oauth-attempt-lifecycle.ts`
- Create: `packages/app/src/utils/oauth-attempt-lifecycle.test.ts`

## Interface

Consume a cancellation callback `(attempt: T) => Promise<unknown>`.

Produce `createOAuthAttemptLifecycle<T>(cancel)` with:

- `begin(): number`
- `accept(generation: number, attempt: T): boolean`
- `cancel(): Promise<void>`
- `complete(): void`

## Required Behavior

- `begin` invalidates older connect responses and returns the current
  generation.
- `accept` stores an attempt only when its generation is current.
- A stale `accept` returns `false` and starts best-effort cancellation of that
  stale attempt immediately.
- `cancel` invalidates in-flight responses, clears the active attempt before
  external work, and returns a Promise that resolves after active-attempt
  cancellation settles.
- `cancel` must resolve, not reject, when the cancellation callback rejects.
- `complete` invalidates in-flight responses and clears the active attempt
  without sending cancellation.
- A response arriving after `cancel` must be rejected and canceled.
- When generations change, only the stale response and current active attempt
  are canceled.

## TDD Requirements

Write tests first for:

1. Canceling an accepted attempt.
2. Canceling a response that arrives after cancellation.
3. Accepting only the current generation.
4. Completing without canceling the accepted attempt.
5. Resolving cancellation when the cancellation callback rejects:
   `await expect(lifecycle.cancel()).resolves.toBeUndefined()`.

Run RED and GREEN from `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts
```

RED must fail because the lifecycle module does not exist. GREEN must report
all five tests passing without an unhandled rejection.

## Minimal Implementation Shape

Use a numeric generation and one `T | undefined` active slot. A discard
operation invokes the callback and converts either fulfillment or rejection to
`undefined`. Stale `accept` starts discard with `void`; `cancel` returns the
discard Promise when an active attempt exists and `Promise.resolve()` when it
does not.

## Global Constraints

- Modify only the two Task 1 files.
- Do not change OpenAI endpoints, callback port `1455`, provider protocols,
  Core concurrency rules, or generated clients.
- Cancellation is best-effort and must not replace the primary UI result.
- Follow the repository `AGENTS.md` style.
- Run tests from `packages/app`, never from repository root.
- The snapshot has no `.git`; do not attempt commits.

## Report

Write the full report to:

`D:\opencode-bugfix\opencode-fork\.superpowers\sdd\2026-07-28-openai-oauth-attempt-lifecycle\task-1-report.md`

Include files changed, RED and GREEN command/output evidence, self-review, and
concerns.
