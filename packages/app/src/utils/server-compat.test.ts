import { describe, expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi } from "./server-compat"
import { disconnectProviderCredentials } from "./provider-disconnect"

function setup(
  protocol: "v1" | "v2" | Promise<"v1" | "v2">,
  responses?: {
    vcs?: { branch: string; default_branch: string }
    providers?: { connected: string[] }
    auth?: Record<string, { type: "api"; label: string }[]>
  },
) {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      const path = new URL(request.url).pathname
      if (request.method === "GET" && path === "/api/fs/read") {
        return Response.json({
          location: { directory: "/repo", project: { id: "project", directory: "/repo" } },
          data: {
            uri: "file:///repo/file.txt",
            name: "file.txt",
            content: "hello",
            encoding: "utf8",
            mime: "text/plain",
          },
        })
      }
      if (request.method === "GET" && path === "/file/content") {
        return Response.json({ type: "text", content: "hello", mimeType: "text/plain" })
      }
      if (request.method === "PATCH") {
        return Response.json({
          id: "ses_1",
          slug: "ses_1",
          projectID: "project",
          directory: "/repo",
          title: "Session",
          version: "1",
          time: { created: 1, updated: 1 },
        })
      }
      if (request.method === "POST" && request.url.endsWith("/prompt_async"))
        return new Response(undefined, { status: 204 })
      if (request.method === "POST" && path === "/session/ses_1/share")
        return Response.json({ share: { url: "https://share.example/ses_1" } })
      if (request.method === "POST" && request.url.endsWith("/prompt")) {
        return Response.json({
          data: {
            admittedSeq: 1,
            id: "msg_1",
            sessionID: "ses_1",
            timeCreated: 1,
            type: "user",
            data: { text: "hello" },
            delivery: "steer",
          },
        })
      }
      if (request.method === "GET" && path === "/vcs")
        return Response.json(responses?.vcs ?? {})
      if (request.method === "GET" && path === "/provider")
        return Response.json({ all: [], default: {}, connected: responses?.providers?.connected ?? [] })
      if (request.method === "GET" && path === "/provider/auth") return Response.json(responses?.auth ?? {})
      if (request.method === "POST" && (path === "/experimental/worktree" || path === "/api/worktree"))
        return Response.json({ name: "workspace", branch: "opencode/workspace", directory: "/repo/workspace" })
      if (request.method === "DELETE" && (path === "/experimental/worktree" || path === "/api/worktree"))
        return Response.json(true)
      if (
        request.method === "POST" &&
        (path === "/experimental/worktree/reset" || path === "/api/worktree/reset")
      )
        return Response.json(true)
      if (request.method === "POST" && (path === "/project/git/init" || path === "/api/project/git/init"))
        return Response.json({
          id: "project",
          worktree: "/repo",
          vcs: "git",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        })
      if (request.method === "GET") return Response.json([])
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096" }
  const api = createCompatibleApi({
    protocol: typeof protocol === "string" ? Promise.resolve(protocol) : protocol,
    current: createApiForServer({ server, fetch: fetcher }),
    legacy: (directory) => createSdkForServer({ server, fetch: fetcher, directory, throwOnError: true }),
    directory: "/repo",
  })
  return { api, requests }
}

