# Task 1 Review Package

Base: isolated snapshot before Task 1 (both files absent)
Head: working snapshot after Task 1
Commits: unavailable because this snapshot has no `.git`

## Stat

```text
packages/app/src/utils/oauth-attempt-lifecycle.ts      | 35 +++++++++++++++++++
packages/app/src/utils/oauth-attempt-lifecycle.test.ts | 73 +++++++++++++++++++++++++++++++++++++++
2 files changed, 108 insertions(+)
```

## Full Diff

```diff
--- /dev/null
+++ packages/app/src/utils/oauth-attempt-lifecycle.ts
@@
+export function createOAuthAttemptLifecycle<T>(cancel: (attempt: T) => Promise<unknown>) {
+  let generation = 0
+  let active: T | undefined
+
+  function discard(attempt: T) {
+    return cancel(attempt).then(
+      () => undefined,
+      () => undefined,
+    )
+  }
+
+  return {
+    begin() {
+      generation++
+      return generation
+    },
+    accept(attemptGeneration: number, attempt: T) {
+      if (attemptGeneration !== generation) {
+        void discard(attempt)
+        return false
+      }
+      active = attempt
+      return true
+    },
+    cancel() {
+      generation++
+      const attempt = active
+      active = undefined
+      if (attempt === undefined) return Promise.resolve()
+      return discard(attempt)
+    },
+    complete() {
+      generation++
+      active = undefined
+    },
+  }
+}
--- /dev/null
+++ packages/app/src/utils/oauth-attempt-lifecycle.test.ts
@@
+import { describe, expect, test } from "bun:test"
+import { createOAuthAttemptLifecycle } from "./oauth-attempt-lifecycle"
+
+describe("createOAuthAttemptLifecycle", () => {
+  test("cancels an accepted attempt", async () => {
+    const canceled: string[] = []
+    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
+      canceled.push(attempt)
+    })
+
+    const generation = lifecycle.begin()
+    expect(lifecycle.accept(generation, "attempt")).toBeTrue()
+    await lifecycle.cancel()
+
+    expect(canceled).toEqual(["attempt"])
+  })
+
+  test("cancels a response that arrives after cancellation", async () => {
+    const canceled: string[] = []
+    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
+      canceled.push(attempt)
+    })
+
+    const generation = lifecycle.begin()
+    await lifecycle.cancel()
+
+    expect(lifecycle.accept(generation, "late-attempt")).toBeFalse()
+    expect(canceled).toEqual(["late-attempt"])
+  })
+
+  test("accepts only the current generation", async () => {
+    const canceled: string[] = []
+    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
+      canceled.push(attempt)
+    })
+
+    const staleGeneration = lifecycle.begin()
+    const currentGeneration = lifecycle.begin()
+
+    expect(lifecycle.accept(staleGeneration, "stale-attempt")).toBeFalse()
+    expect(lifecycle.accept(currentGeneration, "current-attempt")).toBeTrue()
+    await lifecycle.cancel()
+
+    expect(canceled).toEqual(["stale-attempt", "current-attempt"])
+  })
+
+  test("completes without canceling an accepted attempt", () => {
+    const canceled: string[] = []
+    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
+      canceled.push(attempt)
+    })
+
+    const generation = lifecycle.begin()
+    expect(lifecycle.accept(generation, "attempt")).toBeTrue()
+    lifecycle.complete()
+
+    expect(canceled).toEqual([])
+  })
+
+  test("resolves cancellation when the cancellation callback rejects", async () => {
+    const lifecycle = createOAuthAttemptLifecycle(async () => {
+      throw new Error("cancellation failed")
+    })
+
+    const generation = lifecycle.begin()
+    lifecycle.accept(generation, "attempt")
+
+    await expect(lifecycle.cancel()).resolves.toBeUndefined()
+  })
+})
```
