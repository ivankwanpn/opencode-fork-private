# Task 1 Fix Round 1 Review Package

Scope: changes made only to address the two Important test findings.
Commits: unavailable because this snapshot has no `.git`.

```diff
--- packages/app/src/utils/oauth-attempt-lifecycle.test.ts (before fix round 1)
+++ packages/app/src/utils/oauth-attempt-lifecycle.test.ts (after fix round 1)
@@
   test("cancels an accepted attempt", async () => {
+    const cancellation = Promise.withResolvers<void>()
     const canceled: string[] = []
     const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
       canceled.push(attempt)
+      await cancellation.promise
     })
 
     const generation = lifecycle.begin()
     expect(lifecycle.accept(generation, "attempt")).toBeTrue()
-    await lifecycle.cancel()
+    const result = lifecycle.cancel()
 
     expect(canceled).toEqual(["attempt"])
+    expect(
+      await Promise.race([
+        result.then(() => "settled"),
+        Bun.sleep(0).then(() => "pending"),
+      ]),
+    ).toBe("pending")
+
+    cancellation.resolve()
+    await expect(result).resolves.toBeUndefined()
   })
@@
-  test("completes without canceling an accepted attempt", () => {
+  test("completes without canceling an accepted attempt", async () => {
     const canceled: string[] = []
     const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
       canceled.push(attempt)
@@
     const generation = lifecycle.begin()
     expect(lifecycle.accept(generation, "attempt")).toBeTrue()
     lifecycle.complete()
+    expect(lifecycle.accept(generation, "late-attempt")).toBeFalse()
+    await lifecycle.cancel()
 
-    expect(canceled).toEqual([])
+    expect(canceled).toEqual(["late-attempt"])
   })
```
