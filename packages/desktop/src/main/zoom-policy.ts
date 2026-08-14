export type ZoomAction = "renderer-owns" | "reset" | "ignore"

// Decides what the main process should do for a zoom-changed gesture:
// - renderer-owns: pinch zoom is enabled, so the renderer's wheel listener
//   applies the change through the set-zoom-factor IPC path. The main process
//   only blocks Electron's default zoom handling.
// - reset: pinch zoom is disabled but the factor drifted, so restore 1.
// - ignore: pinch zoom is disabled and the factor is already 1; nothing to do.
export function decideZoomAction(enabled: boolean, factor: number): ZoomAction {
  if (enabled) return "renderer-owns"
  if (factor !== 1) return "reset"
  return "ignore"
}
