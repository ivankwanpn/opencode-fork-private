# Legacy Display and Robustness Fixes Implementation Plan

> **Implementation status:** reviewed and corrected on 2026-08-14. This revision replaces the unsafe sliding SSE queue, restores B2 to scope, and replaces placeholder tests with concrete repository paths.
>
> **For implementation agents:** execute one task at a time. Use the listed test first, make the smallest implementation change, rerun the focused test and package typecheck, then commit only the explicit paths for that task.

## Goal

Close A9-A12 and B1-B8 without weakening the V2 event and transcript correctness contracts. The work covers permission UI fallback, V2-to-V1 compatibility projection, desktop theme/startup/zoom/icon behavior, and validation of SSE overflow recovery.

The scope is 12 findings:

- A9, A10, A11, A12
- B1, B2, B3, B4, B5, B6, B7, B8

B2 is open. Commit `77e8f92` increased the sidecar start stall timeout, but `packages/desktop/src/main/index.ts` still waits for the health check before calling `restoreMainWindows()`. The window can therefore still be absent for up to 30 seconds after the sidecar listener is ready.

## Correctness Decisions

1. A compatibility event source emits its V1 projection when a projection exists. It emits the raw canonical envelope only when the projection is empty. It never emits both for one source event.
2. Compatibility projection preserves non-standard imported IDs. It must not throw merely because an imported message or part ID does not use the generated prefix.
3. A native assistant without an available user parent is retained with its own message ID as a documented orphan sentinel. It must never be attached to the previous assistant.
4. The authoritative first-frame desktop background is the resolved legacy `--background-base`, because Electron, the document root, and the current app shell all use that token. For OC-2 it resolves to light `#f8f8f8` and dark `#121212`.
5. Both Vite entry forms are supported: `/oc-theme-preload.js` in `packages/app/index.html` and `./oc-theme-preload.js` in `packages/desktop/src/renderer/index.html`.
6. Desktop windows are restored immediately after the sidecar startup fiber is launched. The health monitor may continue in the background. A startup failure is still observed and shown to the user.
7. The renderer owns enabled pinch/Ctrl-wheel zoom. The main process only prevents Electron's default zoom path in that mode.
8. `EventV2.allBounded` remains loss-sensitive. Overflow fails only the slow subscriber, which forces reconnect and authoritative state reload. `Queue.sliding` is prohibited because it silently loses arbitrary middle or tail events and prevents resynchronization.

## Repository Rules

