export * as StatusProjector from "./status-projector"

import { SessionAttempt } from "../attempt"
import type { ExecutionSnapshot } from "./types"

/**
 * Derives the transient Session status from durable execution and input
 * facts. Status is a notification, never a second durable truth; the Kernel
 * never writes durable SessionEvent.Status.
 */
export const deriveStatus = (snapshot: ExecutionSnapshot): SessionAttempt.Status => {
  if (snapshot.state === "idle") return SessionAttempt.Status.make({ type: "kernel", state: "idle" })
  if (snapshot.state === "retry_wait") return SessionAttempt.Status.make({ type: "kernel", state: "retry_wait" })
  if (snapshot.state === "needs_recovery")
    return SessionAttempt.Status.make({ type: "kernel", state: "needs_recovery" })
  if (snapshot.state === "cancelling") return SessionAttempt.Status.make({ type: "kernel", state: "cancelling" })
  return SessionAttempt.Status.make({
    type: "kernel",
    state: "active",
    ...(snapshot.phase === undefined ? {} : { phase: snapshot.phase }),
  })
}
