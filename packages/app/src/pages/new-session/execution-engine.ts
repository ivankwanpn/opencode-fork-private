import type { Session } from "@opencode-ai/schema/session"

/**
 * DEV opt-in for the engine of newly created Sessions. Production surfaces
 * never resolve to kernel: the selector is hidden and the preference is
 * ignored, so Classic remains the production default until the cutover gate.
 */
export type NewSessionEngine = Session.ExecutionEngine

export const engineOptions: ReadonlyArray<{ readonly id: NewSessionEngine; readonly label: string }> = [
  { id: "classic", label: "Classic" },
  { id: "kernel", label: "Kernel" },
]

export function isDevEnvironment() {
  return typeof import.meta !== "undefined" && (import.meta.env.DEV || import.meta.env.VITE_OPENCODE_CHANNEL !== "prod")
}

export function resolveNewSessionEngine(preference: NewSessionEngine | undefined, dev: boolean): NewSessionEngine {
  if (preference !== "kernel") return "classic"
  return dev ? "kernel" : "classic"
}

/** The engine selector exists only in DEV; production omits it entirely. */
export function engineSelectorVisible(dev: boolean) {
  return dev
}
