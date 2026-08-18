import type { JsonValue, OpenCodeEvent } from "../../../client/src"
import type { Session, SessionNextSessionSnapshot } from "@opencode-ai/sdk/v2/client"
import type { ServerEvent } from "@/context/server-sdk"
import type { HomeSessionEvent } from "@/context/global-sync/home-session-index"

// The vendored @opencode-ai/client/promise (1.17.13) predates the session.next.*
// lifecycle vocabulary, so the wire-event types come from the fork's client
// (packages/client), the same source utils/server.ts resolves for the API.
export type SessionSnapshotInfo = Extract<OpenCodeEvent, { type: "session.next.updated" }>["data"]["info"]
export type SessionLifecycleEvent = Extract<
  OpenCodeEvent,
  { type: "session.next.created" | "session.next.updated" | "session.next.deleted" }
>
export type SessionStatusEvent = Extract<OpenCodeEvent, { type: "session.next.status" }>

export function projectSessionInfo(info: SessionSnapshotInfo | SessionNextSessionSnapshot): Session {
  return {
    id: info.id,
    slug: info.slug,
    projectID: info.projectID,
    workspaceID: info.location.workspaceID,
    directory: info.location.directory,
    path: info.subpath,
    parentID: info.parentID,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    cost: info.cost,
    tokens: info.tokens,
    share: info.share,
    metadata: projectJsonRecord(info.metadata),
    permission: info.permission?.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    revert: info.revert,
    time: {
      created: info.time.created,
      updated: info.time.updated,
      ...(info.time.compacting !== undefined ? { compacting: info.time.compacting } : {}),
      ...(info.time.archived !== undefined ? { archived: info.time.archived } : {}),
    },
  }
}

function projectJsonRecord(value: Readonly<Record<string, unknown>> | undefined) {
  if (!value) return
  const seen = new Set<object>()
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const projected = projectJsonValue(item, seen)
      return projected === undefined ? [] : [[key, projected] as const]
    }),
  )
}

function projectJsonValue(value: unknown, seen: Set<object>): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "object") return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    const projected = value.map((item) => projectJsonValue(item, seen) ?? null)
    seen.delete(value)
    return projected
  }
  const projected = Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const itemValue = projectJsonValue(item, seen)
      return itemValue === undefined ? [] : [[key, itemValue] as const]
    }),
  )
  seen.delete(value)
  return projected
}

export function toHomeSessionEvent(
  event: ServerEvent,
): HomeSessionEvent | undefined {
  const current = event.current
  if (
    current?.type !== "session.next.created" &&
    current?.type !== "session.next.updated" &&
    current?.type !== "session.next.deleted"
  )
    return
  const projected = projectSessionInfo(current.data.info)
  const legacy =
    current.type === "session.next.created"
      ? "session.created"
      : current.type === "session.next.deleted"
        ? "session.deleted"
        : "session.updated"
  return { type: legacy, properties: { sessionID: projected.id, info: projected } }
}
