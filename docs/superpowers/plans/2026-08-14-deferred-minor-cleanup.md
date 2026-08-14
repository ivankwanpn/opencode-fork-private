# Deferred Minor Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the three notable deferred review findings from the legacy display batch: stale dark background fallbacks, the main-process menu zoom writer, and the dead `test:unit:watch` tail.

**Architecture:** Two color constants are aligned with the runtime-verified OC-2 background (`#121212` dark), each pinned by a contract test that reads the real artifact. The menu zoom writer is removed from the main process entirely — menu zoom forwards a command to the renderer, which applies it through the existing `set-zoom-factor` IPC path, restoring the single renderer-owned zoom writer that the zoom policy (Task 6, `zoom-policy.ts`) established.

**Tech Stack:** Bun 1.3.14 test runner (bare test names act as filters — always pass `./path`), Electron desktop package with structural-type testability pattern, plain CSS variables.

**Spec:** The triaged findings live in the legacy batch ledger `.superpowers/sdd/2026-08-14-legacy-display-fixes/progress.md` (Task 4 review ⚠️1: stale `#101010` fallbacks; Task 6 review minor 3: menu zoom writer bypasses renderer-owns; final re-review minor 1: `test:unit:watch` dead second segment). The zoom policy authority is the code comment in `packages/desktop/src/main/zoom-policy.ts` (renderer-owns = "the renderer's wheel listener applies the change through the set-zoom-factor IPC path. The main process only blocks Electron's default zoom handling.").

## Global Constraints

- No star imports (`import *`); no aliased imports in desktop/core (app package internal `@/` is existing convention, do not extend it).
- Avoid `any` / `as never`; avoid `else` (early return or switch).
- Run tests from package directories, never repository root.
- Stage explicit paths only (never `git add .`); commit with `git -c core.hooksPath=.git/hooks commit -m "type(scope): summary"`.
- Never modify, stage, or commit `docs/superpowers/specs/2026-08-11-provider-native-tool-search-design.md` or anything under `docs/superpowers/handoffs/`.
- Do not push.

---

### Task 1: Align dark background fallbacks with the resolved OC-2 background

**Files:**
- Modify: `packages/ui/src/styles/theme.css:365`
- Modify: `packages/core/src/oauth/page.ts:169`
- Test: `packages/app/src/theme-preload.test.ts` (append describe block)
- Test: `packages/core/test/oauth-page.test.ts` (append two tests)

**Interfaces:**
- Produces: dark background fallback `--background-base: #121212` in `theme.css` and `--oc-bg: #121212` in the oauth page `DARK_VARS`, each pinned by a contract test.

The runtime-verified OC-2 background is light `#f8f8f8` / dark `#121212` (resolved via `resolveThemeVariant`, recorded in the legacy ledger Task 4 review). Both dark fallbacks are stale at `#101010`.

- [ ] **Step 1: Write the failing theme fallback test**

Append to `packages/app/src/theme-preload.test.ts` (the file already reads real assets via top-level `await Bun.file(new URL(...))` — same mechanism):

```ts
describe("theme css fallbacks", () => {
  const css = await Bun.file(new URL("../../ui/src/styles/theme.css", import.meta.url)).text()

  test("light background-base fallback matches the resolved OC-2 background", () => {
    expect(css.match(/--background-base:\s*([^;]+);/)?.[1]).toBe("#f8f8f8")
  })

  test("dark background-base fallback matches the resolved OC-2 background", () => {
    expect(
      css.match(/\/\* OC-2 fallback variables \(dark\) \*\/[\s\S]*?--background-base:\s*([^;]+);/)?.[1],
    ).toBe("#121212")
  })
})
```

- [ ] **Step 2: Run the theme test to verify the dark case fails**

Run (from `packages/app`): `bun test --conditions=browser --preload ./happydom.ts ./src/theme-preload.test.ts`
Expected: light test PASS; dark test FAIL with received `#101010`.

- [ ] **Step 3: Write the failing oauth page test**

Append inside the existing `describe("OauthCallbackPage", ...)` block in `packages/core/test/oauth-page.test.ts`:

```ts
  test("light page background matches the resolved OC-2 background", () => {
    const html = OauthCallbackPage.success({ provider: "MCP" })
    expect(html).toContain("--oc-bg: #f8f8f8")
  })

  test("dark page background matches the resolved OC-2 background", () => {
    const html = OauthCallbackPage.success({ provider: "MCP" })
    expect(html).toContain("--oc-bg: #121212")
  })
```

