import { Session } from "@opencode-ai/schema/session"

/**
 * DEV opt-in for terminal surfaces: OPENCODE_SESSION_ENGINE=kernel requests a
 * kernel Session on create. Production never sets the variable, so creation
 * continues to resolve the process default (Classic) until the cutover gate.
 */
export function createSessionEngineInput(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { engine: Session.ExecutionEngine } | {} {
  return env.OPENCODE_SESSION_ENGINE === "kernel" ? { engine: "kernel" } : {}
}
