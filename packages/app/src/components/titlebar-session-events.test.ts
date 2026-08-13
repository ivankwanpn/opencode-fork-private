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

  test("maps legacy deleted and archived events to tab cleanup", () => {
    expect(
      sessionTabsRemovedFromServerEvent({
        server: remote,
        directory: "/tmp/project",
        event: {
          type: "session.deleted",
          properties: { sessionID: "ses_deleted" },
        } as ServerEvent,
      }),
    ).toEqual({ server: remote, directory: "/tmp/project", sessionIDs: ["ses_deleted"] })

    expect(
      sessionTabsRemovedFromServerEvent({
        server: remote,
        directory: "/tmp/project",
        event: {
          type: "session.updated",
          properties: { info: { id: "ses_archived", time: { archived: 10 } } },
        } as ServerEvent,
      }),
    ).toEqual({ server: remote, directory: "/tmp/project", sessionIDs: ["ses_archived"] })
  })

  test("prefers the current V2 session identity and ignores unrelated events", () => {
    const event = {
      type: "session.deleted",
      properties: { sessionID: "legacy-id" },
      current: {
        type: "session.deleted",
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
        event: { id: "evt_1", type: "session.status", properties: { sessionID: "ses_1" } } as ServerEvent,
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
