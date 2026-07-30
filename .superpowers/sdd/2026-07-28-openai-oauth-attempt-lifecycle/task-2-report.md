# Task 2 Report: Provider Dialog Integration

## Files Changed

- `packages/app/src/components/dialog-connect-provider.tsx`

## Implementation

- Imported and instantiated `createOAuthAttemptLifecycle` with the existing
  V2 `integration.oauth.cancel` endpoint.
- Component cleanup now marks the component dead and starts best-effort OAuth
  cancellation before clearing the existing timer.
- Each OAuth connect request now owns a lifecycle generation. Fulfilled
  responses are accepted through the lifecycle before checking `alive`, so a
  response arriving after Back or cleanup is canceled instead of leaked.
- Back now awaits cancellation before resetting the method state or leaving
  the provider.
- Successful completion clears lifecycle tracking before refetching providers
  and closing the dialog, preventing cleanup from canceling a completed
  authorization.

## Verification

Run from `D:\opencode-bugfix\opencode-fork\packages\app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts ./src/utils/server-compat.test.ts
```

Result:

```text
22 pass
0 fail
50 expect() calls
```

Also ran:

```powershell
bun run typecheck
```

The command exited with code 1 because this snapshot has broad pre-existing
V1/V2 client alias failures. The first dialog errors are the existing missing
`IntegrationMethod` and `IntegrationOauthConnectOutput` exports from the
vendored `@opencode-ai/client/promise`; those cascade into existing implicit
`any` errors throughout the same file. The output did not report an error in
`oauth-attempt-lifecycle.ts`, and it did not identify a new lifecycle call-site
contract error.

## Self-Review

- The fulfilled connect response is passed to `oauth.accept` before the
  `alive` guard, preserving late-response disposal.
- Cleanup uses `void oauth.cancel()` because component teardown cannot await.
- Back awaits `oauth.cancel()` so the method list is not exposed while the
  callback server is still shutting down.
- `complete()` calls `oauth.complete()` before any awaited work or dialog
  teardown.
- No endpoints, ports, protocols, generated clients, Core code, or unrelated
  UI behavior were changed.

## Concerns

Package-wide typecheck cannot be made green within this task's scope because
the source snapshot's app imports legacy singular client symbols while the
vendored promise client exports plural V2 names.