- Work only in `D:\agent-complete\opencode-fork-private-999.0.15` on branch `999.0.17`.
- Do not rewrite the existing 38 local commits.
- Do not modify, stage, or commit `docs/superpowers/handoffs/`.
- Do not modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md`.
- Do not change Protocol, Server `HttpApi`, or `packages/schema` in this batch.
- Do not edit generated SDK files and do not run `bun run generate`.
- Follow the repository `AGENTS.md`: no star imports, no import aliases, no `any`, no unnecessary `else`, and package-local tests/typechecks only.
- Stage explicit paths. Do not use `git add .` or `git add -A`.

---

## Batch 1: Compatibility Boundaries

### Task 1: A9 permission dock description fallback

**Files**

- Modify `packages/app/src/pages/session/composer/session-permission-dock.tsx`.
- Create `packages/app/src/pages/session/composer/session-permission-dock.test.tsx`.

**Failing contract**

Render `SessionPermissionDock` inside `LanguageProvider` with permission `execute:bash`. Query the existing permission hint element and assert that its text is `execute:bash`, not an empty string.

The test belongs beside the component and runs with the existing Happy DOM preload. Use a real `PermissionRequest`-shaped value and the real language provider; do not mock the translator.

**Implementation**

Build the translation key as today. If `language.t(key)` returns the key unchanged, return `props.request.permission`. Otherwise return the translated value. Do not add a translation entry for arbitrary plugin actions because the fallback must work for future actions too.

**Verification**

```powershell
cd packages/app
bun test --conditions=browser --preload ./happydom.ts src/pages/session/composer/session-permission-dock.test.tsx
bun typecheck
```

**Commit**

```powershell
git add packages/app/src/pages/session/composer/session-permission-dock.tsx packages/app/src/pages/session/composer/session-permission-dock.test.tsx
git -c core.hooksPath=.git/hooks commit -m "fix(app): show untranslated permission actions"
```

### Task 2: A10/A11 single legacy projection and tolerant IDs

**Files**

- Modify `packages/opencode/src/id/id.ts`.
- Modify `packages/opencode/src/event-v2-bridge.ts`.
- Modify `packages/opencode/test/server/httpapi-event.test.ts`.
- Modify `packages/opencode/test/acp/client.test.ts` only if its existing projection-once assertions need adjustment.

**Failing contracts**

Extend the existing `legacy event projection` tests in `packages/opencode/test/server/httpapi-event.test.ts`:

- Rename and reverse the current `retains the raw canonical event before compatibility projections` test. A source such as `session.next.step.started` must produce only `message.updated` and `message.part.updated`; it must not also produce `session.next.step.started`.
- Add a raw fallback case using a canonical type that `legacyEventProjection()` does not project. Assert one envelope with the source ID, source type, and `source.data` in `properties`.
- Exercise `session.next.transcript.message.removed`, `user-text.updated`, `user-text.removed`, `content.updated`, and `content.removed` with imported IDs such as `legacy-message` and `legacy-part`. Assert that projection does not throw and that the IDs are preserved exactly.
- Keep the ACP integration assertion that each projected permission/text/reasoning/tool/error event appears once.

**Implementation**

Add a public `ascendingOr(prefix, given)` function to `packages/opencode/src/id/id.ts`. It should call `ascending` only when `given` already has the expected prefix; otherwise it returns `given` unchanged. Keep `prefixes` module-private. Do not add the invalid duplicate declaration `export const prefixes = prefixes`.

Replace every `MessageID.ascending(...)` and `PartID.ascending(...)` conversion in `packages/opencode/src/event-v2-bridge.ts` that consumes an external/canonical value with `Identifier.ascendingOr(...)`. This includes all transcript mutation paths, not only the first five textual matches. Generated projection IDs such as `prt_${state.messageID}_...` may continue through the normal generated-ID path.

Change `legacyEventPayloads` to:

- evaluate `projectLegacy(source)` exactly once;
- return the projected array when it is non-empty;
- otherwise return one raw fallback envelope.

This central helper is shared by experimental `/api/event`, `GlobalBus`, ACP, and CLI native compatibility. Do not implement different duplicate policies at individual consumers.

**Verification**

```powershell
cd packages/opencode
bun test test/server/httpapi-event.test.ts test/acp/client.test.ts
bun typecheck
```

**Commit**

```powershell
git add packages/opencode/src/id/id.ts packages/opencode/src/event-v2-bridge.ts packages/opencode/test/server/httpapi-event.test.ts packages/opencode/test/acp/client.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): project legacy events once and preserve imported ids"
```

If `packages/opencode/test/acp/client.test.ts` is unchanged after the focused run, omit it from both staging and the commit.

### Task 3: A12 V1 compatibility field fidelity

**Files**

- Modify `packages/opencode/src/compat/native-v1-catalog.ts`.
- Modify `packages/opencode/src/compat/native-v1-transcript.ts`.
- Modify `packages/opencode/test/acp/client.test.ts`.

**Failing contracts**

Use the existing ACP catalog and transcript integration harness:

- Return one native agent with `permissions: [{ action: "bash", resource: "*", effect: "allow" }]` from `/api/agent`. Assert the projected legacy agent contains `permission: [{ permission: "bash", pattern: "*", action: "allow" }]`.
- Return a transcript page whose first retained item is a native assistant and has no preceding user in the fetched history. Assert that the assistant remains in the projected transcript and that `parentID` equals its own message ID.
- Add a second case with user, assistant, assistant. Assert that the second assistant remains parented to the user, not to the preceding assistant.

**Implementation**

Map every V2 permission rule in `legacyAgentFromNative`:

- `action` becomes legacy `permission`;
- `resource` becomes legacy `pattern`;
- `effect` becomes legacy `action`.

For a native assistant, use `parentID ?? message.id` when constructing its V1 message. Treat self-parenting only as the orphan sentinel. Once a user has been seen, all following native assistants continue to use that user ID until another user/synthetic anchor updates the parent.

Leave `legacyCommandFromNative(...).hints` as `[]`. `CommandV2Info` has no equivalent hints field, so there is no source data to preserve.

**Verification**

```powershell
cd packages/opencode
bun test test/acp/client.test.ts
bun typecheck
```

**Commit**

```powershell
git add packages/opencode/src/compat/native-v1-catalog.ts packages/opencode/src/compat/native-v1-transcript.ts packages/opencode/test/acp/client.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(opencode): preserve fields in V1 compatibility projections"
```

---

## Batch 2: Theme and Desktop Lifecycle

### Task 4: B3/B4/B6 theme preload and background contract

**Files**

- Modify `packages/app/vite.js`.
- Create `packages/app/vite.test.ts`.
- Modify `packages/app/public/oc-theme-preload.js`.
- Modify `packages/app/src/theme-preload.test.ts`.
- Modify `packages/ui/src/theme/context.tsx`.

**Failing contracts**

In `packages/app/vite.test.ts`, import the default export from `./vite`. The export is the plugin array itself, so select the plugin with `viteConfig.find(...)`, not `viteConfig.plugins.find(...)`.

Call the plugin's `transformIndexHtml` for both of these complete tags and assert that each is replaced with an inline script:

```html
<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>
<script id="oc-theme-preload-script" src="./oc-theme-preload.js"></script>
```

Extend `packages/app/src/theme-preload.test.ts` with light and dark cases. Assert all of the following immediately after executing the preload script:

- `data-color-scheme` is correct;
- `document.documentElement.style.backgroundColor` resolves to `#f8f8f8` in light mode and `#121212` in dark mode;
- the first `meta[name='theme-color']` contains the same selected value.

