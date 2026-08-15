import type { CustomProvider } from "@opencode-ai/schema"
import { expect, expectTypeOf, test } from "bun:test"
import { isSessionNotFoundError, isUnauthorizedError, OpenCode } from "../src"

test("exposes every standard HTTP API group", () => {
  const client = OpenCode.make({ baseUrl: "http://localhost:3000" })

  expect(Object.keys(client)).toEqual([
    "health",
    "location",
    "path",
    "agents",
    "sessions",
    "messages",
    "models",
    "providers",
    "integrations",
    "credentials",
    "permissions",
    "files",
    "commands",
    "skills",
    "mcps",
    "lsp",
    "projects",
    "worktrees",
    "capabilities",
    "vcs",
    "formatters",
    "console",
    "config",
    "workspaces",
    "controlPlane",
    "server.plugins",
    "events",
    "ptys",
    "questions",
    "references",
    "projectCopies",
  ])
  expect(Object.keys(client.messages)).toEqual(["list"])
  expect(Object.keys(client.integrations)).toEqual([
    "list",
    "get",
    "connectKey",
    "connectOauth",
    "attemptStatus",
    "attemptComplete",
    "attemptCancel",
  ])
  expect(Object.keys(client.files)).toEqual(["read", "list", "find"])
  expect(Object.keys(client.ptys)).toEqual(["shells", "list", "create", "get", "update", "remove"])
  expect(Object.keys(client.providers)).toEqual([
    "catalog",
    "list",
    "get",
    "discoverModels",
    "disconnect",
    "discoverCustom",
    "configureCustom",
    "disconnectCustom",
  ])
})

test("plugin runtime uses the Location-aware HTTP contract", async () => {
  const requests: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
      return Response.json({
        location: { directory: "/tmp/project", project: { id: "project", directory: "/tmp/project" } },
        data: { plugins: [] },
      })
    },
  })

  expect(await client["server.plugins"].runtime({ location: { directory: "/tmp/project" } })).toMatchObject({
    data: { plugins: [] },
  })
  expect(requests).toEqual([
    "http://localhost:3000/api/plugins/runtime?location%5Bdirectory%5D=%2Ftmp%2Fproject",
  ])
})

test("project and path methods use the v2 HTTP contract", async () => {
  const requests: string[] = []
  const project = {
    id: "project",
    worktree: "/tmp/project",
    vcs: "git" as const,
    time: { created: 1, updated: 2 },
    sandboxes: [],
  }
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      requests.push(url)
      if (url.endsWith("/api/project")) return Response.json([project])
      if (url.includes("/api/project/current")) return Response.json({ id: "project", directory: "/tmp/project" })
      return Response.json({
        home: "/home/test",
        state: "/home/test/.state",
        config: "/home/test/.config",
        worktree: "/tmp/project",
        directory: "/tmp/project/src",
      })
    },
  })

  expect(await client.projects.list()).toEqual([project])
  expect(await client.projects.current({ location: { directory: "/tmp/project/src" } })).toEqual({
    id: "project",
    directory: "/tmp/project",
  })
  expect(await client.path.get({ location: { directory: "/tmp/project/src" } })).toEqual({
    home: "/home/test",
    state: "/home/test/.state",
    config: "/home/test/.config",
    worktree: "/tmp/project",
    directory: "/tmp/project/src",
  })
  expect(requests).toEqual([
    "http://localhost:3000/api/project",
    "http://localhost:3000/api/project/current?location%5Bdirectory%5D=%2Ftmp%2Fproject%2Fsrc",
    "http://localhost:3000/api/path?location%5Bdirectory%5D=%2Ftmp%2Fproject%2Fsrc",
  ])
})

test("custom provider methods use the public HTTP contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      requests.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        init,
      })
      return Response.json({
        location: {
          directory: "/tmp/project",
          project: { id: "project", directory: "/tmp/project" },
        },
        data: { endpoint: "https://api.example.com/v1/models", models: [] },
      })
    },
  })

  await client.providers.discoverCustom({
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    headers: [],
    location: { directory: "/tmp/project", workspace: "workspace" },
  })
  await client.providers.configureCustom({
    providerID: "example",
    name: "Example",
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    headers: [],
    models: [{ id: "model", name: "Model" }],
  })

  expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
    [
      "POST",
      "http://localhost:3000/api/provider/custom/discover?location%5Bdirectory%5D=%2Ftmp%2Fproject&location%5Bworkspace%5D=workspace",
    ],
    ["POST", "http://localhost:3000/api/provider/custom/configure"],
  ])
  expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    headers: [],
  })
  expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
    providerID: "example",
    name: "Example",
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    headers: [],
    models: [{ id: "model", name: "Model" }],
  })
})