- [ ] **Step 4: Run the oauth test to verify the dark case fails**

Run (from `packages/core`): `bun test ./test/oauth-page.test.ts`
Expected: light test PASS; dark test FAIL (HTML contains `--oc-bg: #101010`, not `#121212`).

- [ ] **Step 5: Fix the two dark fallbacks**

In `packages/ui/src/styles/theme.css` change:

```css
    /* OC-2 fallback variables (dark) */
    --background-base: #101010;
```

to:

```css
    /* OC-2 fallback variables (dark) */
    --background-base: #121212;
```

In `packages/core/src/oauth/page.ts` change (inside `DARK_VARS`):

```ts
    --oc-bg: #101010;
```

to:

```ts
    --oc-bg: #121212;
```

The light values (`#f8f8f8` at `theme.css:94` and `page.ts:153`) are already correct — do not touch them.

- [ ] **Step 6: Run both tests to verify they pass**

Run (from `packages/app`): `bun test --conditions=browser --preload ./happydom.ts ./src/theme-preload.test.ts`
Run (from `packages/core`): `bun test ./test/oauth-page.test.ts`
Expected: all four new tests PASS.

- [ ] **Step 7: Run the broader suites**

Run (from `packages/app`): `bun run test:unit`
Run (from `packages/core`): `bun test` then `bun typecheck`
Expected: all green. The app suite includes the full `test:unit` chain (src tests + `vite.test.ts`); core `bun typecheck` runs `tsgo --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/styles/theme.css packages/core/src/oauth/page.ts packages/app/src/theme-preload.test.ts packages/core/test/oauth-page.test.ts
git -c core.hooksPath=.git/hooks commit -m "fix(app): align dark background fallbacks with the resolved OC-2 background"
```

---

### Task 2: Route desktop menu zoom through the renderer-owned path

**Files:**
- Modify: `packages/desktop/src/main/desktop-menu-actions.ts` (full rewrite, no electron import)
- Modify: `packages/desktop/src/preload/types.ts` (add `ZoomCommand` type + `onZoomCommand` API)
- Modify: `packages/desktop/src/preload/index.ts` (add `onZoomCommand` implementation)
- Modify: `packages/desktop/src/renderer/webview-zoom.ts` (subscribe to zoom commands)
- Test: `packages/desktop/src/main/desktop-menu-actions.test.ts` (new)

**Interfaces:**
- Consumes: `packages/desktop/src/main/ipc.ts` imports `runDesktopMenuAction` (existing signature `(win, action, handlers?)`); `packages/desktop/src/main/menu.ts:50` passes `BrowserWindow.getFocusedWindow()`; `packages/desktop/src/renderer/index.tsx:119-133` already intercepts zoom actions locally and never forwards them to main.
- Produces: `DesktopMenuWindow` structural interface (main-process menus satisfy it with `BrowserWindow` — no call-site changes), `ZoomCommand = "reset" | "in" | "out"` exported from `preload/types.ts`, channel `"zoom-command"` main→renderer, `window.api.onZoomCommand(cb)` returning an unsubscribe function.

Today the menu zoom cases (`view.resetZoom` / `view.zoomIn` / `view.zoomOut`) write `webContents.setZoomFactor` directly in main and never broadcast `zoom-factor-changed`, so the renderer's zoom state (`requestedZoom` / `webviewZoom` in `webview-zoom.ts`) goes stale. That is the flagged bypass: the zoom policy makes the renderer the only zoom writer (it applies changes through the `set-zoom-factor` IPC path; main only blocks Electron defaults and resets drift). The renderer already intercepts these three actions in `renderer/index.tsx:119-133`, so only the native macOS menu path (`menu.ts:50`) reaches this writer — but both paths must agree, and the fix removes the writer entirely.

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/main/desktop-menu-actions.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { runDesktopMenuAction, type DesktopMenuWindow } from "./desktop-menu-actions"