**Implementation**

Use one tested matcher in the Vite plugin that recognizes both `/oc-theme-preload.js` and `./oc-theme-preload.js`. Preserve the script ID and inline the exact contents of `packages/app/public/oc-theme-preload.js`.

In the preload script, use the resolved OC-2 legacy background values:

- light: `#f8f8f8`;
- dark: `#121212`.

In `applyThemeCss`, stop using fixed `#080808`/`#fafafa`. Use the already-resolved `tokens["background-base"]` for `documentElement.style.backgroundColor` and the theme-color meta tag. This keeps custom themes, runtime theme changes, the document root, and Electron's `windows.ts` resolver on the same contract.

Do not switch only the preload script to `--v2-background-bg-base` values while leaving Electron and the document root on `--background-base`; that would preserve the first-frame color mismatch.

**Verification**

```powershell
cd packages/app
bun test --conditions=browser --preload ./happydom.ts vite.test.ts src/theme-preload.test.ts
bun typecheck
cd ../ui
bun typecheck
cd ../desktop
bun typecheck
```

**Commit**

```powershell
git add packages/app/vite.js packages/app/vite.test.ts packages/app/public/oc-theme-preload.js packages/app/src/theme-preload.test.ts packages/ui/src/theme/context.tsx
git -c core.hooksPath=.git/hooks commit -m "fix(app): align theme preload with the desktop background"
```

### Task 5: B1/B2 visible startup and non-blocking window restoration

**Files**

- Modify `packages/desktop/src/main/index.ts`.
- Modify `packages/desktop/src/main/initialization.ts`.
- Modify `packages/desktop/src/main/index.test.ts`.

**Failing contracts**

Extend `packages/desktop/src/main/index.test.ts` against a small Effect helper in `initialization.ts` that owns the ordering boundary:

- provide a startup effect blocked on a `Deferred` and a restore callback;
- start the helper and assert that the restore callback has run before completing the `Deferred`;
- fail the deferred and assert that the failure callback receives the original error exactly once;
- complete the deferred successfully and assert that the failure callback is not called.

The test must exercise the helper used by `index.ts`, not an unrelated enum or fabricated policy function.

**Implementation**

Keep `loadingTask` forked. Move window restoration and menu creation into the restore callback that runs before the helper waits for `Fiber.join(loadingTask)`. The renderer may wait on `serverReady`; the native window itself must already exist and show its loading state.

Observe the loading fiber after restoring windows. If it fails:

- squash the Effect cause to the original error;
- format `Error.message` and one nested `Error.cause.message` when present;
- call `dialog.showErrorBox("OpenCode failed to start", message)`;
- call `app.quit()`;
- do not attempt another window restore.

The existing 30-second health monitor remains advisory and may finish after the window is created. The 15-minute sidecar ready timeout remains unchanged because it covers one-time migrations.

**Verification**

```powershell
cd packages/desktop
bun test src/main/index.test.ts
bun typecheck
```

**Commit**

```powershell
git add packages/desktop/src/main/index.ts packages/desktop/src/main/initialization.ts packages/desktop/src/main/index.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(desktop): restore windows before sidecar health settles"
```

### Task 6: B5 renderer-owned pinch zoom

**Files**

- Modify `packages/desktop/src/main/windows.ts`.
- Create `packages/desktop/src/main/zoom-policy.ts`.
- Create `packages/desktop/src/main/zoom-policy.test.ts`.

**Failing contracts**

Test the decision function used by the real `zoom-changed` handler:

- enabled pinch zoom returns `renderer-owns` for any factor;
- disabled pinch zoom with factor `1` returns `ignore`;
- disabled pinch zoom with a non-1 factor returns `reset`.

**Implementation**

The main `zoom-changed` handler always calls `event.preventDefault()`.

- For `renderer-owns`, do not call `setZoomFactor` and do not add/subtract another `0.2`. The renderer's wheel listener and `set-zoom-factor` IPC path own the change.
- For `reset`, set the factor to `1` and update the titlebar/renderer notification.
- For `ignore`, leave the factor unchanged and update only if the current wiring requires the existing notification.

Do not keep two writers active for the same Ctrl-wheel gesture.

**Verification**

```powershell
cd packages/desktop
bun test src/main/zoom-policy.test.ts
bun typecheck
```

