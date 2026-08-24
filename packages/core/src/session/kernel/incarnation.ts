/** One opaque UUID per server process; an active lease from another incarnation is ownership-lost evidence. */
export const processIncarnation = crypto.randomUUID()

import type { ExecutionLease, ExecutionSnapshot } from "./types"

const active = new Map<string, { readonly generation: number; readonly token: string }>()

/** Claims the process-local execution fiber for exactly one durable lease. */
export const claimExecutionOwnership = (lease: ExecutionLease) => {
  const owner = active.get(lease.sessionID)
  if (owner && (owner.generation !== lease.generation || owner.token !== lease.token)) return false
  active.set(lease.sessionID, { generation: lease.generation, token: lease.token })
  return true
}

/** A stale finalizer cannot release a newer generation's process-local owner. */
export const releaseExecutionOwnership = (lease: ExecutionLease) => {
  const owner = active.get(lease.sessionID)
  if (owner?.generation !== lease.generation || owner.token !== lease.token) return false
  active.delete(lease.sessionID)
  return true
}

/** Durable incarnation alone is insufficient: an active fiber must own the exact lease. */
export const ownsExecution = (snapshot: ExecutionSnapshot) => {
  if (snapshot.processIncarnation !== processIncarnation || !snapshot.lease) return false
  const owner = active.get(snapshot.sessionID)
  return owner?.generation === snapshot.lease.generation && owner.token === snapshot.lease.token
}
