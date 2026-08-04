import type { ServerConnection } from "@/context/server"
import type { ServerEvent } from "@/context/server-sdk"

export const SESSION_TABS_REMOVED_EVENT = "opencode:session-tabs-removed"
export const SESSION_TABS_RECONCILE_EVENT = "opencode:session-tabs-reconcile"

export type SessionTabsRemovedDetail = {
  server?: ServerConnection.Key
  directory: string
  sessionIDs: string[]
}

export type SessionTabsReconcileDetail = {
  server: ServerConnection.Key
}

export function notifySessionTabsRemoved(input: SessionTabsRemovedDetail) {
  window.dispatchEvent(new CustomEvent(SESSION_TABS_REMOVED_EVENT, { detail: input }))
}

export function notifySessionTabsReconcile(input: SessionTabsReconcileDetail) {
  window.dispatchEvent(new CustomEvent(SESSION_TABS_RECONCILE_EVENT, { detail: input }))
}

export function sessionTabsRemovedFromServerEvent(input: {
  server: ServerConnection.Key
  directory: string
  event: ServerEvent
}): SessionTabsRemovedDetail | undefined {
  const current = input.event.current
  if (current) {
    const data = record(current.data)
    const info = record(data?.info)
    const time = record(info?.time)
    const type = current.type as string
    const archived = type === "session.deleted" || type === "session.archived" || (type === "session.updated" && time?.archived !== undefined)
    if (archived && typeof data?.sessionID === "string") {
      return { server: input.server, directory: input.directory, sessionIDs: [data.sessionID] }
    }
  }

  const properties = record(input.event.properties)
  const info = record(properties?.info)
  const time = record(info?.time)
  const type = input.event.type as string
  const archived = type === "session.deleted" || type === "session.archived" || (type === "session.updated" && time?.archived !== undefined)
  if (!archived) return undefined

  const sessionID = typeof info?.id === "string" ? info.id : properties?.sessionID
  if (typeof sessionID !== "string") return undefined
  return { server: input.server, directory: input.directory, sessionIDs: [sessionID] }
}

export function readSessionTabsRemovedDetail(event: Event): SessionTabsRemovedDetail | undefined {
  if (!(event instanceof CustomEvent)) return undefined

  const detail: unknown = event.detail
  if (!detail || typeof detail !== "object") return undefined
  if (!("directory" in detail)) return undefined
  if (!("sessionIDs" in detail)) return undefined
  if (typeof detail.directory !== "string") return undefined
  if (!Array.isArray(detail.sessionIDs)) return undefined
  if ("server" in detail && detail.server !== undefined && typeof detail.server !== "string") return undefined

  const sessionIDs = detail.sessionIDs.filter((id): id is string => typeof id === "string")
  if (sessionIDs.length === 0) return undefined

  return {
    server:
      "server" in detail && typeof detail.server === "string" ? (detail.server as ServerConnection.Key) : undefined,
    directory: detail.directory,
    sessionIDs,
  }
}

export function readSessionTabsReconcileDetail(event: Event): SessionTabsReconcileDetail | undefined {
  if (!(event instanceof CustomEvent)) return undefined

  const detail: unknown = event.detail
  if (!detail || typeof detail !== "object") return undefined
  if (!("server" in detail) || typeof detail.server !== "string") return undefined
  return { server: detail.server as ServerConnection.Key }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
