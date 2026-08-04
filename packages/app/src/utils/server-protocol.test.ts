import { describe, expect, test } from "bun:test"
import { detectServerProtocol } from "./server-protocol"

const server = { url: "http://localhost:4096" }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const mockFetch = (run: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) =>
  Object.assign(run, { preconnect: globalThis.fetch.preconnect })

describe("detectServerProtocol", () => {
  test("recognizes a V2 server that also serves the legacy health endpoint", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({ healthy: true, version: "1.18.4" }))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes a V2 server by its /api/health endpoint alone", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("requires the capability contract for a sidecar connection", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/api/health") return Promise.resolve(json({ healthy: true, pid: 123 }))
      if (path === "/api/capability") return Promise.resolve(json({ backgroundSubagents: true }))
      return Promise.resolve(json({}, 404))
    })

    expect(await detectServerProtocol(server, fetcher, { v2Only: true })).toBe("v2")
  })

  test("fails closed for a sidecar without the V2 capability contract", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/api/health") return Promise.resolve(json({ healthy: true, pid: 123 }))
      return Promise.resolve(json({}, 404))
    })

    await expect(detectServerProtocol(server, fetcher, { v2Only: true })).rejects.toThrow(
      "V2 server capability contract unavailable",
    )
  })

  test("recognizes a pure V1 server that only serves /global/health", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({ healthy: true }))
      return Promise.resolve(json({}, 404))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("recognizes a transitional V1 server with a pid-less /api/health endpoint", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("defaults to V2 when neither health endpoint responds", async () => {
    const fetcher = mockFetch(() => Promise.resolve(json({}, 404)))

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("uses credentials for both protocol health probes", async () => {
    const requests: Request[] = []
    const authenticated = { url: server.url, username: "alice", password: "secret" }
    const fetcher = mockFetch((input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(authenticated, fetcher)).toBe("v1")
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/health", "/global/health"])
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
      "Basic YWxpY2U6c2VjcmV0",
      "Basic YWxpY2U6c2VjcmV0",
    ])
  })
})
