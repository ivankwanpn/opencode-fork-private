import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import type { ServerEvent } from "@/context/server-sdk"
import {
  readSessionTabsReconcileDetail,
  readSessionTabsRemovedDetail,
  sessionTabsRemovedFromServerEvent,
  SESSION_TABS_RECONCILE_EVENT,
  SESSION_TABS_REMOVED_EVENT,
} from "./titlebar-session-events"

const remote = "remote" as ServerConnection.Key

describe("titlebar session events", () => {
  test("reads valid removed session tab details", () => {
    expect(
      readSessionTabsRemovedDetail(
        new CustomEvent(SESSION_TABS_REMOVED_EVENT, {
          detail: { server: "remote", directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2", 1] },
        }),
      ),
    ).toEqual({
      server: remote,
      directory: "/tmp/project",
      sessionIDs: ["ses_1", "ses_2"],
    })
  })

  test("ignores invalid removed session tab details", () => {
    expect(readSessionTabsRemovedDetail(new Event(SESSION_TABS_REMOVED_EVENT))).toBeUndefined()
    expect(
      readSessionTabsRemovedDetail(
        new CustomEvent(SESSION_TABS_REMOVED_EVENT, {
          detail: { directory: "/tmp/project", sessionIDs: [] },
        }),
      ),
    ).toBeUndefined()
  })

  test("uses the canonical session identity and ignores unrelated events", () => {
    const event = {
      type: "session.next.deleted",
      properties: { timestamp: 1, sessionID: "v2-id", info: { id: "v2-id" } },
      current: {
        type: "session.next.deleted",
        data: { sessionID: "v2-id", info: { id: "v2-id" } },
      },
    } as ServerEvent

    expect(sessionTabsRemovedFromServerEvent({ server: remote, directory: "/tmp/project", event })).toEqual({
      server: remote,
      directory: "/tmp/project",
      sessionIDs: ["v2-id"],
    })
    expect(
      sessionTabsRemovedFromServerEvent({
        server: remote,
        directory: "/tmp/project",
        event: {
          id: "evt_1",
          type: "session.next.status",
          properties: { timestamp: 1, sessionID: "ses_1", status: { type: "idle" } },
        } as ServerEvent,
      }),
    ).toBeUndefined()
  })

  test("reads a server reconcile request", () => {
    expect(
      readSessionTabsReconcileDetail(
        new CustomEvent(SESSION_TABS_RECONCILE_EVENT, { detail: { server: "remote" } }),
      ),
    ).toEqual({ server: remote })
    expect(readSessionTabsReconcileDetail(new Event(SESSION_TABS_RECONCILE_EVENT))).toBeUndefined()
  })
})

const server = "https://server" as ServerConnection.Key

const currentEvent = (type: string, data: Record<string, unknown>): ServerEvent =>
  ({
    current: {
      type,
      data: { sessionID: "ses_x", ...data },
    },
  }) as ServerEvent

describe("titlebar session events (V2 lifecycle)", () => {
  test("closes tabs for session.next.deleted", () => {
    const result = sessionTabsRemovedFromServerEvent({
      server,
      directory: "/repo",
      event: currentEvent("session.next.deleted", {}),
    })
    expect(result?.sessionIDs).toEqual(["ses_x"])
  })

  test("closes tabs for archived session.next.updated snapshots", () => {
    const result = sessionTabsRemovedFromServerEvent({
      server,
      directory: "/repo",
      event: currentEvent("session.next.updated", { info: { time: { archived: 3 } } }),
    })
    expect(result?.sessionIDs).toEqual(["ses_x"])
  })

  test("keeps tabs for non-archived session.next.updated snapshots", () => {
    const result = sessionTabsRemovedFromServerEvent({
      server,
      directory: "/repo",
      event: currentEvent("session.next.updated", { info: { time: {} } }),
    })
    expect(result).toBeUndefined()
  })
})
