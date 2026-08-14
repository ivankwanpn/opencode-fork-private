import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"

// The three zoom actions must reach runDesktopMenuAction on the native macOS
// menu: Electron's built-in zoom roles would apply zoom in the main process,
// bypassing the renderer-owned zoom path. Entries with BOTH a role and one of
// these actions therefore prefer the action; every other action+role entry
// keeps its native role (macOS accelerators depend on it).
const ZOOM_ACTIONS: readonly DesktopMenuAction[] = ["view.resetZoom", "view.zoomIn", "view.zoomOut"]

export function isZoomAction(action: DesktopMenuAction | undefined): boolean {
  return action !== undefined && ZOOM_ACTIONS.includes(action)
}
