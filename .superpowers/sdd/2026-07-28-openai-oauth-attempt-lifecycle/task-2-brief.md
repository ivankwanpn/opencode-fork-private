# Task 2: Provider Dialog Integration

## Context

`ProviderConnection` in
`packages/app/src/components/dialog-connect-provider.tsx` starts V2 OAuth
attempts but currently abandons them when the user goes back, closes the
dialog, or the component unmounts. OpenAI browser OAuth owns
`localhost:1455`, so an abandoned attempt makes the next attempt fail.

Task 1 added:

`packages/app/src/utils/oauth-attempt-lifecycle.ts`

with
`createOAuthAttemptLifecycle<T>(cancel)`, `begin()`,
`accept(generation, attempt)`, `cancel(): Promise<void>`, and `complete()`.

## File

- Modify only:
  `packages/app/src/components/dialog-connect-provider.tsx`

## Required Integration

1. Import `createOAuthAttemptLifecycle` from
   `@/utils/oauth-attempt-lifecycle`.
2. In `ProviderConnection`, after `location`, instantiate:

```ts
const oauth = createOAuthAttemptLifecycle<IntegrationOauthConnectOutput["data"]>((authorization) =>
  serverSDK().api.integration.oauth.cancel({
    attemptID: authorization.attemptID,
    location: location(),
  }),
)
```

3. In the existing `onCleanup`, set `alive.value = false`, then start
   `void oauth.cancel()` before timer cleanup. Cleanup remains non-blocking.
4. In the OAuth branch of `selectMethod`, call `const generation =
   oauth.begin()` immediately before the connect request.
5. In the fulfilled connect handler:

```ts
if (!oauth.accept(generation, x.data)) return
if (!alive.value) {
  void oauth.cancel()
  return
}
dispatch({ type: "auth.complete", authorization: x.data })
```

This ordering is required: a response arriving after cleanup or Back must be
accepted/rejected by the lifecycle before checking `alive`, otherwise its
server-side attempt leaks.
6. Make `goBack` asynchronous. Start it with `await oauth.cancel()` and only
   then reset the method state or call `props.onBack()`. This ordering prevents
   a fast retry from racing callback-server shutdown.
7. At the start of successful UI `complete()`, call `oauth.complete()` before
   query refetch or dialog close. Cleanup must not cancel a successfully
   completed authorization.
8. Keep existing connect and complete errors visible. Cancellation errors are
   swallowed by the lifecycle and must not replace the primary UI result.

## Verification

Run from `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts ./src/utils/server-compat.test.ts
bun run typecheck
```

Record pre-existing typecheck failures separately. Do not attribute them to
this change unless they reference the lifecycle or dialog edits.

## Global Constraints

- Modify only the App OAuth dialog lifecycle.
- Do not change OpenAI endpoints, callback port `1455`, provider protocols,
  Core concurrency rules, generated clients, or unrelated UI.
- Cancellation is best-effort and must not replace the primary UI result.
- A late connect response must be canceled immediately.
- A successfully completed attempt must be cleared without cancellation.
- Follow repository `AGENTS.md` style.
- Run tests and `bun run typecheck` from `packages/app`, never repository root.
- This snapshot has no `.git`; do not attempt commits.

## Report

Write the full report to:

`D:\opencode-bugfix\opencode-fork\.superpowers\sdd\2026-07-28-openai-oauth-attempt-lifecycle\task-2-report.md`

Include the exact code paths changed, test/typecheck commands and results,
self-review, and concerns.
