# Final OAuth Attempt Lifecycle Review Package

Base: isolated source snapshot before this change
Head: working source snapshot after Tasks 1-3
Git range: unavailable because the target snapshot has no `.git`

Requirements:

- Cancel abandoned V2 OAuth attempts on Back, dialog close, and component
  cleanup.
- Await Back cancellation before exposing an immediate retry.
- Cancel a connect response that arrives after cancellation or cleanup.
- Clear successful attempts without sending cancellation.
- Swallow cancellation errors so cleanup never replaces the primary UI result.
- Do not change endpoints, callback port `1455`, protocols, Core concurrency,
  or generated clients.

## Stat

```text
packages/app/src/utils/oauth-attempt-lifecycle.ts      | 35 insertions
packages/app/src/utils/oauth-attempt-lifecycle.test.ts | 84 insertions
packages/app/src/components/dialog-connect-provider.tsx| 17 insertions, 1 deletion
```

## Full Source: Lifecycle Controller

```ts
export function createOAuthAttemptLifecycle<T>(cancel: (attempt: T) => Promise<unknown>) {
  let generation = 0
  let active: T | undefined

  function discard(attempt: T) {
    return cancel(attempt).then(
      () => undefined,
      () => undefined,
    )
  }

  return {
    begin() {
      generation++
      return generation
    },
    accept(attemptGeneration: number, attempt: T) {
      if (attemptGeneration !== generation) {
        void discard(attempt)
        return false
      }
      active = attempt
      return true
    },
    cancel() {
      generation++
      const attempt = active
      active = undefined
      if (attempt === undefined) return Promise.resolve()
      return discard(attempt)
    },
    complete() {
      generation++
      active = undefined
    },
  }
}
```

## Full Source: Lifecycle Tests

```ts
import { describe, expect, test } from "bun:test"
import { createOAuthAttemptLifecycle } from "./oauth-attempt-lifecycle"

describe("createOAuthAttemptLifecycle", () => {
  test("cancels an accepted attempt", async () => {
    const cancellation = Promise.withResolvers<void>()
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
      await cancellation.promise
    })

    const generation = lifecycle.begin()
    expect(lifecycle.accept(generation, "attempt")).toBeTrue()
    const result = lifecycle.cancel()

    expect(canceled).toEqual(["attempt"])
    expect(
      await Promise.race([
        result.then(() => "settled"),
        Bun.sleep(0).then(() => "pending"),
      ]),
    ).toBe("pending")

    cancellation.resolve()
    await expect(result).resolves.toBeUndefined()
  })

  test("cancels a response that arrives after cancellation", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })

    const generation = lifecycle.begin()
    await lifecycle.cancel()

    expect(lifecycle.accept(generation, "late-attempt")).toBeFalse()
    expect(canceled).toEqual(["late-attempt"])
  })

  test("accepts only the current generation", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })

    const staleGeneration = lifecycle.begin()
    const currentGeneration = lifecycle.begin()

    expect(lifecycle.accept(staleGeneration, "stale-attempt")).toBeFalse()
    expect(lifecycle.accept(currentGeneration, "current-attempt")).toBeTrue()
    await lifecycle.cancel()

    expect(canceled).toEqual(["stale-attempt", "current-attempt"])
  })

  test("completes without canceling an accepted attempt", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })

    const generation = lifecycle.begin()
    expect(lifecycle.accept(generation, "attempt")).toBeTrue()
    lifecycle.complete()
    expect(lifecycle.accept(generation, "late-attempt")).toBeFalse()
    await lifecycle.cancel()

    expect(canceled).toEqual(["late-attempt"])
  })

  test("resolves cancellation when the cancellation callback rejects", async () => {
    const lifecycle = createOAuthAttemptLifecycle(async () => {
      throw new Error("cancellation failed")
    })

    const generation = lifecycle.begin()
    lifecycle.accept(generation, "attempt")

    await expect(lifecycle.cancel()).resolves.toBeUndefined()
  })
})
```

## Dialog Integration Diff

```diff
--- packages/app/src/components/dialog-connect-provider.tsx (base)
+++ packages/app/src/components/dialog-connect-provider.tsx (head)
@@
 import { CustomProviderForm } from "./dialog-custom-provider"
 import { decode64 } from "@/utils/base64"
+import { createOAuthAttemptLifecycle } from "@/utils/oauth-attempt-lifecycle"
 import { pathKey } from "@/utils/path-key"
@@
   const location = () => {
     const value = directory()
     return value ? { directory: value } : undefined
   }
+  const oauth = createOAuthAttemptLifecycle<IntegrationOauthConnectOutput["data"]>((authorization) =>
+    serverSDK().api.integration.oauth.cancel({
+      attemptID: authorization.attemptID,
+      location: location(),
+    }),
+  )
@@
   onCleanup(() => {
     alive.value = false
+    void oauth.cancel()
@@
       dispatch({ type: "auth.pending" })
+      const generation = oauth.begin()
       await serverSDK()
@@
         .then((x) => {
-          if (!alive.value) return
+          if (!oauth.accept(generation, x.data)) return
+          if (!alive.value) {
+            void oauth.cancel()
+            return
+          }
           dispatch({ type: "auth.complete", authorization: x.data })
@@
   async function complete() {
+    oauth.complete()
@@
-  function goBack() {
+  async function goBack() {
+    await oauth.cancel()
```

## Verification Evidence

Focused App tests, run from `packages/app`:

```text
bun test --preload ./happydom.ts ./src/utils/oauth-attempt-lifecycle.test.ts ./src/utils/server-compat.test.ts
22 pass
0 fail
50 expect() calls
```

Package typecheck was run and exited `1` on the snapshot's existing client
alias mismatch, beginning with missing `IntegrationMethod` and
`IntegrationOauthConnectOutput` exports from the vendored promise client and
continuing across the App. It reported no error in the new lifecycle file.

Electron dev regression:

```text
initial localhost:1455 = False
first POST /api/integration/openai/connect/oauth = 200
active localhost:1455 = True
Back -> method list visible
after Back localhost:1455 = False
immediate retry POST /api/integration/openai/connect/oauth = 200
retry -> waiting-for-authorization state
close -> DELETE /api/integration/attempt/{attemptID} = 204
final localhost:1455 = False
```