function setup() {
  const sent: Array<[string, unknown]> = []
  const win: DesktopMenuWindow = {
    close() {},
    minimize() {},
    isMaximized() {
      return false
    },
    unmaximize() {},
    maximize() {},
    reload() {},
    webContents: {
      send(channel: string, ...args: unknown[]) {
        sent.push([channel, args[0]])
      },
      toggleDevTools() {},
      undo() {},
      redo() {},
      cut() {},
      copy() {},
      paste() {},
      delete() {},
      selectAll() {},
    },
    setFullScreen() {},
    isFullScreen() {
      return false
    },
  }
  return { win, sent }
}

describe("desktop menu actions", () => {
  test("forwards reset zoom to the renderer", () => {
    const { win, sent } = setup()
    runDesktopMenuAction(win, "view.resetZoom")
    expect(sent).toEqual([["zoom-command", "reset"]])
  })

  test("forwards zoom in to the renderer", () => {
    const { win, sent } = setup()
    runDesktopMenuAction(win, "view.zoomIn")
    expect(sent).toEqual([["zoom-command", "in"]])
  })

  test("forwards zoom out to the renderer", () => {
    const { win, sent } = setup()
    runDesktopMenuAction(win, "view.zoomOut")
    expect(sent).toEqual([["zoom-command", "out"]])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/desktop`): `bun test ./src/main/desktop-menu-actions.test.ts`
Expected: the file does not exist yet / does not compile — RED (bun reports the missing module or the type error for `DesktopMenuWindow`). If bun instead loads the current module and crashes in `setZoom` calling `webContents.setZoomFactor` (undefined on the mock), that is also the expected RED: it proves the bypass. Either failure shape is correct.

- [ ] **Step 3: Add the ZoomCommand type and preload API**

In `packages/desktop/src/preload/types.ts`, add next to `TitlebarTheme` (after the `FatalRendererError` type):

```ts
export type ZoomCommand = "reset" | "in" | "out"
```

In the same file, add to the `ElectronAPI` type right after the `onZoomFactorChanged` line:

```ts
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  onZoomCommand: (cb: (command: ZoomCommand) => void) => () => void
```

In `packages/desktop/src/preload/index.ts`, change the type import to include `ZoomCommand`:

```ts
import type { ElectronAPI, WslServersEvent, ZoomCommand } from "./types"
```

and add the implementation right after the `onZoomFactorChanged` block:

```ts
  onZoomCommand: (cb) => {
    const handler = (_: unknown, command: ZoomCommand) => cb(command)
    ipcRenderer.on("zoom-command", handler)
    return () => ipcRenderer.removeListener("zoom-command", handler)
  },
```

- [ ] **Step 4: Subscribe the renderer zoom owner**

In `packages/desktop/src/renderer/webview-zoom.ts`, add directly after the `window.api.onZoomFactorChanged(...)` block (line 51). The callbacks `resetZoom` / `zoomIn` / `zoomOut` are declared below (lines 68-70) but only run later at call time, so this is safe:

```ts
window.api.onZoomCommand((command) => {
  if (command === "reset") {
    resetZoom()
    return
  }
  if (command === "in") {
    zoomIn()
    return
  }
  zoomOut()
})
```

- [ ] **Step 5: Rewrite the menu action handler without the main-process zoom writer**

Replace the entire `packages/desktop/src/main/desktop-menu-actions.ts` with:

```ts
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { ZoomCommand } from "../preload/types"
import { createMainWindow } from "./windows"

// Structural window surface so menu actions stay testable without importing
// electron (mirrors the MinimalWebContents pattern in external-url.ts).
// Electron's BrowserWindow satisfies this interface, so call sites in
// ipc.ts and menu.ts need no changes.
export interface DesktopMenuWindow {
  close(): void
  minimize(): void
  isMaximized(): boolean
  unmaximize(): void
  maximize(): void
  reload(): void
  webContents: {
    send(channel: string, ...args: unknown[]): void
    toggleDevTools(): void
    undo(): void
    redo(): void
    cut(): void
    copy(): void
    paste(): void
    delete(): void
    selectAll(): void
  }
  setFullScreen(flag: boolean): void
  isFullScreen(): boolean
}

export type DesktopMenuActionHandlers = Partial<{
  relaunch: () => void
}>

// The renderer owns zoom state (see zoom-policy.ts); menu zoom forwards the
// command so the renderer applies it through the set-zoom-factor IPC path,
// exactly like its own keyboard shortcuts (Ctrl/Cmd +/-/0 in webview-zoom.ts).
function sendZoomCommand(win: DesktopMenuWindow | null, command: ZoomCommand) {
  win?.webContents.send("zoom-command", command)
}

export function runDesktopMenuAction(
  win: DesktopMenuWindow | null,
  action: DesktopMenuAction,
  handlers: DesktopMenuActionHandlers = {},
) {
  switch (action) {
    case "app.relaunch":
      handlers.relaunch?.()
      return
    case "window.new":
      createMainWindow()
      return
    case "window.close":
      win?.close()
      return
    case "window.minimize":
      win?.minimize()
      return
    case "window.toggleMaximize":
      if (win?.isMaximized()) {
        win.unmaximize()
        return
      }
      win?.maximize()
      return
    case "view.reload":
      win?.reload()
      return
    case "view.toggleDevTools":
      win?.webContents.toggleDevTools()
      return
    case "view.resetZoom":
      sendZoomCommand(win, "reset")
      return
    case "view.zoomIn":
      sendZoomCommand(win, "in")
      return
    case "view.zoomOut":
      sendZoomCommand(win, "out")
      return
    case "view.toggleFullscreen":
      win?.setFullScreen(!win.isFullScreen())
      return
    case "edit.undo":
      win?.webContents.undo()
      return
    case "edit.redo":
      win?.webContents.redo()
      return
    case "edit.cut":
      win?.webContents.cut()
      return
    case "edit.copy":
      win?.webContents.copy()
      return
    case "edit.paste":
      win?.webContents.paste()
      return
    case "edit.delete":
      win?.webContents.delete()
      return
    case "edit.selectAll":
      win?.webContents.selectAll()
      return
  }
}
```

Notes: the old `setZoom` helper (direct `setZoomFactor` + clamp + `updateTitlebar`) is deleted; clamping and step size are already the renderer's (`clamp` 0.2–10 and 0.2 step in `webview-zoom.ts`), so menu zoom behavior is unchanged in the steady state. If the renderer is hung, menu zoom becomes a no-op instead of a stale write — accepted per the renderer-owns policy.

- [ ] **Step 6: Run the new test to verify it passes**

Run (from `packages/desktop`): `bun test ./src/main/desktop-menu-actions.test.ts`
Expected: 3/3 PASS.

- [ ] **Step 7: Run the desktop suite and typecheck**

Run (from `packages/desktop`): `bun test`
Run (from `packages/desktop`): `bun typecheck`
Expected: full suite green (zoom-policy and all main tests included); typecheck (`tsgo -b`) covers main, preload, and renderer — it proves `BrowserWindow` satisfies `DesktopMenuWindow` at the call sites in `ipc.ts` and `menu.ts` without edits there.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/main/desktop-menu-actions.ts packages/desktop/src/main/desktop-menu-actions.test.ts packages/desktop/src/preload/types.ts packages/desktop/src/preload/index.ts packages/desktop/src/renderer/webview-zoom.ts
git -c core.hooksPath=.git/hooks commit -m "fix(desktop): route menu zoom through the renderer-owned path"
```

---

### Task 3: Drop the dead second segment of `test:unit:watch`

**Files:**
- Modify: `packages/app/package.json:23`

**Interfaces:**
- Produces: `test:unit:watch` watches only the unit suite; the one-shot `vite.test.ts` stays in CI via `test:unit`.

The first `--watch` blocks forever, so the `&& bun test --watch ./vite.test.ts` tail never runs.

- [ ] **Step 1: Edit the script**

In `packages/app/package.json` change:

```json
    "test:unit:watch": "bun test --watch --preload ./happydom.ts ./src && bun test --watch ./vite.test.ts",
```

to:

```json
    "test:unit:watch": "bun test --watch --preload ./happydom.ts ./src",
```

- [ ] **Step 2: Smoke-verify watch mode starts**

Run (from `packages/app`): `timeout 45 bun run test:unit:watch`
Expected: the watch banner appears and the initial `./src` run completes green before `timeout` kills it (exit 124 on the timeout is expected and correct). If the script were broken, bun would exit immediately with a usage/parse error.

- [ ] **Step 3: Verify the CI chain is untouched**

Run (from `packages/app`): `bun run test:unit`
Expected: unchanged, all green (this is the CI gate the final fix wave wired up).

- [ ] **Step 4: Commit**

```bash
git add packages/app/package.json
git -c core.hooksPath=.git/hooks commit -m "fix(app): drop the dead second segment of test:unit:watch"
```
