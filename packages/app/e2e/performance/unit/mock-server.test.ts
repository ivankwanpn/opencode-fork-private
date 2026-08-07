import { expect, test } from "bun:test"
import type { Page, Route } from "@playwright/test"
import { mockOpenCodeServer } from "../../utils/mock-server"

test("applies message latency after a list response gate is released", async () => {
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  let handler: ((route: Route) => Promise<void>) | undefined
  const page = {
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockOpenCodeServer(page, {
    provider: {},
    directory: "C:/OpenCode",
    project: {},
    sessions: [{ id: "session" }],
    messageDelay: 25,
    beforeMessagesResponse: () => {
      events.push("before")
      return gate.promise
    },
    onMessages: (request) => events.push(request.phase),
    pageMessages: () => {
      events.push("page")
      return { items: [] }
    },
  })

  const response = handler!({
    request: () => ({ url: () => "http://127.0.0.1:4096/api/session/session/message?order=desc" }),
    fulfill: () => {
      events.push("fulfill")
      return Promise.resolve()
    },
  } as unknown as Route)
  expect(events).toEqual(["start", "before"])

  const released = performance.now()
  gate.resolve()
  await response
  expect(performance.now() - released).toBeGreaterThanOrEqual(20)
  expect(events).toEqual(["start", "before", "page", "end", "fulfill"])
})

test("serves a canonical V2 detail for a session omitted from the list", async () => {
  let handler: ((route: Route) => Promise<void>) | undefined
  let response: { status?: number; body?: string } | undefined
  const page = {
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback
      return Promise.resolve()
    },
  } as unknown as Page
  await mockOpenCodeServer(page, {
    provider: {},
    directory: "C:/OpenCode",
    project: {},
    sessions: [{ id: "listed" }],
    session: (sessionID) =>
      sessionID === "orphaned"
        ? { id: sessionID, title: "Orphaned session", time: { created: 1, updated: 2 } }
        : undefined,
    pageMessages: () => ({ items: [] }),
  })

  await handler!({
    request: () => ({ url: () => "http://127.0.0.1:4096/api/session/orphaned" }),
    fulfill: (value: { status?: number; body?: string }) => {
      response = value
      return Promise.resolve()
    },
  } as unknown as Route)

  expect(response?.status).toBe(200)
  expect(JSON.parse(response?.body ?? "null")).toEqual({
    data: {
      id: "orphaned",
      projectID: "project",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      title: "Orphaned session",
      location: { directory: "C:/OpenCode" },
    },
  })
})
