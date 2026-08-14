import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import type { ZoomCommand } from "../preload/types"

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

// createWindow is injected rather than imported from ./windows: electron's
// npm entry exports only the binary path string, so any transitive ./windows
// import fails at module link time under bun test.
export type DesktopMenuActionHandlers = Partial<{
  relaunch: () => void
  createWindow: () => void
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
      handlers.createWindow?.()
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
