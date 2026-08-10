import { describe, expect, test } from "bun:test"
import { createAttachClients, rebindAttachClients } from "@/cli/cmd/run/clients"

describe("run attach clients", () => {
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
      if (["/api/provider", "/api/model", "/api/integration"].includes(pathname))
        return Response.json({
          location: { directory: "C:/project", project: { id: "project-1", directory: "C:/project" } },
          data: [],
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
        pathname: "/api/provider",
        timeout: false,
      },
      {
        authorization: "Basic credentials",
        pathname: "/api/model",
        timeout: false,
      },
      {
        authorization: "Basic credentials",
        pathname: "/api/integration",
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
        if (["/api/provider", "/api/model", "/api/integration"].includes(pathname))
          return Response.json({ data: [] })
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
      "/api/provider",
      "/api/model",
      "/api/integration",
      "/api/session/ses-1",
    ])
  })
})