describe("createCompatibleApi", () => {
  test("routes V1 archive through the legacy session update", async () => {
    const { api, requests } = setup("v1")
    await api.session.archive({ sessionID: "ses_1", directory: "/repo" })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/session/ses_1")
    expect(requests[0]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[0]!.method).toBe("PATCH")
    expect(await requests[0]!.json()).toMatchObject({ time: { archived: expect.any(Number) } })
  })

  test("keeps V1 session sharing behind the compatible session API", async () => {
    const { api, requests } = setup("v1")

    expect(await api.session.share({ sessionID: "ses_1" })).toEqual({ url: "https://share.example/ses_1" })
    await api.session.unshare({ sessionID: "ses_1" })

    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      })),
    ).toEqual([
      { method: "POST", path: "/session/ses_1/share" },
      { method: "DELETE", path: "/session/ses_1/share" },
    ])
  })

  test("converts current prompts to the V1 prompt contract", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/session/ses_1/prompt_async")
    const body = await requests[0]!.json()
    expect(body).toMatchObject({
      messageID: "msg_1",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      parts: [
        { type: "text", text: "hello @src/index.ts" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/src/index.ts",
          filename: "index.ts",
          source: {
            type: "file",
            text: { value: "@src/index.ts", start: 6, end: 19 },
            path: "file:///repo/src/index.ts",
          },
        },
        {
          type: "file",
          mime: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
          filename: "notes.txt",
        },
      ],
    })
    expect(body.parts[2]).not.toHaveProperty("source")
  })

  test("preserves original parts for V1 optimistic reconciliation", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "look",
      files: [{ uri: "data:image/png;base64,AAAA", name: "image.png" }],
      legacyParts: [
        { id: "prt_text", type: "text", text: "look" },
        { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
      ],
    })

    expect((await requests[0]!.json()).parts).toEqual([
      { id: "prt_text", type: "text", text: "look" },
      { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
    ])
  })

  test("does not claim durable queue support for V1 prompt fallback", async () => {
    const { api, requests } = setup("v1")

    expect(
      await api.session.prompt({
        sessionID: "ses_1",
        id: "msg_1",
        text: "follow up",
        delivery: "queue",
      }),
    ).toMatchObject({
      sessionID: "ses_1",
      id: "msg_1",
      delivery: "steer",
    })
    expect(new URL(requests[0]!.url).pathname).toBe("/session/ses_1/prompt_async")
  })

  test("keeps V2 session actions on the current API", async () => {
    const { api, requests } = setup("v2")
    await api.session.archive({ sessionID: "ses_1" })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1")
    expect(requests[0]!.method).toBe("PATCH")
    expect(await requests[0]!.json()).toEqual({ archived: expect.any(Number) })
  })

  test("translates current prompts to the nested V2 prompt contract", async () => {
    const { api, requests } = setup("v2")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      context: [{ text: "review this change", metadata: { source: "comment" } }],
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
      ],
      agents: [{ name: "reviewer", mention: { text: "@reviewer", start: 20, end: 29 } }],
      legacyParts: [{ id: "prt_legacy", type: "text", text: "legacy prompt text" }],
      delivery: "queue",
      expectedActiveAttemptID: "evt_attempt_1",
      resume: true,
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/prompt")
    expect(await requests[0]!.json()).toEqual({
      id: "msg_1",
      prompt: {
        text: "hello @src/index.ts",
        context: [{ text: "review this change", metadata: { source: "comment" } }],
        files: [
          {
            uri: "file:///repo/src/index.ts",
            name: "index.ts",
            source: { text: "@src/index.ts", start: 6, end: 19 },
          },
        ],
        agents: [{ name: "reviewer", source: { text: "@reviewer", start: 20, end: 29 } }],
      },
      delivery: "queue",
      expectedActiveAttemptID: "evt_attempt_1",
      resume: true,
    })
  })

  test("translates the legacy shell model to the V2 model reference", async () => {
    const { api, requests } = setup("v2")
    await api.session.shell({
      sessionID: "ses_1",
      id: "evt_shell_1",
      command: "pnpm test",
      agent: "build",
      model: { providerID: "provider", modelID: "model", protocol: "anthropic-messages" },
      variant: "high",
      resume: true,
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/shell")
    expect(await requests[0]!.json()).toEqual({
      id: "evt_shell_1",
      command: "pnpm test",
      agent: "build",
      model: { id: "model", providerID: "provider", variant: "high", protocol: "anthropic-messages" },
      resume: true,
    })
  })

  test("resolves protocol detection once across implementation methods", async () => {
    let detections = 0
    const resolved = Promise.resolve<"v1" | "v2">("v2")
    const protocol = new Proxy(resolved, {
      get(target, property) {
        if (property !== "then") return Reflect.get(target, property, target)
        detections++
        return target.then.bind(target)
      },
    })
    const { api } = setup(protocol)

    await api.session.archive({ sessionID: "ses_1" })
    await api.session.list()

    expect(detections).toBe(1)
  })

  test("uses the global V1 session search endpoint", async () => {
    const { api, requests } = setup("v1")
    await api.session.list({ parentID: null, search: "session", limit: 50 })

    expect(new URL(requests[0]!.url).pathname).toBe("/experimental/session")
  })

  test("projects the V1 default branch", async () => {
    const { api } = setup("v1", { vcs: { branch: "feature", default_branch: "dev" } })

    expect(await api.vcs.get({ location: { directory: "/repo" } })).toMatchObject({
      data: { branch: "feature", defaultBranch: "dev" },
    })
  })

  test("translates current file searches to the V1 dirs parameter", async () => {
    const { api, requests } = setup("v1")
    await api.file.find({ location: { directory: "/repo" }, query: "src", type: "file", limit: 20 })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/find/file")
    expect(url.searchParams.get("dirs")).toBe("false")
    expect(url.searchParams.get("limit")).toBe("20")
  })

  test("routes V1 permission replies through the requested directory", async () => {
    const { api, requests } = setup("v1")
    await api.permission.reply({
      sessionID: "ses_1",
      requestID: "permission_1",
      reply: "once",
      location: { directory: "/other" },
    })

    expect(new URL(requests[0]!.url).pathname).toBe("/session/ses_1/permissions/permission_1")
    expect(new URL(requests[0]!.url).searchParams.get("directory")).toBe("/other")
  })

  test("projects V1 provider auth as credentials and removes it through the legacy endpoint", async () => {
    const { api, requests } = setup("v1", {
      providers: { connected: ["provider"] },
      auth: { provider: [{ type: "api", label: "API key" }] },
    })

    expect(await disconnectProviderCredentials(api, "provider", { directory: "/repo" })).toBe(1)

    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      })),
    ).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/provider" },
        { method: "GET", path: "/provider/auth" },
        { method: "DELETE", path: "/auth/provider" },
      ]),
    )
  })

  test("reads V2 files through the generated endpoint and adapts the content shape", async () => {
    const { api, requests } = setup("v2")

    expect(await api.file.read({ location: { directory: "/repo" }, path: "file.txt" })).toMatchObject({
      data: { type: "text", content: "hello", mimeType: "text/plain" },
    })
    expect(new URL(requests[0]!.url).pathname).toBe("/api/fs/read")
    expect(new URL(requests[0]!.url).searchParams.get("path")).toBe("file.txt")
  })

  test("keeps V1 file reads and global config updates inside the compatibility adapter", async () => {
    const { api, requests } = setup("v1")

    expect(await api.file.read({ location: { directory: "/repo" }, path: "file.txt" })).toMatchObject({
      data: { type: "text", content: "hello" },
    })
    await api.config.get()
    await api.config.update({ config: { disabled_providers: ["provider"] } })

    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      })),
    ).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/file/content" },
        { method: "GET", path: "/global/config" },
        { method: "PATCH", path: "/global/config" },
      ]),
    )
  })

  test("keeps V1 pending requests and MCP operations inside the compatibility adapter", async () => {
    const { api, requests } = setup("v1")

    await api.permission.request.list({ location: { directory: "/repo" } })
    await api.question.request.list({ location: { directory: "/repo" } })
    await api.mcp.list({ location: { directory: "/repo" } })
    await api.mcp.resource.catalog({ location: { directory: "/repo" } })
    await api.mcp.connect({ server: "local", location: { directory: "/repo" } })
    await api.mcp.disconnect({ server: "local", location: { directory: "/repo" } })

    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      })),
    ).toEqual([
      { method: "GET", path: "/permission" },
      { method: "GET", path: "/question" },
      { method: "GET", path: "/mcp" },
      { method: "GET", path: "/experimental/resource" },
      { method: "POST", path: "/mcp/local/connect" },
      { method: "POST", path: "/mcp/local/disconnect" },
    ])
  })

  test("keeps V1 project lifecycle operations inside the compatibility adapter", async () => {
    const { api, requests } = setup("v1")

    expect(await api.worktree.create({ location: { directory: "/repo" }, name: "workspace" })).toMatchObject({
      directory: "/repo/workspace",
    })
    expect(
      await api.worktree.remove({ location: { directory: "/repo" }, directory: "/repo/workspace" }),
    ).toBe(true)
    expect(await api.worktree.reset({ location: { directory: "/repo" }, directory: "/repo/workspace" })).toBe(true)
    expect(await api.project.initGit({ location: { directory: "/repo" } })).toMatchObject({
      id: "project",
      vcs: "git",
    })
    await api.location.dispose({ location: { directory: "/repo/workspace" } })

    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
        directory: request.headers.get("x-opencode-directory"),
      })),
    ).toEqual([
      { method: "POST", path: "/experimental/worktree", directory: "%2Frepo" },
      { method: "DELETE", path: "/experimental/worktree", directory: "%2Frepo" },
      { method: "POST", path: "/experimental/worktree/reset", directory: "%2Frepo" },
      { method: "POST", path: "/project/git/init", directory: "%2Frepo" },
      { method: "POST", path: "/instance/dispose", directory: "%2Frepo%2Fworkspace" },
    ])
  })

  test("routes current project lifecycle operations through V2 endpoints", async () => {
    const { api, requests } = setup("v2")

    await api.worktree.create({ location: { directory: "/repo" }, name: "workspace" })
    await api.worktree.remove({ location: { directory: "/repo" }, directory: "/repo/workspace" })
    await api.worktree.reset({ location: { directory: "/repo" }, directory: "/repo/workspace" })
    await api.project.initGit({ location: { directory: "/repo" } })
    await api.location.dispose({ location: { directory: "/repo/workspace" } })

    expect(
      requests.map((request) => ({
        method: request.method,
        path: new URL(request.url).pathname,
      })),
    ).toEqual([
      { method: "POST", path: "/api/worktree" },
      { method: "DELETE", path: "/api/worktree" },
      { method: "POST", path: "/api/worktree/reset" },
      { method: "POST", path: "/api/project/git/init" },
      { method: "DELETE", path: "/api/location" },
    ])
  })
})
