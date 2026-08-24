/**
 * Explicit DEV opt-in for TUI-created Sessions. The Core default remains
 * Classic until the cutover gate; the TUI must therefore forward the same
 * opt-in used by CLI and ACP instead of relying on process-global defaults.
 */
export function createSessionEngineInput(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly engine: "kernel" } | {} {
  return env.OPENCODE_SESSION_ENGINE === "kernel" ? { engine: "kernel" } : {}
}
