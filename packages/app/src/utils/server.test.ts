import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer } from "./server"

function testFetch(run: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>) {
  return Object.assign(run, { preconnect() {} })
}

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("createApiForServer VCS adapter", () => {
  const location = {
    directory: "/project",
    project: { id: "project", directory: "/project" },
  }

  test("projects the V2 default branch field for the app", async () => {
    const api = createApiForServer({
      server: { url: "https://server.example" },
      fetch: testFetch(async () =>
        Response.json({ location, data: { branch: "feature/session-v2", default_branch: "dev" } }),
      ),
    })

    await expect(api.vcs.get({ location: { directory: "/project" } })).resolves.toEqual({
      location,
      data: { branch: "feature/session-v2", defaultBranch: "dev" },
    })
  })

  test("translates working diffs to the V2 git mode", async () => {
    const calls: URL[] = []
    const api = createApiForServer({
      server: { url: "https://server.example" },
      fetch: testFetch(async (input) => {
        calls.push(new URL(input.toString()))
        return Response.json({
          location,
          data: [
            { file: "src/index.ts", additions: 2, deletions: 1 },
            { additions: 0, deletions: 0 },
          ],
        })
      }),
    })

    await expect(api.vcs.diff({ location: { directory: "/project" }, mode: "working" })).resolves.toEqual({
      location,
      data: [
        {
          file: "src/index.ts",
          patch: "",
          additions: 2,
          deletions: 1,
          status: "modified",
        },
      ],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.pathname).toBe("/api/vcs/diff")
    expect(calls[0]?.searchParams.get("location[directory]")).toBe("/project")
    expect(calls[0]?.searchParams.get("mode")).toBe("git")
  })
})

describe("createApiForServer session adapter", () => {
  test("preserves a failed background result and selected call ID", async () => {
    const calls: URL[] = []
    const api = createApiForServer({
      server: { url: "https://server.example" },
      fetch: testFetch(async (input) => {
        calls.push(new URL(input.toString()))
        return Response.json(false)
      }),
    })

    await expect(api.session.backgroundSelected({ sessionID: "ses_test", callID: "call_shell" })).resolves.toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.pathname).toBe("/api/session/ses_test/background")
    expect(calls[0]?.searchParams.get("callID")).toBe("call_shell")
  })
})
