# OpenAI OAuth Attempt Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cancel abandoned V2 OAuth attempts so leaving and retrying OpenAI browser authorization releases `localhost:1455` and succeeds.

**Architecture:** Add a small generic lifecycle controller that owns connect-request generations and the accepted authorization attempt. The provider dialog delegates stale-response disposal, user cancellation, and successful completion to this controller while continuing to use the existing V2 `integration.oauth.cancel` endpoint.

**Tech Stack:** TypeScript, SolidJS, Bun test, generated OpenCode promise client

## Global Constraints

- Modify only the App OAuth dialog lifecycle; do not change OpenAI endpoints, callback port `1455`, provider protocols, Core concurrency rules, or generated clients.
- Cancellation is best-effort and must not replace the primary UI result.
- A connect response that arrives after cancellation must be canceled immediately.
- A successfully completed attempt must be cleared without sending cancellation.
- Run tests from `packages/app`, never the repository root.
- Run `bun run typecheck` from `packages/app`, never invoke `tsc` directly.
- The snapshot has no `.git` directory, so commit steps are unavailable.

---

### Task 1: OAuth Attempt Lifecycle Controller

**Files:**
- Create: `packages/app/src/utils/oauth-attempt-lifecycle.ts`
- Create: `packages/app/src/utils/oauth-attempt-lifecycle.test.ts`

**Interfaces:**
- Consumes: `(attempt: T) => Promise<unknown>` cancellation callback.
- Produces: `createOAuthAttemptLifecycle<T>(cancel)` with `begin()`, `accept(generation, attempt)`, `cancel(): Promise<void>`, and `complete()`.

- [ ] **Step 1: Write the failing lifecycle tests**

Create `packages/app/src/utils/oauth-attempt-lifecycle.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { createOAuthAttemptLifecycle } from "./oauth-attempt-lifecycle"

describe("createOAuthAttemptLifecycle", () => {
  test("cancels the accepted attempt", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })
    const generation = lifecycle.begin()

    expect(lifecycle.accept(generation, "first")).toBe(true)
    await lifecycle.cancel()

    expect(canceled).toEqual(["first"])
  })

  test("cancels a response that arrives after cancellation", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })
    const generation = lifecycle.begin()

    await lifecycle.cancel()

    expect(lifecycle.accept(generation, "late")).toBe(false)
    expect(canceled).toEqual(["late"])
  })

  test("accepts only the current generation", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })
    const first = lifecycle.begin()
    const second = lifecycle.begin()

    expect(lifecycle.accept(first, "stale")).toBe(false)
    expect(lifecycle.accept(second, "current")).toBe(true)
    await lifecycle.cancel()

    expect(canceled).toEqual(["stale", "current"])
  })

  test("completes without canceling the accepted attempt", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })
    const generation = lifecycle.begin()

    expect(lifecycle.accept(generation, "complete")).toBe(true)
    lifecycle.complete()
    await lifecycle.cancel()

    expect(canceled).toEqual([])
  })

  test("swallows cancellation rejection", async () => {
    const lifecycle = createOAuthAttemptLifecycle(async () => {
      throw new Error("already terminal")
    })
    const generation = lifecycle.begin()

    lifecycle.accept(generation, "attempt")
    await expect(lifecycle.cancel()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts
```

Expected: FAIL because `./oauth-attempt-lifecycle` does not exist.

- [ ] **Step 3: Implement the minimal lifecycle controller**

Create `packages/app/src/utils/oauth-attempt-lifecycle.ts`:

```ts
export function createOAuthAttemptLifecycle<T>(cancel: (attempt: T) => Promise<unknown>) {
  let generation = 0
  let active: T | undefined

  const discard = (attempt: T) => cancel(attempt).then(() => undefined, () => undefined)

  return {
    begin() {
      generation += 1
      return generation
    },
    accept(value: number, attempt: T) {
      if (value !== generation) {
        discard(attempt)
        return false
      }
      active = attempt
      return true
    },
    cancel() {
      generation += 1
      const attempt = active
      active = undefined
      if (attempt === undefined) return Promise.resolve()
      return discard(attempt)
    },
    complete() {
      generation += 1
      active = undefined
    },
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts
```

