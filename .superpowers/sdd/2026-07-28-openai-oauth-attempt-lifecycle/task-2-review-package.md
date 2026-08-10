# Task 2 Review Package

Base: working snapshot after Task 1
Head: working snapshot after Task 2
Commits: unavailable because this snapshot has no `.git`

## Stat

```text
packages/app/src/components/dialog-connect-provider.tsx | 18 +++++++++++++++++-
1 file changed, 17 insertions(+), 1 deletion(-)
```

## Full Diff

```diff
--- packages/app/src/components/dialog-connect-provider.tsx (before Task 2)
+++ packages/app/src/components/dialog-connect-provider.tsx (after Task 2)
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
 
   const alive = { value: true }
   const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
 
   onCleanup(() => {
     alive.value = false
+    void oauth.cancel()
     if (timer.current === undefined) return
@@
       }
       dispatch({ type: "auth.pending" })
+      const generation = oauth.begin()
       await serverSDK()
         .api.integration.oauth.connect({
@@
         })
         .then((x) => {
-          if (!alive.value) return
+          if (!oauth.accept(generation, x.data)) return
+          if (!alive.value) {
+            void oauth.cancel()
+            return
+          }
           dispatch({ type: "auth.complete", authorization: x.data })
         })
@@
   async function complete() {
+    oauth.complete()
     const value = directory()
@@
-  function goBack() {
+  async function goBack() {
+    await oauth.cancel()
     if (methods().length > 1 && store.methodIndex !== undefined) {
```
