# Task 1 Report: OAuth Attempt Lifecycle Controller

## Files Changed

- `packages/app/src/utils/oauth-attempt-lifecycle.ts` (created)
- `packages/app/src/utils/oauth-attempt-lifecycle.test.ts` (created)

## TDD Evidence

### RED

Command, run from `D:\opencode-bugfix\opencode-fork\packages\app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts
```

Relevant output:

```text
error: Cannot find module './oauth-attempt-lifecycle' from
'D:\opencode-bugfix\opencode-fork\packages\app\src\utils\oauth-attempt-lifecycle.test.ts'

0 pass
1 fail
1 error
```

The test suite failed because the lifecycle module did not yet exist, as
required. An initial sandboxed invocation could not read snapshot files; the
recorded RED run used the same command with the required filesystem access.

### GREEN

Command, run from `D:\opencode-bugfix\opencode-fork\packages\app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts
```

Relevant output:

```text
(pass) createOAuthAttemptLifecycle > cancels an accepted attempt
(pass) createOAuthAttemptLifecycle > cancels a response that arrives after cancellation
(pass) createOAuthAttemptLifecycle > accepts only the current generation
(pass) createOAuthAttemptLifecycle > completes without canceling an accepted attempt
(pass) createOAuthAttemptLifecycle > resolves cancellation when the cancellation callback rejects

5 pass
0 fail
10 expect() calls
```

## TDD Reasoning

The five tests were written before the module existed. They name the observable
failure each protects: an active attempt not being cancelled, a late response
being retained, a stale generation being accepted, completion sending a
cancellation, and a rejected cancellation escaping to the caller. The minimal
implementation uses one numeric generation and one `T | undefined` active
slot. A shared discard operation converts either cancellation settlement into
`undefined`; stale accepts launch it without awaiting, while `cancel` returns
it for the active attempt after clearing that slot.

## Self-Review

- `begin`, `cancel`, and `complete` each advance the generation, invalidating
  prior responses.
- `accept` stores only a current-generation attempt; stale attempts are
  discarded immediately and never become active.
- `cancel` clears the active slot before invoking external cancellation work,
  preventing repeat cancellation through re-entrancy.
- `complete` clears the active slot without invoking the callback.
- Both rejection paths from the cancellation callback settle successfully,
  avoiding an unhandled rejection from a stale response or caller-visible
  rejection from `cancel`.

## Concerns

None. The supplied interface intentionally models the active slot as
`T | undefined`; callers should provide an attempt value distinct from
`undefined`, as OAuth attempts normally are.

## Fix Round 1

The task review found two important test gaps:

- `cancel()` was not proven to remain pending until external cancellation
  settled.
- `complete()` was not proven to clear the active attempt and invalidate its
  generation.

Updated the accepted-attempt test to hold the cancellation callback on a
deferred Promise, verify the lifecycle Promise remains pending, release it, and
verify successful settlement. Updated the completion test to reject and discard
an old-generation response after completion, then call `cancel()` and verify
the completed active attempt is not canceled.

Command, run from `D:\opencode-bugfix\opencode-fork\packages\app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts
```

Result:

```text
5 pass
0 fail
13 expect() calls
```