test("custom provider methods expose schema-shaped inputs and location responses", () => {
  const client = OpenCode.make({ baseUrl: "http://localhost:3000" })

  expectTypeOf<Parameters<typeof client.providers.discoverCustom>[0]>().toEqualTypeOf<
    CustomProvider.DiscoverInput & LocationInput
  >()
  expectTypeOf<ReturnType<typeof client.providers.discoverCustom>>().toEqualTypeOf<
    Promise<LocationResponse<CustomProvider.DiscoverResult>>
  >()
  expectTypeOf<Parameters<typeof client.providers.configureCustom>[0]>().toEqualTypeOf<
    CustomProvider.ConfigureInput & LocationInput
  >()
  expectTypeOf<ReturnType<typeof client.providers.configureCustom>>().toEqualTypeOf<
    Promise<LocationResponse<CustomProvider.ConfigureResult>>
  >()
})

test("sessions.get returns the wire projection", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input) => {
      expect(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).toBe(
        "http://localhost:3000/api/session/ses_test",
      )
      return Response.json(session)
    },
  })

  const result = await client.sessions.get({ sessionID: "ses_test" })

  expect(result.time.created).toBe(1_717_171_717_000)
})

test("events.subscribe exposes the Promise event stream wire projection", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      new Response(
        `: heartbeat\n\ndata: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n` +
          `data: ${JSON.stringify(modelSwitchedEvent)}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  })
  const events = []
  for await (const event of client.events.subscribe()) events.push(event)

  expect(events).toEqual([{ id: "evt_connected", type: "server.connected", data: {} }, modelSwitchedEvent])
  expect(events[1]?.type === "session.next.model.switched" && events[1].data.timestamp).toBe(1_717_171_717_000)
})

test("events.subscribe terminates on malformed Promise SSE data", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () => new Response("data: {not-json}\n\n", { headers: { "content-type": "text/event-stream" } }),
  })

  await expect(client.events.subscribe()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
    name: "ClientError",
    reason: "MalformedResponse",
  })
})

test("session methods use the public HTTP contract", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  let historyPage = 0
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      requests.push({ url, init })
      if (url.includes("/event")) {
        return new Response(`data: ${JSON.stringify(modelSwitchedEvent)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
      }
      if (url.includes("/history")) {
        historyPage++
        return Response.json(
          historyPage === 1 ? { data: [modelSwitchedEvent], hasMore: true } : { data: [], hasMore: false },
        )
      }
      if (url.includes("/prompt")) return Response.json(admission)
      if (url.includes("/context")) return Response.json({ data: [] })
      if (url.includes("/message/")) return Response.json({ data: modelSwitchedMessage })
      if (url.endsWith("/api/session/active")) return Response.json({ data: { ses_test: { type: "running" } } })
      if (init?.method === "POST" && url.endsWith("/api/session")) return Response.json(session)
      if (init?.method === "POST") return new Response(null, { status: 204 })
      return Response.json({ data: [session.data], cursor: { next: "next" } })
    },
  })

  const page = await client.sessions.list({ limit: 10, order: "desc" })
  const active = await client.sessions.active()
  const created = await client.sessions.create({ location: { directory: "/tmp/project" } })
  await client.sessions.switchAgent({ sessionID: "ses_test", agent: "build" })
  await client.sessions.switchModel({
    sessionID: "ses_test",
    model: { id: "claude", providerID: "anthropic" },
  })
  const admitted = await client.sessions.prompt({
    sessionID: "ses_test",
    prompt: { text: "Hello" },
    resume: false,
  })
  await client.sessions.compact({ sessionID: "ses_test" })
  await client.sessions.wait({ sessionID: "ses_test" })
  const context = await client.sessions.context({ sessionID: "ses_test" })
  const history = await client.sessions.history({ sessionID: "ses_test", after: 0, limit: 1 })
  const historyAfter = history.data.at(-1)?.durable?.seq
  const historyNext = history.hasMore
    ? await client.sessions.history({ sessionID: "ses_test", after: historyAfter, limit: 2 })
    : undefined
  const events = []
  for await (const event of client.sessions.events({ sessionID: "ses_test", after: 0 })) events.push(event)
  await client.sessions.interrupt({ sessionID: "ses_test" })
  const message = await client.sessions.message({ sessionID: "ses_test", messageID: "msg_model" })

  expect(page.cursor.next).toBe("next")
  expect(active).toEqual({ ses_test: { type: "running" } })
  expect(created.id).toBe("ses_test")
  expect(admitted.id).toBe("msg_test")
  expect(context).toEqual([])
  expect(history).toEqual({ data: [modelSwitchedEvent], hasMore: true })
  expect(historyNext).toEqual({ data: [], hasMore: false })
  expect(events).toEqual([modelSwitchedEvent])
  expect(message).toEqual(modelSwitchedMessage)
  expect(requests.map((request) => [request.init?.method, request.url])).toEqual([
    ["GET", "http://localhost:3000/api/session?limit=10&order=desc"],
    ["GET", "http://localhost:3000/api/session/active"],
    ["POST", "http://localhost:3000/api/session"],
    ["POST", "http://localhost:3000/api/session/ses_test/agent"],
    ["POST", "http://localhost:3000/api/session/ses_test/model"],
    ["POST", "http://localhost:3000/api/session/ses_test/prompt"],
    ["POST", "http://localhost:3000/api/session/ses_test/compact"],
    ["POST", "http://localhost:3000/api/session/ses_test/wait"],
    ["GET", "http://localhost:3000/api/session/ses_test/context"],
    ["GET", "http://localhost:3000/api/session/ses_test/history?limit=1&after=0"],
    ["GET", "http://localhost:3000/api/session/ses_test/history?limit=2&after=1"],
    ["GET", "http://localhost:3000/api/session/ses_test/event?after=0"],
    ["POST", "http://localhost:3000/api/session/ses_test/interrupt"],
    ["GET", "http://localhost:3000/api/session/ses_test/message/msg_model"],
  ])
  const body = requests.find((request) => request.url.endsWith("/api/session/ses_test/prompt"))?.init?.body
  if (typeof body !== "string") throw new Error("Expected JSON request body")
  expect(JSON.parse(body)).toEqual({
    prompt: { text: "Hello" },
    resume: false,
  })
})

