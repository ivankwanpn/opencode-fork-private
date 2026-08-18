import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "../../../client/src"
import type { SessionNextSessionSnapshot } from "@opencode-ai/sdk/v2/client"
import { adaptServerEvent } from "@/context/server-sdk"
import { projectSessionInfo, toHomeSessionEvent } from "./session-snapshot"

const snapshot = (title = "Title") =>
  ({
    id: "child",
    projectID: "project",
    slug: "slug",
    version: "1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    title,
    location: { directory: "/repo" },
  }) satisfies Extract<OpenCodeEvent, { type: "session.next.updated" }>["data"]["info"]

const current = <Type extends "session.next.created" | "session.next.updated" | "session.next.deleted">(
  type: Type,
) =>
  ({
    id: `evt_${type}`,
    type,
    data: { timestamp: 2, sessionID: "child", info: snapshot() },
  }) as Extract<OpenCodeEvent, { type: Type }>

describe("toHomeSessionEvent", () => {
  test("reads lifecycle payloads from ServerEvent.current", () => {
    const event = adaptServerEvent(current("session.next.updated"))
    expect("data" in event).toBe(false)
    expect(toHomeSessionEvent(event)).toEqual({
      type: "session.next.updated",
      properties: {
        timestamp: 2,
        sessionID: "child",
        info: expect.objectContaining({ id: "child", title: "Title", directory: "/repo" }),
      },
    })
  })

  test("preserves created and deleted lifecycle types", () => {
    expect(toHomeSessionEvent(adaptServerEvent(current("session.next.created")))?.type).toBe("session.next.created")
    expect(toHomeSessionEvent(adaptServerEvent(current("session.next.deleted")))?.type).toBe("session.next.deleted")
  })

  test("ignores events without a current V2 lifecycle payload", () => {
    expect(
      toHomeSessionEvent({ type: "server.connected", properties: {} } as ReturnType<typeof adaptServerEvent>),
    ).toBeUndefined()
  })
})

describe("projectSessionInfo", () => {
  test("normalizes unknown snapshot metadata to JSON", () => {
    const info: SessionNextSessionSnapshot = {
      ...snapshot(),
      metadata: {
        kept: "value",
        omitted: undefined,
        nested: { infinity: Number.POSITIVE_INFINITY, omitted: () => undefined },
        list: [1, undefined, Symbol("unsupported")],
      },
    }

    expect(projectSessionInfo(info).metadata).toEqual({
      kept: "value",
      nested: { infinity: null },
      list: [1, null, null],
    })
  })
})
