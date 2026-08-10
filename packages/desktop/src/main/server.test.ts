import { describe, expect, mock, test } from "bun:test"
import { checkHealth } from "./server-health"

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

describe("checkHealth", () => {
  test("keeps the legacy fallback when the V2 health route is absent", async () => {
    const requests: string[] = []
    const fetcher = mock(async (input: string | URL | Request) => {
      requests.push(new URL(input instanceof Request ? input.url : input).pathname)
      if (requests.length === 1) return json({}, 404)
      return json({ healthy: true })
    })

    expect(await checkHealth("http://localhost:4096", undefined, undefined, fetcher)).toBe(true)
    expect(requests).toEqual(["/api/health", "/global/health"])
  })

  test("requires valid health and capability responses in V2-only mode", async () => {
    const requests: string[] = []
    const authorization: Array<string | null> = []
    const fetcher = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      const path = new URL(request.url).pathname
      requests.push(path)
      authorization.push(request.headers.get("authorization"))
      if (path === "/api/health") return json({ healthy: true, pid: 123 })
      return json({ backgroundSubagents: true })
    })

    expect(await checkHealth("http://localhost:4096", "secret", { v2Only: true }, fetcher)).toBe(true)
    expect(requests).toEqual(["/api/health", "/api/capability"])
    expect(authorization).toEqual(["Basic b3BlbmNvZGU6c2VjcmV0", "Basic b3BlbmNvZGU6c2VjcmV0"])
  })

  test("does not accept an incomplete V2-only response", async () => {
    const fetcher = mock(async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/api/health") return json({ healthy: true, pid: 123 })
      return json({}, 404)
    })

    expect(await checkHealth("http://localhost:4096", undefined, { v2Only: true }, fetcher)).toBe(false)
  })
})
