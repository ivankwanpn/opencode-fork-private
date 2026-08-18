import { describe, expect, test } from "bun:test"
import { createAttachClients, rebindAttachClients } from "@/cli/cmd/run/clients"

describe("run attach clients", () => {
  test("preserves canonical session status events", async () => {
    const source = {
      id: "evt-status",
      type: "session.next.status",
      location: { directory: "C:/project" },
      data: {
        timestamp: 1,
        sessionID: "ses-1",
        status: { type: "idle" },
      },
    } as const
    const clients = createAttachClients({
      baseUrl: "https://opencode.test",
      directory: "C:/project",
      fetch: (async () =>
        new Response(`data: ${JSON.stringify(source)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof globalThis.fetch,
    })

    const events = await clients.sdk.event.subscribe()
    const next = await events.stream.next()

    expect(next.value).toEqual({
      id: "evt-status",
      type: "session.next.status",
      properties: source.data,
    })
  })

  test("preserves canonical permission and question events", async () => {
    const source = [
      {
        id: "evt-permission-asked",
        type: "permission.v2.asked",
        data: {
          id: "per_1",
          sessionID: "ses-1",
          action: "bash",
          resources: ["git status --short"],
          save: ["git status *"],
          source: { type: "tool", messageID: "msg-1", callID: "call-1" },
        },
      },
      {
        id: "evt-permission-replied",
        type: "permission.v2.replied",
        data: { sessionID: "ses-1", requestID: "per_1", reply: "once" },
      },
      {
        id: "evt-question-asked",
        type: "question.v2.asked",
        data: {
          id: "que_1",
          sessionID: "ses-1",
          questions: [
            {
              header: "Mode",
              question: "Which mode?",
              options: [{ label: "Fast", description: "Use the fast mode" }],
            },
          ],
        },
      },
      {
        id: "evt-question-replied",
        type: "question.v2.replied",
        data: { sessionID: "ses-1", requestID: "que_1", answers: [["Fast"]] },
      },
      {
        id: "evt-question-asked-2",
        type: "question.v2.asked",
        data: {
          id: "que_2",
          sessionID: "ses-1",
          questions: [
            {
              header: "Continue",
              question: "Continue?",
              options: [{ label: "Yes", description: "Continue the task" }],
            },
          ],
        },
      },
      {
        id: "evt-question-rejected",
        type: "question.v2.rejected",
        data: { sessionID: "ses-1", requestID: "que_2" },
      },
    ] as const
    const clients = createAttachClients({
      baseUrl: "https://opencode.test",
      fetch: (async () =>
        new Response(source.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        })) as unknown as typeof globalThis.fetch,
    })

    const events = await clients.sdk.event.subscribe()
    const actual: unknown[] = []
    for (let index = 0; index < source.length; index++) actual.push((await events.stream.next()).value)

    expect(actual).toEqual(source.map((event) => ({ id: event.id, type: event.type, properties: event.data })))
  })

  test("share one timeout-safe fetch and authentication headers", async () => {
    const requests: Array<{
      authorization: string | null
      pathname: string
      timeout: boolean | undefined
    }> = []
    const upstream = (async (input, init) => {
      const request = input instanceof Request && init === undefined ? input : new Request(input, init)
      requests.push({
        authorization: request.headers.get("authorization"),
        pathname: new URL(request.url).pathname,
        timeout: (request as Request & { timeout?: boolean }).timeout,
      })

      const pathname = new URL(request.url).pathname
      if (pathname === "/api/provider/catalog")
        return Response.json({
          location: { directory: "C:/project", project: { id: "project-1", directory: "C:/project" } },
          data: { providers: [], models: [], connected: [], default: {} },
        })
      if (pathname.startsWith("/api/session/"))
        return Response.json({ data: { id: "ses-1", title: "Session" } })

      return Response.json({ providers: [], default: {} })
    }) as typeof globalThis.fetch

    const clients = createAttachClients({
      baseUrl: "https://opencode.test",
      directory: "C:/project",
      headers: { Authorization: "Basic credentials" },
      fetch: upstream,
    })

    await clients.sdk.config.providers()
    await clients.native.sessions.get({ sessionID: "ses-1" })

    expect(requests).toEqual([
      {
        authorization: "Basic credentials",
        pathname: "/api/provider/catalog",
        timeout: false,
      },
      {
        authorization: "Basic credentials",
        pathname: "/api/session/ses-1",
        timeout: false,
      },
    ])
  })

  test("rebinds the sdk and native client as one pair", async () => {
    const originalRequests: string[] = []
    const reboundRequests: string[] = []
    const recordingFetch = (requests: string[]) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(new URL(request.url).pathname)
        const pathname = new URL(request.url).pathname
        if (pathname === "/api/provider/catalog")
          return Response.json({ data: { providers: [], models: [], connected: [], default: {} } })
        if (pathname.startsWith("/api/session/")) return Response.json({ data: { id: "ses-1", title: "Session" } })
        return Response.json({ providers: [], default: {} })
      }) as typeof globalThis.fetch

    const original = createAttachClients({
      baseUrl: "https://original.test",
      fetch: recordingFetch(originalRequests),
    })
    const rebound = rebindAttachClients(original, {
      baseUrl: "https://rebound.test",
      directory: "C:/project",
      fetch: recordingFetch(reboundRequests),
    })

    await rebound.sdk.config.providers()
    await rebound.native.sessions.get({ sessionID: "ses-1" })

    expect(rebound).not.toBe(original)
    expect(originalRequests).toEqual([])
    expect(reboundRequests).toEqual([
      "/api/provider/catalog",
      "/api/session/ses-1",
    ])
  })
})
