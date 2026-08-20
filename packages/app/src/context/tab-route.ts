import type { ServerConnection } from "./server"
import { sessionHref } from "@/utils/session-route"

type RoutableTab =
  | { type: "session"; server: ServerConnection.Key; sessionId: string }
  | { type: "draft"; draftID: string }
  | { type: "error"; server: ServerConnection.Key; errorID: string }

export const draftHref = (draftID: string) => `/new-session?draftId=${encodeURIComponent(draftID)}`
export const errorHref = (errorID: string) => `/error/${encodeURIComponent(errorID)}`

export const tabHref = (tab: RoutableTab) => {
  if (tab.type === "draft") return draftHref(tab.draftID)
  if (tab.type === "error") return errorHref(tab.errorID)
  return sessionHref(tab.server, tab.sessionId)
}

export const tabKey = (tab: RoutableTab) => {
  if (tab.type === "draft") return `draft:${tab.draftID}`
  return `${tab.server}\n${tabHref(tab)}`
}