Expected: 5 tests pass with no unhandled rejection.

### Task 2: Provider Dialog Integration

**Files:**
- Modify: `packages/app/src/components/dialog-connect-provider.tsx:1-40`
- Modify: `packages/app/src/components/dialog-connect-provider.tsx:380-570`
- Modify: `packages/app/src/components/dialog-connect-provider.tsx:699-731`

**Interfaces:**
- Consumes: `createOAuthAttemptLifecycle<IntegrationOauthConnectOutput["data"]>`.
- Produces: a dialog that cancels active or late OAuth attempts on reset and cleanup, and clears tracking on success.

- [ ] **Step 1: Import and instantiate the lifecycle**

Add:

```ts
import { createOAuthAttemptLifecycle } from "@/utils/oauth-attempt-lifecycle"
```

After `location`, create:

```ts
const oauth = createOAuthAttemptLifecycle<IntegrationOauthConnectOutput["data"]>((authorization) =>
  serverSDK().api.integration.oauth.cancel({
    attemptID: authorization.attemptID,
    location: location(),
  }),
)
```

- [ ] **Step 2: Cancel on component cleanup**

Update the existing cleanup:

```ts
onCleanup(() => {
  alive.value = false
  void oauth.cancel()
  if (timer.current === undefined) return
  clearTimeout(timer.current)
  timer.current = undefined
})
```

- [ ] **Step 3: Guard connect responses with a generation**

In the OAuth branch of `selectMethod`, begin before the request:

```ts
const generation = oauth.begin()
```

Accept the returned authorization before dispatch:

```ts
.then((x) => {
  if (!oauth.accept(generation, x.data)) return
  if (!alive.value) {
    oauth.cancel()
    return
  }
  dispatch({ type: "auth.complete", authorization: x.data })
})
```

This ensures that cleanup or back navigation invalidates the generation and that
a late response is canceled rather than stored.

- [ ] **Step 4: Cancel on back and clear on success**

Make `goBack` asynchronous and await cancellation before resetting the method
state:

```ts
await oauth.cancel()
```

At the start of `complete`, add:

```ts
oauth.complete()
```

The first releases an abandoned callback server before an immediate retry can
be selected. The second prevents dialog cleanup from canceling a successfully
completed authorization.

- [ ] **Step 5: Run focused and nearby App tests**

Run from `packages/app`:

```powershell
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts ./src/utils/server-compat.test.ts
```

Expected: all focused lifecycle and compatibility tests pass.

- [ ] **Step 6: Run App typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no errors in `oauth-attempt-lifecycle.ts`,
`oauth-attempt-lifecycle.test.ts`, or `dialog-connect-provider.tsx`. The command
may still report the snapshot's pre-existing broad V1/V2 client alias errors;
record those separately and do not attribute them to this change.

### Task 3: Dev Desktop Regression Verification

**Files:**
- No source changes.

**Interfaces:**
- Consumes: the running Electron dev application and V2 integration endpoints.
- Produces: evidence that canceling an attempt releases port `1455` and permits an immediate retry.

- [ ] **Step 1: Reload the dev renderer after HMR**

Open Settings, select Providers, and open the OpenAI connection dialog.

- [ ] **Step 2: Start and abandon browser OAuth**

Select `ChatGPT Pro/Plus (browser)`, verify the dialog enters the waiting state,
then press Back.

- [ ] **Step 3: Verify callback port release**

Run:

```powershell
Test-NetConnection -ComputerName localhost -Port 1455 -InformationLevel Quiet
```

Expected after Back: `False`.

- [ ] **Step 4: Retry browser OAuth**

Select `ChatGPT Pro/Plus (browser)` again.

Expected:

- `POST /api/integration/openai/connect/oauth` returns HTTP 200;
- the dialog enters the waiting state instead of showing
  `Authentication failed`;
- port `1455` is listening during the active attempt.

- [ ] **Step 5: Close the dialog and verify final cleanup**

Close the connection dialog, run the port probe again, and expect `False`.