test("middleware errors remain declared client errors", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 }),
  })

  try {
    await client.sessions.create({})
    throw new Error("Expected request to fail")
  } catch (error) {
    expect(isUnauthorizedError(error)).toBe(true)
  }
})

test("sessions.history decodes SessionNotFoundError", async () => {
  const client = OpenCode.make({
    baseUrl: "http://localhost:3000",
    fetch: async () =>
      Response.json(
        { _tag: "SessionNotFoundError", sessionID: "ses_missing", message: "Session not found" },
        { status: 404 },
      ),
  })

  try {
    await client.sessions.history({ sessionID: "ses_missing" })
    throw new Error("Expected request to fail")
  } catch (error) {
    expect(isSessionNotFoundError(error)).toBe(true)
  }
})

const session = {
  data: {
    id: "ses_test",
    projectID: "project",
    cost: 0,
    tokens: {
      input: 1,
      output: 2,
      reasoning: 3,
      cache: { read: 4, write: 5 },
    },
    time: {
      created: 1_717_171_717_000,
      updated: 1_717_171_717_000,
    },
    title: "Test",
    location: { directory: "/tmp/project" },
  },
}

const admission = {
  data: {
    admittedSeq: 0,
    id: "msg_test",
    sessionID: "ses_test",
    prompt: { text: "Hello" },
    delivery: "steer",
    timeCreated: 1_717_171_717_000,
  },
}

const modelSwitchedMessage = {
  id: "msg_model",
  type: "model-switched",
  time: { created: 1_717_171_717_000 },
  model: { id: "claude", providerID: "anthropic" },
}

const modelSwitchedEvent = {
  id: "evt_model",
  type: "session.next.model.switched",
  durable: { aggregateID: "ses_test", seq: 1, version: 1 },
  data: {
    timestamp: 1_717_171_717_000,
    sessionID: "ses_test",
    messageID: "msg_model",
    model: { id: "claude", providerID: "anthropic" },
  },
}

type LocationInput = {
  readonly location?: {
    readonly directory?: string
    readonly workspace?: string
  }
}

type LocationResponse<T> = {
  readonly location: {
    readonly directory: string
    readonly workspaceID?: string
    readonly project: {
      readonly id: string
      readonly directory: string
    }
  }
  readonly data: T
}