**Commit**

```powershell
git add packages/desktop/src/main/windows.ts packages/desktop/src/main/zoom-policy.ts packages/desktop/src/main/zoom-policy.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(desktop): give the renderer ownership of pinch zoom"
```

---

## Batch 3: Packaging and Overflow Recovery

### Task 7: B7 packaged icon path

**Files**

- Modify `packages/desktop/electron-builder.config.ts`.
- Modify `packages/desktop/electron-builder.config.test.ts`.

**Failing contract**

Extend the existing electron-builder config test. Assert both:

```ts
expect(config.files).toContain("!resources/icons/**")
expect(config.extraResources).toContainEqual({
  from: "resources/icons",
  to: "icons",
})
```

**Implementation**

Exclude `resources/icons/**` from the app archive and copy that directory to `process.resourcesPath/icons` through `extraResources`. Keep the existing native resource entry unchanged. This matches `iconsDir()` and `iconPath()` in `packages/desktop/src/main/windows.ts`.

**Verification**

```powershell
cd packages/desktop
bun test electron-builder.config.test.ts
bun typecheck
```

After automated verification, package once on the current platform and confirm that the expected files exist under the packaged application's `resources/icons` directory. Do not make a packaging-only commit if the config test fails.

**Commit**

```powershell
git add packages/desktop/electron-builder.config.ts packages/desktop/electron-builder.config.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(desktop): ship window icons outside the app archive"
```

### Task 8: B8 preserve overflow detection and verify resynchronization

**Files inspected by this task**

- `packages/core/src/event.ts`.
- `packages/core/test/event.test.ts`.
- `packages/server/src/handlers/event.ts`.
- `packages/app/src/context/server-sdk.tsx`.
- `packages/app/src/context/server-sync.tsx`.
- `packages/app/src/context/global-sync/event-reducer.test.ts`.
- `packages/app/src/context/global-sync/home-session-index.test.ts`.

**Required contract**

Keep the existing core overflow test named `ends only an overflowing bounded subscriber without blocking other listeners`. It proves that:

- the slow subscriber fails with `EventV2.SubscriberOverflowError`;
- a fast subscriber receives all published events;
- one overflowing subscriber does not block or terminate unrelated listeners.

Keep the app reconnect contracts that process a later `server.connected` as a recovery boundary and force authoritative global/session refreshes. This is why an explicit stream failure is recoverable while silent sliding loss is not.

**Implementation decision**

Do not change `Queue.dropping` to `Queue.sliding`. Do not delete `SubscriberOverflowError`.

No core/server behavior change is required in this batch if the listed tests pass. Close B8 in the audit as `guarded by explicit overflow failure plus reconnect resynchronization`, not as `queue never overflows`.

If product requirements demand that a slow subscriber never observes even a transient disconnect, stop this batch and write a separate design for one of these complete contracts:

- durable replay from `Last-Event-ID` for every event needed to reconstruct UI state; or
- semantics-aware coalescing of compatible delta events plus explicit resync for non-coalescible overflow.

An unbounded queue, arbitrary event dropping, or a larger fixed capacity is not an acceptable correctness fix.

**Verification**

```powershell
cd packages/core
bun test test/event.test.ts
bun typecheck
cd ../app
bun test --conditions=browser --preload ./happydom.ts src/context/global-sync/event-reducer.test.ts src/context/global-sync/home-session-index.test.ts
bun typecheck
```

Task 8 normally has no code commit. If only the audit report is updated, include that report update in the final documentation commit after all implementation tasks pass.

---

## Final Verification

Run every command from its package directory:

```powershell
cd packages/app
bun test --conditions=browser --preload ./happydom.ts vite.test.ts src/theme-preload.test.ts src/pages/session/composer/session-permission-dock.test.tsx src/context/global-sync/event-reducer.test.ts src/context/global-sync/home-session-index.test.ts
bun typecheck

cd ../opencode
bun test test/server/httpapi-event.test.ts test/acp/client.test.ts
bun typecheck

cd ../core
bun test test/event.test.ts
bun typecheck

cd ../desktop
bun test electron-builder.config.test.ts src/main/index.test.ts src/main/zoom-policy.test.ts
bun typecheck

cd ../ui
bun typecheck
```

Then return to the repository root and run:

```powershell
git diff --check
git status --short
```

Confirm that only the intended implementation/test files are staged. Confirm again that the protected untracked handoff directory and provider-native tool-search spec remain untouched.

Update `.superpowers/sdd/2026-08-14-legacy-display-fixes/progress.md` with the focused test result and commit for each completed task. Update `D:\agent-complete\fork桌面版顯示bug定位報告.md` with the final status for A9-A12 and B1-B8 without renaming that report.

Do not push unless the user explicitly requests a push.
