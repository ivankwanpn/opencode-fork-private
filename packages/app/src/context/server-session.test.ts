import { describe, expect, test } from "bun:test"
import type { retry } from "@opencode-ai/core/util/retry"
import type { MessageApi, OpenCodeEvent, SessionApi, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { Message, OpencodeClient, Part, Session, Todo, V2Event } from "@opencode-ai/sdk/v2/client"
import type { ServerApi } from "@/utils/server"
import { createV2OnlyApi, type CompatibleApi } from "@/utils/server-compat"
import type { SessionSnapshotInfo } from "@/utils/session-snapshot"
import { createServerSession } from "./server-session"

const session = (id: string, parentID?: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  title: id,
  version: "1",
  parentID,
  time: { created: 1, updated: 1 },
})

type UserMessage = Extract<Message, { role: "user" }>
type AssistantMessage = Extract<Message, { role: "assistant" }>
type TextPart = Extract<Part, { type: "text" }>
type MessageResponse = {
  data: { info: Message; parts: Part[] }[]
  response: { headers: Headers }
}
type SingleMessageResponse = { data: MessageResponse["data"][number] }

const userMessage = (id: string, input: Partial<UserMessage> = {}): UserMessage => ({
  id,
  sessionID: "child",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "provider", modelID: "model" },
  ...input,
})

const assistantMessage = (id: string, parentID: string, input: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id,
  sessionID: "child",
  role: "assistant",
  time: { created: Number(id.at(-1)), completed: Number(id.at(-1)) },
  parentID,
  modelID: "model",
  providerID: "provider",
  mode: "build",
  agent: "build",
  path: { cwd: "/repo", root: "/repo" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  ...input,
})

const textPart = (messageID: string, input: Partial<TextPart> = {}): TextPart => ({
  id: "part",
  sessionID: "child",
  messageID,
  type: "text",
  text: "text",
  ...input,
})

const response = (data: MessageResponse["data"] = [], cursor?: string): MessageResponse => ({
  data,
  response: { headers: new Headers(cursor ? { "x-next-cursor": cursor } : undefined) },
})

const singleResponse = (info: Message, parts: Part[] = []): SingleMessageResponse => ({ data: { info, parts } })

const deferredResponse = () => Promise.withResolvers<MessageResponse>()

function currentMessageApi(...pages: SessionMessageInfo[][]) {
  let index = 0
  return {
    list: async () => ({ data: pages[index++] ?? [], cursor: { previous: null, next: null } }),
  } as unknown as MessageApi
}

const userInfo = (id: string, created: number) =>
  ({ id, type: "user", text: id, time: { created } }) satisfies Extract<SessionMessageInfo, { type: "user" }>

function currentHistory(content: Extract<SessionMessageInfo, { type: "assistant" }>["content"]) {
  return [
    {
      id: "msg_2_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content,
      time: { created: 2, completed: 3 },
    },
    { id: "msg_1_user", type: "user", text: "hello", time: { created: 1 } },
  ] as SessionMessageInfo[]
}

const currentText = (text: string) => ({ type: "text" as const, text })
const currentTool = (id: string) => ({
  type: "tool" as const,
  id,
  name: "read",
  state: {
    status: "completed" as const,
    input: { filePath: "src/index.ts" },
    structured: {},
    content: [],
    result: "done",
  },
  time: { created: 2, ran: 2, completed: 3 },
})

function messageClient(...responses: Array<MessageResponse | Promise<MessageResponse>>) {
  let index = 0
  const requests: unknown[] = []
  const waiting = new Map<number, () => void>()
  const client = {
    session: {
      get: async () => ({ data: session("child", "root") }),
      messages: (input: unknown) => {
        requests.push(input)
        waiting.get(requests.length)?.()
        waiting.delete(requests.length)
        return responses[index++]
      },
    },
  } as unknown as OpencodeClient
  return Object.assign(client, {
    requests,
    requested(count: number) {
      if (requests.length >= count) return Promise.resolve()
      return new Promise<void>((resolve) => waiting.set(count, resolve))
    },
  })
}

function rootMessageClient(
  pages: Array<MessageResponse | Promise<MessageResponse>>,
  roots: Array<SingleMessageResponse | Promise<SingleMessageResponse>>,
) {
  let pageIndex = 0
  let rootIndex = 0
  const requests: unknown[] = []
  const rootRequests: unknown[] = []
  const rootWaiting = new Map<number, () => void>()
  const client = {
    session: {
      get: async () => ({ data: session("child", "root") }),
      messages: (input: unknown) => {
        requests.push(input)
        return pages[pageIndex++]
      },
      message: (input: unknown) => {
        rootRequests.push(input)
        rootWaiting.get(rootRequests.length)?.()
        rootWaiting.delete(rootRequests.length)
        return roots[rootIndex++]
      },
    },
  } as unknown as OpencodeClient
  return Object.assign(client, {
    requests,
    rootRequests,
    rootRequested(count: number) {
      if (rootRequests.length >= count) return Promise.resolve()
      return new Promise<void>((resolve) => rootWaiting.set(count, resolve))
    },
  })
}

const retryImmediately: typeof retry = async (task, options = {}) => {
  const attempts = options.attempts ?? 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt === attempts - 1) throw error
    }
  }
}

// Deterministic wait-until-condition helper. bun 1.3.14 has no expect.poll for
// this package, so hydration barriers yield microtasks instead of sleeping.
async function pollUntil<T>(read: () => T, ready: (value: T) => boolean, ticks = 1_000): Promise<T> {
  for (let index = 0; index < ticks; index++) {
    const value = read()
    if (ready(value)) return value
    await Promise.resolve()
  }
  throw new Error(`pollUntil: condition not met after ${ticks} microtask ticks`)
}

function setup(sessions: Record<string, Session>) {
  const get: unknown[] = []
  const messages: unknown[] = []
  const client = {
    session: {
      get: async (input: unknown) => {
        get.push(input)
        const id = (input as { sessionID: string }).sessionID
        return { data: sessions[id] }
      },
      messages: async (input: unknown) => {
        messages.push(input)
        return response()
      },
      diff: async () => ({ data: [] }),
      todo: async () => ({ data: [] }),
    },
  } as unknown as OpencodeClient
  return { get, messages, store: createServerSession(client) }
}

const snapshot = (over: Partial<SessionSnapshotInfo> = {}) =>
  ({
    id: "child",
    projectID: "project",
    slug: "slug",
    version: "1",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    title: "Title",
    location: { directory: "/repo" },
    ...over,
  }) satisfies SessionSnapshotInfo

describe("server session", () => {
  test("preserves canonical mixed content order on initial V2 history load", async () => {
    const cases: Array<{
      content: Extract<SessionMessageInfo, { type: "assistant" }>["content"]
      expected: Part["type"][]
    }> = [
      {
        content: [currentText("before"), currentTool("call_text_tool")],
        expected: ["text", "tool"],
      },
      {
        content: [currentTool("call_tool_text"), currentText("after")],
        expected: ["tool", "text"],
      },
      {
        content: [currentText("before"), currentTool("call_between"), currentText("after")],
        expected: ["text", "tool", "text"],
      },
    ]

    for (const value of cases) {
      const store = createServerSession(
        {} as OpencodeClient,
        { get: async () => session("child") } as unknown as SessionApi,
        currentMessageApi(currentHistory(value.content)),
        { retry: retryImmediately },
      )
      await store.sync("child")
      expect(store.data.part.msg_2_assistant?.map((part) => part.type)).toEqual(value.expected)
    }
  })

  test("appends a live V2 tool after existing assistant text", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.set("session_message", "child", currentHistory([currentText("before")]).toReversed())

    ctx.store.applyV2({
      id: "evt_tool_started",
      type: "session.next.tool.input.started",
      location: { directory: "/repo" },
      data: {
        timestamp: 4,
        sessionID: "child",
        assistantMessageID: "msg_2_assistant",
        callID: "call_live_after_text",
        name: "read",
      },
    } as V2Event)

    expect(ctx.store.data.part.msg_2_assistant?.map((part) => part.type)).toEqual(["text", "tool"])
  })

  test("reorders parts to canonical content order on forced V2 refresh", async () => {
    const store = createServerSession(
      {} as OpencodeClient,
      { get: async () => session("child") } as unknown as SessionApi,
      currentMessageApi(
        currentHistory([currentTool("call_initial"), currentText("after")]),
        currentHistory([currentText("before"), currentTool("call_initial")]),
      ),
      { retry: retryImmediately },
    )

    await store.sync("child")
    expect(store.data.part.msg_2_assistant?.map((part) => part.type)).toEqual(["tool", "text"])

    await store.sync("child", { force: true })
    expect(store.data.part.msg_2_assistant?.map((part) => part.type)).toEqual(["text", "tool"])
  })

  test("orders an out-of-order initial V2 page by creation time", async () => {
    // Current API pages are descending. These IDs deliberately conflict with
    // creation order so the old ID comparator is guaranteed to fail RED.
    const api = currentMessageApi([userInfo("msg_a_late", 10), userInfo("msg_z_early", 1)])
    const store = createServerSession(
      {} as OpencodeClient,
      { get: async () => session("child") } as unknown as SessionApi,
      api,
      { retry: retryImmediately },
    )
    await store.sync("child")
    // session_message is the raw current-API source; message is the sorted SDK projection.
    expect(store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_early", "msg_a_late"])
  })

  test("merges an older optimistic message before newer server messages", async () => {
    const api = currentMessageApi([userInfo("msg_a_server", 10)])
    const store = createServerSession(
      {} as OpencodeClient,
      { get: async () => session("child") } as unknown as SessionApi,
      api,
      { retry: retryImmediately },
    )
    store.optimistic.add({
      sessionID: "child",
      message: {
        id: "msg_z_optimistic",
        sessionID: "child",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "provider", modelID: "model" },
      },
      parts: [],
    })
    await store.sync("child")
    expect(store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_optimistic", "msg_a_server"])
  })

  test("inserts live updated messages by creation time", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.set("message", "child", [
      {
        id: "msg_a_server",
        sessionID: "child",
        role: "user",
        time: { created: 10 },
        agent: "build",
        model: { providerID: "provider", modelID: "model" },
      },
    ])
    ctx.store.apply({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_z_older",
          sessionID: "child",
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
        },
      },
    })
    expect(ctx.store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_older", "msg_a_server"])
  })

  test("sorts hydrated messages by creation time", async () => {
    const sessionApi = {
      get: async () => session("child"),
      message: async () => userInfo("msg_z_hydrated", 1),
    } as unknown as SessionApi
    const store = createServerSession(
      {} as OpencodeClient,
      sessionApi,
      currentMessageApi([userInfo("msg_a_existing", 10)]),
      { retry: retryImmediately },
    )
    await store.sync("child")
    store.applyV2({
      id: "evt_imported",
      created: 1,
      type: "session.next.message.imported",
      metadata: {},
      location: { directory: "/repo" },
      data: {
        timestamp: 1,
        sessionID: "child",
        message: { id: "msg_z_hydrated", type: "user", text: "hydrated", time: { created: 1 } },
      },
    } as unknown as V2Event)
    const ids = await pollUntil(
      () => store.data.session_message.child?.map((message) => message.id),
      (value) => value !== undefined && value.includes("msg_z_hydrated"),
    )
    expect(ids).toEqual(["msg_z_hydrated", "msg_a_existing"])
  })

  test("removes a conflicting-id message from the time-ordered projection", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    // msg_a_late is later in creation time but earlier in id order, so a
    // binary search by id on the time-ordered projection would miss it.
    ctx.store.set("message", "child", [
      userMessage("msg_z_early", { time: { created: 1 } }),
      userMessage("msg_a_late", { time: { created: 10 } }),
    ])
    ctx.store.apply({
      type: "message.removed",
      properties: { sessionID: "child", messageID: "msg_a_late" },
    })
    expect(ctx.store.data.message.child?.map((message) => message.id)).toEqual(["msg_z_early"])
  })

  test("accepts a part update for a conflicting-id message already in the projection", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.set("message", "child", [
      userMessage("msg_z_early", { time: { created: 1 } }),
      userMessage("msg_a_late", { time: { created: 10 } }),
    ])
    ctx.store.apply({
      type: "message.part.updated",
      properties: {
        sessionID: "child",
        part: textPart("msg_a_late", { id: "part_a_late", text: "late" }),
      },
    })
    expect(ctx.store.data.part.msg_a_late).toEqual([
      expect.objectContaining({ id: "part_a_late", messageID: "msg_a_late", text: "late" }),
    ])
  })

  test("projects V2 session events into current and legacy message state", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.set("session_message", "child", [
      {
        id: "msg_1_user",
        type: "user",
        text: "hello",
        time: { created: 1 },
      },
    ])
    const apply = (input: object) => ctx.store.applyV2(input as OpenCodeEvent)

    apply({
      id: "evt_step",
      created: 2,
      type: "session.step.started",
      durable: { aggregateID: "child", seq: 1, version: 1 },
      location: { directory: "/repo" },
      data: {
        sessionID: "child",
        assistantMessageID: "msg_2_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      id: "evt_text_start",
      created: 3,
      type: "session.text.started",
      durable: { aggregateID: "child", seq: 2, version: 1 },
      location: { directory: "/repo" },
      data: { sessionID: "child", assistantMessageID: "msg_2_assistant", ordinal: 0 },
    })
    apply({
      id: "evt_text_delta",
      created: 4,
      type: "session.text.delta",
      location: { directory: "/repo" },
      data: { sessionID: "child", assistantMessageID: "msg_2_assistant", ordinal: 0, delta: "world" },
    })

    expect(ctx.store.data.session_message.child?.at(-1)).toEqual(
      expect.objectContaining({
        id: "msg_2_assistant",
        type: "assistant",
        content: [expect.objectContaining({ type: "text", text: "world" })],
      }),
    )
    expect(ctx.store.data.message.child?.map((message) => message.id)).toEqual(["msg_1_user", "msg_2_assistant"])
    expect(ctx.store.data.part.msg_2_assistant).toEqual([expect.objectContaining({ type: "text", text: "world" })])
  })

  test("refreshes V2 history when durable event sequences have a gap", async () => {
    const user = userMessage("msg_1_user")
    const assistant = assistantMessage("msg_2_assistant", user.id)
    const requests: unknown[] = []
    const refreshed = Promise.withResolvers<unknown>()
    const messageApi = {
      list: async (input: unknown) => {
        requests.push(input)
        return refreshed.promise
      },
    } as unknown as MessageApi
    const sessionApi = { get: async () => session("child") } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, messageApi, {
      retry: retryImmediately,
    })
    store.remember(session("child"))
    store.set("session_message", "child", [{ id: user.id, type: "user", text: "hello", time: user.time }])

    store.applyV2({
      id: "evt_step_started",
      created: 2,
      type: "session.step.started",
      durable: { aggregateID: "child", seq: 1, version: 1 },
      location: { directory: "/repo" },
      data: {
        sessionID: "child",
        assistantMessageID: assistant.id,
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    } as unknown as V2Event)
    store.applyV2({
      id: "evt_step_ended",
      created: 4,
      type: "session.step.ended",
      durable: { aggregateID: "child", seq: 3, version: 1 },
      location: { directory: "/repo" },
      data: {
        sessionID: "child",
        assistantMessageID: assistant.id,
        finish: "stop",
        cost: 0,
        tokens: assistant.tokens,
      },
    } as unknown as V2Event)
    store.applyV2({
      id: "evt_text_delta",
      created: 5,
      type: "session.next.text.delta",
      durable: { aggregateID: "child", seq: 4, version: 1 },
      location: { directory: "/repo" },
      data: {
        timestamp: 5,
        sessionID: "child",
        assistantMessageID: assistant.id,
        textID: "text_1",
        delta: " live",
      },
    } as unknown as V2Event)
    refreshed.resolve({
      data: [
        {
          id: assistant.id,
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [{ type: "text", text: "complete answer" }],
          time: assistant.time,
        },
        { id: user.id, type: "user", text: "hello", time: user.time },
      ],
      cursor: { previous: null, next: null },
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(requests).toEqual([{ sessionID: "child", limit: 20, order: "desc" }])
    expect(store.data.part[assistant.id]).toEqual([expect.objectContaining({ text: "complete answer live" })])
  })

  test("refreshes the active turn snapshot after a durable event gap", async () => {
    const refreshed = Promise.withResolvers<unknown>()
    const messageApi = {
      list: async () => refreshed.promise,
    } as unknown as MessageApi
    const sessionApi = { get: async () => session("child") } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, messageApi, {
      retry: retryImmediately,
      activeSessions: async () => ({
        child: { type: "running", turnID: "msg_current_turn", phase: "active" },
      }),
    })
    store.remember(session("child"))
    store.setTurn("child", "msg_stale_turn", "active")

    const event = (seq: number, id: string) =>
      ({
        id,
        created: seq,
        type: "session.step.started",
        durable: { aggregateID: "child", seq, version: 1 },
        location: { directory: "/repo" },
        data: {
          sessionID: "child",
          assistantMessageID: "msg_assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
        },
      }) as unknown as V2Event

    store.applyV2(event(1, "evt_turn_before_gap"))
    store.applyV2(event(3, "evt_turn_after_gap"))
    refreshed.resolve({ data: [], cursor: { previous: null, next: null } })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(store.activeTurn("child")).toBe("msg_current_turn")
    expect(store.turnPhase("child")).toBe("active")
  })

  test("refreshes V2 history when an idle boundary follows missing terminal events", async () => {
    const user = userMessage("msg_1_user")
    const assistant = assistantMessage("msg_2_assistant", user.id)
    const requests: unknown[] = []
    const refreshed = Promise.withResolvers<unknown>()
    const messageApi = {
      list: async (input: unknown) => {
        requests.push(input)
        return refreshed.promise
      },
    } as unknown as MessageApi
    const sessionApi = { get: async () => session("child") } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, messageApi, {
      retry: retryImmediately,
    })
    store.remember(session("child"))
    store.pin("child")
    store.set("session_message", "child", [
      { id: user.id, type: "user", text: "hello", time: user.time },
      {
        id: assistant.id,
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "partial answer" }],
        time: { created: 2 },
      },
    ])

    store.applyV2({
      id: "evt_status_idle",
      type: "session.status",
      location: { directory: "/repo" },
      data: { sessionID: "child", status: { type: "idle" } },
    } as unknown as V2Event)
    store.applyV2({
      id: "evt_idle",
      type: "session.idle",
      location: { directory: "/repo" },
      data: { sessionID: "child" },
    } as unknown as V2Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requests).toEqual([{ sessionID: "child", limit: 20, order: "desc" }])

    refreshed.resolve({
      data: [
        {
          id: assistant.id,
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          content: [{ type: "text", text: "complete canonical answer" }],
          time: assistant.time,
        },
        { id: user.id, type: "user", text: "hello", time: user.time },
      ],
      cursor: { previous: null, next: null },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.data.part[assistant.id]).toEqual([expect.objectContaining({ text: "complete canonical answer" })])
    expect(store.data.session_status.child).toEqual({ type: "idle" })
  })

  test("defers idle reconciliation for an unpinned V2 session until it is revisited", async () => {
    const requests: unknown[] = []
    const messageApi = {
      list: async (input: unknown) => {
        requests.push(input)
        return { data: [], cursor: { previous: null, next: null } }
      },
    } as unknown as MessageApi
    const sessionApi = { get: async () => session("child") } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, messageApi, {
      retry: retryImmediately,
    })
    await store.sync("child")

    expect(store.fresh("child", 15_000)).toBe(true)

    store.applyV2({
      id: "evt_status_idle",
      type: "session.status",
      location: { directory: "/repo" },
      data: { sessionID: "child", status: { type: "idle" } },
    } as unknown as V2Event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requests).toEqual([{ sessionID: "child", limit: 20, order: "desc" }])
    expect(store.fresh("child", 15_000)).toBe(false)
  })

  test("runs idle reconciliation after an older V2 history load finishes", async () => {
    const first = Promise.withResolvers<unknown>()
    const second = Promise.withResolvers<unknown>()
    const requests: unknown[] = []
    const messageApi = {
      list: async (input: unknown) => {
        requests.push(input)
        return requests.length === 1 ? first.promise : second.promise
      },
    } as unknown as MessageApi
    const sessionApi = { get: async () => session("child") } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, messageApi, {
      retry: retryImmediately,
    })
    store.pin("child")
    const initial = store.sync("child")
    await new Promise((resolve) => setTimeout(resolve, 0))

    store.applyV2({
      id: "evt_status_idle",
      type: "session.status",
      location: { directory: "/repo" },
      data: { sessionID: "child", status: { type: "idle" } },
    } as unknown as V2Event)
    first.resolve({ data: [], cursor: { previous: null, next: null } })
    await initial
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(requests).toEqual([
      { sessionID: "child", limit: 20, order: "desc" },
      { sessionID: "child", limit: 20, order: "desc" },
    ])

    second.resolve({ data: [], cursor: { previous: null, next: null } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test("projects current move, retry, provider attempt, and revert state", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    const apply = (input: object) => ctx.store.applyV2(input as V2Event)
    const current = { id: "evt_current", metadata: {}, location: { directory: "/repo" } }

    apply({
      ...current,
      type: "session.next.moved",
      data: {
        timestamp: 2,
        sessionID: "child",
        location: { directory: "/next", workspaceID: "workspace" },
        subdirectory: "nested",
      },
    })
    expect(ctx.store.get("child")).toMatchObject({
      directory: "/next",
      workspaceID: "workspace",
      path: "nested",
      time: { updated: 2 },
    })

    apply({
      ...current,
      type: "session.next.retried",
      data: {
        timestamp: 3,
        sessionID: "child",
        attemptID: "evt_attempt_1",
        attempt: 2,
        next: 10,
        error: { message: "retry", isRetryable: true },
      },
    })
    expect(ctx.store.data.session_status.child).toEqual({
      type: "retry",
      attempt: 2,
      message: "retry",
      next: 10,
    })

    apply({
      ...current,
      type: "session.next.provider.attempt.started",
      data: {
        timestamp: 10,
        sessionID: "child",
        attemptID: "evt_attempt_2",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        retryOf: "evt_attempt_1",
      },
    })
    expect(ctx.store.data.session_status.child).toEqual({ type: "busy" })

    apply({
      ...current,
      type: "session.next.revert.staged",
      data: {
        timestamp: 11,
        sessionID: "child",
        revert: { messageID: "msg_user", snapshot: "snapshot", diff: "diff" },
      },
    })
    expect(ctx.store.get("child")?.revert).toEqual({
      messageID: "msg_user",
      partID: undefined,
      snapshot: "snapshot",
      diff: "diff",
    })

    apply({
      ...current,
      type: "session.next.revert.cleared",
      data: { timestamp: 12, sessionID: "child" },
    })
    expect(ctx.store.get("child")?.revert).toBeUndefined()
  })

  test("resolves lineage by session ID without directory", async () => {
    const ctx = setup({ child: session("child", "root"), root: session("root") })

    const result = await ctx.store.lineage.resolve("child")

    expect(result.root.id).toBe("root")
    expect(ctx.get).toEqual([{ sessionID: "child" }, { sessionID: "root" }])
    expect(ctx.store.lineage.peek("child")).toEqual(result)
  })

  test("loads session content through the server client", async () => {
    const ctx = setup({ root: session("root") })

    await ctx.store.sync("root")

    expect(ctx.get).toEqual([{ sessionID: "root" }])
    expect(ctx.messages).toEqual([{ sessionID: "root", limit: 20, before: undefined }])
    expect(ctx.store.data.message.root).toEqual([])
  })

  test("loads current session content through the current message API", async () => {
    const requests: unknown[] = []
    const user = { id: "msg_z_user", type: "user", text: "hello", time: { created: 1 } }
    const assistant = {
      id: "msg_a_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [{ type: "text", text: "hi" }],
      time: { created: 2, completed: 3 },
    }
    const client = {
      session: {
        messages: () => {
          throw new Error("legacy message endpoint called")
        },
      },
    } as unknown as OpencodeClient
    const messageApi = {
      list: async (input: unknown) => {
        requests.push(input)
        return { data: [assistant, user], cursor: { previous: null, next: null } }
      },
    } as unknown as MessageApi
    const store = createServerSession(client, {} as SessionApi, messageApi)
    store.remember(session("root"))

    await store.sync("root")

    expect(requests).toEqual([{ sessionID: "root", limit: 20, order: "desc" }])
    expect(store.data.session_message.root.map((message) => message.id)).toEqual([user.id, assistant.id])
  })

  test("keeps a V2 history read on its selected API generation", async () => {
    let protocol: "v1" | "v2" = "v2"
    const readProtocol = (): "v1" | "v2" => protocol
    const resolveProtocol = (): Promise<"v1" | "v2"> => Promise.resolve(readProtocol())
    const api = createV2OnlyApi({
      protocol: resolveProtocol,
      current: {
        session: {
          get: async () => session("root"),
        },
        message: {
          list: async () => {
            protocol = "v1"
            return { data: [], cursor: { previous: null, next: null } }
          },
        },
      } as unknown as ServerApi,
    })
    const store = createServerSession({} as OpencodeClient, api.session, api.message, {
      apiForGeneration: () =>
        resolveProtocol().then((value) => {
          if (value !== "v2") throw new Error("V2 server protocol unavailable")
          return api
        }),
    })
    store.remember(session("root"))

    await store.sync("root")

    expect(store.data.message.root).toEqual([])
    expect(readProtocol()).toBe("v1")
  })

  test("caps refresh page size when the cached history is larger than one API page", async () => {
    const requests: Array<{ limit?: number }> = []
    const messages = Array.from({ length: 509 }, (_, index) => ({
      id: `msg_${index}`,
      type: "user" as const,
      text: `message ${index}`,
      time: { created: index },
    }))
    const messageApi = {
      list: async (input: { limit?: number }) => {
        requests.push(input)
        return { data: messages, cursor: { previous: null, next: null } }
      },
    } as unknown as MessageApi
    const sessionApi = { get: async () => session("root") } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, messageApi)
    store.remember(session("root"))

    await store.sync("root")
    await store.sync("root", { force: true })

    expect(requests.map((request) => request.limit)).toEqual([20, 200])
  })

  test("extends a current page to include the user for split assistant turns", async () => {
    const user = { id: "msg_1_user", type: "user", text: "hello", time: { created: 1 } } as const
    const assistant = (id: string, created: number) => ({
      id,
      type: "assistant" as const,
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [{ type: "text" as const, text: id }],
      time: { created, completed: created },
    })
    const assistants = [
      assistant("msg_2_assistant", 2),
      assistant("msg_3_assistant", 3),
      assistant("msg_4_assistant", 4),
    ]
    const pages = [
      { data: assistants.slice(1).toReversed(), cursor: { previous: null, next: "older" } },
      { data: [assistants[0], user], cursor: { previous: null, next: null } },
    ]
    const requests: unknown[] = []
    const messageApi = {
      list: async (input: unknown) => {
        requests.push(input)
        return pages.shift()!
      },
    } as unknown as MessageApi
    const store = createServerSession({} as OpencodeClient, {} as SessionApi, messageApi)
    store.remember(session("root"))

    await store.sync("root")

    expect(requests).toEqual([
      { sessionID: "root", limit: 20, order: "desc" },
      { sessionID: "root", limit: 20, cursor: "older" },
    ])
    expect(store.data.message.root.map((message) => message.id)).toEqual([
      user.id,
      ...assistants.map((item) => item.id),
    ])
    expect(assistants.map((item) => store.data.part[item.id]?.[0]?.type)).toEqual(["text", "text", "text"])
  })

  test("indexes projected messages for the current timeline", async () => {
    const user = userMessage("message-1", { sessionID: "root" })
    const assistant = assistantMessage("message-2", user.id, { sessionID: "root" })
    const client = messageClient(
      response([
        { info: user, parts: [textPart(user.id, { sessionID: "root" })] },
        { info: assistant, parts: [textPart(assistant.id, { sessionID: "root" })] },
      ]),
    )
    const store = createServerSession(client)
    store.remember(session("root"))

    await store.sync("root")

    expect(store.data.message.root.map((message) => message.id)).toEqual([user.id, assistant.id])
    expect(store.data.session_message.root).toEqual([
      expect.objectContaining({ id: user.id, type: "user", text: "text" }),
      expect.objectContaining({ id: assistant.id, type: "assistant" }),
    ])

    const next = userMessage("message-3", { sessionID: "root" })
    store.apply({ type: "message.updated", properties: { info: next } })
    expect(store.data.session_message.root.map((message) => message.id)).toEqual([user.id, assistant.id, next.id])

    store.apply({ type: "message.removed", properties: { sessionID: "root", messageID: next.id } })
    expect(store.data.session_message.root.map((message) => message.id)).toEqual([user.id, assistant.id])
  })

  test("backfills an assistant-only initial page through its user root", async () => {
    const user = userMessage("message-1")
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [singleResponse(user)],
    )
    const store = createServerSession(client)

    await store.sync("child")

    expect(client.requests).toEqual([{ sessionID: "child", limit: 20, before: undefined }])
    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: user.id }])
    expect(store.data.message.child).toEqual([user, ...assistants])
    expect(store.history.more("child")).toBe(true)
  })

  test("keeps assistant history when its deleted parent cannot be backfilled", async () => {
    const missing = Promise.withResolvers<SingleMessageResponse>()
    const assistant = assistantMessage("message-2", "message-missing")
    const client = rootMessageClient([response([{ info: assistant, parts: [] }], "older")], [missing.promise])
    const store = createServerSession(client)
    const loading = store.sync("child")
    await client.rootRequested(1)

    missing.reject(new Error("Message not found: message-missing", { cause: { status: 404 } }))
    await loading

    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: "message-missing" }])
    expect(store.data.message.child).toEqual([assistant])
    expect(store.history.more("child")).toBe(true)
  })

  test("drops a cached parent when a forced refresh confirms it was deleted", async () => {
    const missing = Promise.withResolvers<SingleMessageResponse>()
    const parent = userMessage("message-1")
    const part = textPart(parent.id)
    const assistant = assistantMessage("message-2", parent.id)
    const client = rootMessageClient(
      [
        response([
          { info: parent, parts: [part] },
          { info: assistant, parts: [] },
        ]),
        response([{ info: assistant, parts: [] }], "older"),
      ],
      [missing.promise],
    )
    const store = createServerSession(client)
    await store.sync("child")
    const loading = store.sync("child", { force: true })
    await client.rootRequested(1)

    missing.reject(new Error(`Message not found: ${parent.id}`, { cause: { status: 404 } }))
    await loading

    expect(store.data.message.child).toEqual([assistant])
    expect(store.data.part[parent.id]).toBeUndefined()
  })

  test("does not let an optimistic user suppress initial root backfill", async () => {
    const user = userMessage("message-1")
    const part = textPart(user.id)
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [singleResponse(user)],
    )
    const store = createServerSession(client)
    store.optimistic.add({ sessionID: "child", message: user, parts: [part] })

    await store.sync("child")
    store.optimistic.remove({ sessionID: "child", messageID: user.id })

    expect(client.requests).toHaveLength(1)
    expect(client.rootRequests).toHaveLength(1)
    expect(store.data.message.child).toEqual([user, ...assistants])
  })

  test("backfills the parent of fetched assistants when another user is cached", async () => {
    const unrelated = userMessage("message-0", { time: { created: 0 } })
    const user = userMessage("message-1")
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response([{ info: unrelated, parts: [] }]),
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [singleResponse(user)],
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.requests).toHaveLength(2)
    expect(client.rootRequests).toHaveLength(1)
    expect(store.data.message.child).toEqual([unrelated, user, ...assistants])
  })

  test("preserves cached history between an injected parent and the page boundary", async () => {
    const user = userMessage("message-1")
    const cached = userMessage("message-3", { time: { created: 3 } })
    const assistant = assistantMessage("message-4", user.id)
    const client = rootMessageClient(
      [response([{ info: cached, parts: [] }]), response([{ info: assistant, parts: [] }], "older")],
      [singleResponse(user)],
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([user, cached, assistant])
  })

  test("refreshes a cached parent omitted by an assistant-only replacement page", async () => {
    const stale = userMessage("message-1", { summary: { title: "stale", diffs: [] } })
    const fresh = { ...stale, summary: { title: "fresh", diffs: [] } }
    const stalePart = textPart(stale.id, { text: "stale" })
    const freshPart = { ...stalePart, text: "fresh" }
    const assistant = assistantMessage("message-2", stale.id)
    const client = rootMessageClient(
      [response([{ info: stale, parts: [stalePart] }]), response([{ info: assistant, parts: [] }], "older")],
      [singleResponse(fresh, [freshPart])],
    )
    const store = createServerSession(client)
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: stale.id }])
    expect(store.data.message.child).toEqual([fresh, assistant])
    expect(store.data.part[stale.id]).toEqual([freshPart])
  })

  test("refreshes a confirmed optimistic parent while preserving pending parts", async () => {
    const stale = userMessage("message-1", { summary: { title: "stale", diffs: [] } })
    const fresh = { ...stale, summary: { title: "fresh", diffs: [] } }
    const confirmed = textPart(stale.id, { id: "confirmed", text: "stale" })
    const refreshed = { ...confirmed, text: "fresh" }
    const pending = textPart(stale.id, { id: "pending", text: "pending" })
    const assistant = assistantMessage("message-2", stale.id)
    const client = rootMessageClient(
      [response([{ info: stale, parts: [confirmed] }]), response([{ info: assistant, parts: [] }], "older")],
      [singleResponse(fresh, [refreshed])],
    )
    const store = createServerSession(client)
    store.optimistic.add({ sessionID: "child", message: stale, parts: [confirmed, pending] })
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(client.rootRequests).toEqual([{ sessionID: "child", messageID: stale.id }])
    expect(store.data.message.child).toEqual([fresh, assistant])
    expect(store.data.part[stale.id]).toEqual([refreshed, pending])
  })

  test("uses a parent received by SSE during the replacement load", async () => {
    const pending = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const client = rootMessageClient([pending.promise], [])
    const store = createServerSession(client)
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: user } })
    pending.resolve(response([{ info: assistant, parts: [] }], "older"))
    await loading

    expect(client.rootRequests).toEqual([])
    expect(store.data.message.child).toEqual([user, assistant])
  })

  test("uses a successful retry over events received by a failed backfill attempt", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const live = { ...user, agent: "stale" }
    const assistants = [assistantMessage("message-2", user.id), assistantMessage("message-3", user.id)]
    const client = rootMessageClient(
      [
        response(
          assistants.map((info) => ({ info, parts: [] })),
          "older",
        ),
      ],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await loading

    expect(client.requests).toHaveLength(1)
    expect(client.rootRequests).toHaveLength(2)
    expect(store.data.message.child).toEqual([user, ...assistants])
  })

  test("preserves newer-page events across a failed parent retry", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const live = { ...assistant, cost: 1 }
    const client = rootMessageClient(
      [response([{ info: assistant, parts: [] }], "older")],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await loading

    expect(store.data.message.child).toEqual([user, live])
  })

  test("preserves unrelated message events across a failed parent retry", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const live = userMessage("message-4", { time: { created: 4 } })
    const client = rootMessageClient(
      [response([{ info: assistant, parts: [] }], "older")],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.updated", properties: { info: live } })
    failed.reject(new Error("retry"))
    await loading

    expect(store.data.message.child).toEqual([user, assistant, live])
  })

  test("preserves newer-page part events across a failed parent retry", async () => {
    const failed = deferredResponse()
    const user = userMessage("message-1")
    const assistant = assistantMessage("message-2", user.id)
    const stale = textPart(assistant.id, { text: "stale" })
    const live = { ...stale, text: "live" }
    const client = rootMessageClient(
      [response([{ info: assistant, parts: [stale] }], "older")],
      [failed.promise.then((result) => ({ data: result.data[0]! })), singleResponse(user)],
    )
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child")
    await client.rootRequested(1)

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    failed.reject(new Error("retry"))
    await loading

    expect(store.data.part[assistant.id]).toEqual([live])
  })

  test("merges live events into the initial page", async () => {
    const pending = deferredResponse()
    const user = userMessage("message-1")
    const live = userMessage("message-2", { time: { created: 2 } })
    const livePart = textPart(live.id, { text: "live" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: livePart, time: 2 } })
    pending.resolve(response([{ info: user, parts: [] }]))
    await loading

    expect(store.data.message.child).toEqual([user, live])
    expect(store.data.part[live.id]).toEqual([livePart])
  })

  test("preserves same-ID live updates over the initial page", async () => {
    const pending = deferredResponse()
    const fetched = userMessage("message")
    const fetchedPart = textPart(fetched.id, { text: "fetched" })
    const live = { ...fetched, time: { created: 2 } }
    const livePart = { ...fetchedPart, text: "live" }
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: livePart, time: 2 } })
    pending.resolve(response([{ info: fetched, parts: [fetchedPart] }]))
    await loading

    expect(store.data.message.child).toEqual([live])
    expect(store.data.part[live.id]).toEqual([livePart])
  })

  test("preserves removals received during the initial load", async () => {
    const pending = deferredResponse()
    const removed = userMessage("message-1")
    const kept = { ...removed, id: "message-2" }
    const part = textPart(kept.id, { text: "removed" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: removed.id } })
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: kept.id, partID: part.id },
    })
    pending.resolve(
      response([
        { info: removed, parts: [] },
        { info: kept, parts: [part] },
      ]),
    )
    await loading

    expect(store.data.message.child).toEqual([kept])
    expect(store.data.part[kept.id]).toBeUndefined()
  })

  test("keeps removal tracking isolated across load generations", async () => {
    const firstResponse = deferredResponse()
    const secondResponse = deferredResponse()
    const message = userMessage("message")
    const store = createServerSession(messageClient(firstResponse.promise, secondResponse.promise))
    const first = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({
      type: "session.deleted",
      properties: { sessionID: "child", info: session("child", "root") },
    })
    const second = store.sync("child")

    firstResponse.resolve(response())
    await first
    secondResponse.resolve(response([{ info: message, parts: [] }]))
    await second

    expect(store.data.message.child).toEqual([message])
  })

  test("tracks removals in a replacement load generation", async () => {
    const firstResponse = deferredResponse()
    const secondResponse = deferredResponse()
    const message = userMessage("message")
    const store = createServerSession(messageClient(firstResponse.promise, secondResponse.promise))
    const first = store.sync("child")
    store.apply({
      type: "session.deleted",
      properties: { sessionID: "child", info: session("child", "root") },
    })
    const second = store.sync("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    firstResponse.resolve(response())
    await first
    secondResponse.resolve(response([{ info: message, parts: [] }]))
    await second

    expect(store.data.message.child).toEqual([])
  })

  test("preserves remove then re-add when a refresh omits the message", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const store = createServerSession(messageClient(response([{ info: message, parts: [] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.updated", properties: { info: message } })
    pending.resolve(response())
    await refreshing

    expect(store.data.message.child).toEqual([message])
  })

  test("preserves a re-added message without restoring removed parts", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: message, parts: [] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.updated", properties: { info: message } })
    pending.resolve(response([{ info: message, parts: [part] }]))
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves optimistic parts re-added after removal during a refresh", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const stale = textPart(message.id, { id: "stale", text: "stale" })
    const part = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [] }]), pending.promise, response()),
    )
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    pending.resolve(response([{ info: message, parts: [stale] }]))
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])

    await store.sync("child", { force: true })
    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("drops stale event content omitted by a complete initial page", async () => {
    const stale = userMessage("stale")
    const store = createServerSession(messageClient(response()))
    store.apply({ type: "message.updated", properties: { info: stale } })

    await store.sync("child")

    expect(store.data.message.child).toEqual([])
  })

  test("preserves event content outside an incomplete initial page", async () => {
    const live = userMessage("message-1")
    const fetched = userMessage("message-2", { time: { created: 2 } })
    const store = createServerSession(messageClient(response([{ info: fetched, parts: [] }], "older")))
    store.apply({ type: "message.updated", properties: { info: live } })

    await store.sync("child")

    expect(store.data.message.child).toEqual([live, fetched])
  })

  test("does not restore removed optimistic content on refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "removed" })
    const kept = { ...message, id: "kept" }
    const keptPart = { ...part, id: "kept-part", messageID: kept.id }
    const store = createServerSession(messageClient(response([{ info: kept, parts: [] }])))
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.optimistic.add({ sessionID: "child", message: kept, parts: [keptPart] })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: kept.id, partID: keptPart.id },
    })
    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([kept])
    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part[kept.id]).toBeUndefined()
  })

  test("replaces confirmed optimistic content with the initial page", async () => {
    const optimistic = userMessage("message")
    const fetched = { ...optimistic, time: { created: 2 } }
    const store = createServerSession(messageClient(response([{ info: fetched, parts: [] }])))
    store.optimistic.add({ sessionID: "child", message: optimistic, parts: [] })

    await store.sync("child")

    expect(store.data.message.child).toEqual([fetched])
  })

  test("replaces a confirmed optimistic part with fetched content", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const optimistic = textPart(message.id, { text: "optimistic" })
    const fetched = { ...optimistic, text: "fetched" }
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })
    pending.resolve(response([{ info: message, parts: [fetched] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([fetched])
  })

  test("rolls back only unconfirmed optimistic parts", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const confirmed = textPart(message.id, { id: "confirmed", text: "confirmed" })
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })

    pending.resolve(response([{ info: message, parts: [confirmed] }]))
    await loading
    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([confirmed])
  })

  test("updates confirmed optimistic parts from later pages", async () => {
    const message = userMessage("message")
    const confirmed = textPart(message.id, { id: "confirmed", text: "first" })
    const updated = { ...confirmed, text: "updated" }
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [confirmed] }]), response([{ info: message, parts: [updated] }])),
    )
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })
    await store.sync("child")

    await store.sync("child", { force: true })
    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.part[message.id]).toEqual([updated])
  })

  test("does not restore a confirmed optimistic part after its removal event", async () => {
    const message = userMessage("message")
    const confirmed = textPart(message.id, { id: "confirmed", text: "confirmed" })
    const pendingPart = textPart(message.id, { id: "pending", text: "pending" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [confirmed] }]), response([{ info: message, parts: [] }])),
    )
    store.optimistic.add({ sessionID: "child", message, parts: [confirmed, pendingPart] })
    await store.sync("child")
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: confirmed.id },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([pendingPart])
  })

  test("clears delta buffers when removing optimistic content", () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "optimistic" })
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("does not remove content confirmed by a message event", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: message } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not remove parts confirmed by part events", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("treats a part event as confirmation when it precedes the message event", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [part] })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    store.optimistic.remove({ sessionID: "child", messageID: message.id })

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([part])
  })

  test("clears stale parts when the initial page has none", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(messageClient(pending.promise))
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 1 } })
    const loading = store.sync("child")

    pending.resolve(response([{ info: message, parts: [] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("clears delta buffers for parts omitted by the initial page", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const kept = textPart(message.id, { id: "part-1", text: "kept" })
    const removed: Part = { ...kept, id: "part-2", text: "removed" }
    const store = createServerSession(messageClient(pending.promise))
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: kept, time: 1 } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: removed, time: 1 } })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: removed.id, field: "text", delta: " delta" },
    })
    const loading = store.sync("child")

    pending.resolve(response([{ info: message, parts: [kept] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([kept])
    expect(store.data.part_text_accum_delta[removed.id]).toBeUndefined()
  })

  test("clears a stale delta buffer when a refresh replaces its part", async () => {
    const message = userMessage("message")
    const stale = textPart(message.id, { text: "stale" })
    const fetched = { ...stale, text: "fetched" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [stale] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: stale.id, field: "text", delta: " delta" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[stale.id]).toBeUndefined()
  })

  test("preserves a non-durable delta received before refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [{ ...part }] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "stale delta" }])
    expect(store.data.part_text_accum_delta[part.id]).toBe("stale delta")
  })

  test("accepts fetched text that intentionally replaces an accumulated prefix", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "abc" })
    const fetched = { ...part, text: "ab" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "def" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("preserves an unpersisted delta suffix after partial server catch-up", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "a" })
    const fetched = { ...part, text: "ab" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "bc" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "abc" }])
    expect(store.data.part_text_accum_delta[part.id]).toBe("abc")
  })

  test("clears delta state after exact server catch-up", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "a" })
    const fetched = { ...part, text: "ab" }
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [fetched] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: "b" },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toEqual([fetched])
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("uses the successful retry response over events from a failed attempt", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const stale = textPart(message.id, { text: "stale" })
    const intermediate = { ...stale, text: "intermediate" }
    const fetched = { ...stale, text: "fetched" }
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: stale, time: 1 } })
    const loading = store.sync("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: intermediate, time: 2 } })
    failed.reject(new Error("failed to fetch"))
    await client.requested(2)
    retried.resolve(response([{ info: message, parts: [fetched] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([fetched])
  })

  test("preserves non-durable deltas across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const client = messageClient(failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 1 } })
    const loading = store.sync("child")

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(2)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.part[message.id]).toEqual([{ ...part, text: "stale delta" }])
  })

  test("preserves part removals across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: part.id },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves message removals across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves optimistic re-adds across message retries", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const stale = textPart(message.id, { id: "stale", text: "stale" })
    const optimistic = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const client = messageClient(response([{ info: message, parts: [stale] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [stale] }]))
    await loading

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([optimistic])
  })

  test("accepts part omission from a successful retry after an earlier delta", async () => {
    const failed = Promise.withResolvers<MessageResponse>()
    const retried = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(response([{ info: message, parts: [part] }]), failed.promise, retried.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    await store.sync("child")
    const loading = store.sync("child", { force: true })

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    failed.reject(new Error("failed to fetch"))
    await client.requested(3)
    retried.resolve(response([{ info: message, parts: [] }]))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("clears load-owned orphan parts when all retries fail", async () => {
    const first = Promise.withResolvers<MessageResponse>()
    const second = Promise.withResolvers<MessageResponse>()
    const third = Promise.withResolvers<MessageResponse>()
    const message = userMessage("message")
    const part = textPart(message.id)
    const client = messageClient(first.promise, second.promise, third.promise)
    const store = createServerSession(client, { retry: retryImmediately })
    const loading = store.sync("child").catch((error) => error)

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    first.reject(new Error("failed to fetch"))
    await client.requested(2)
    second.reject(new Error("failed to fetch"))
    await client.requested(3)
    third.reject(new Error("failed to fetch"))
    await loading

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("preserves live updates during a forced refresh", async () => {
    const pending = deferredResponse()
    const stale = userMessage("message")
    const stalePart = textPart(stale.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: stale, parts: [stalePart] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })
    const live = { ...stale, time: { created: 2 } }

    store.apply({ type: "message.updated", properties: { info: live } })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: stale.id, partID: stalePart.id, field: "text", delta: " live" },
    })
    pending.resolve(response([{ info: stale, parts: [stalePart] }]))
    await refreshing

    expect(store.data.message.child).toEqual([live])
    expect(store.data.part[stale.id]).toEqual([{ ...stalePart, text: "stale live" }])
  })

  test("keeps fetched message metadata when only a part changes", async () => {
    const pending = deferredResponse()
    const stale = userMessage("message")
    const fetched = { ...stale, time: { created: 2 } }
    const part = textPart(stale.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: stale, parts: [part] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: stale.id, partID: part.id, field: "text", delta: " live" },
    })
    pending.resolve(response([{ info: fetched, parts: [part] }]))
    await refreshing

    expect(store.data.message.child).toEqual([fetched])
    expect(store.data.part[stale.id]).toEqual([{ ...part, text: "stale live" }])
  })

  test("preserves a part update when a forced refresh omits its message", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const stale = textPart(message.id, { text: "stale" })
    const live = { ...stale, text: "live" }
    const store = createServerSession(messageClient(response([{ info: message, parts: [stale] }]), pending.promise))
    await store.sync("child")
    const refreshing = store.sync("child", { force: true })

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    pending.resolve(response())
    await refreshing

    expect(store.data.message.child).toEqual([message])
    expect(store.data.part[message.id]).toEqual([live])
  })

  test("ignores a late part update after its message is removed", async () => {
    const pending = deferredResponse()
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = createServerSession(messageClient(pending.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })
    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    pending.resolve(response([{ info: message, parts: [part] }]))
    await loading

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("ignores a late part update after a completed message removal", () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = setup({ child: session("child") }).store
    store.apply({ type: "message.updated", properties: { info: message } })
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not restore a completed message removal from a stale refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [part] }])),
    )
    await store.sync("child")
    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: message.id } })

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not restore a completed part removal from a stale refresh", async () => {
    const message = userMessage("message")
    const part = textPart(message.id)
    const store = createServerSession(
      messageClient(response([{ info: message, parts: [part] }]), response([{ info: message, parts: [part] }])),
    )
    await store.sync("child")
    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: message.id, partID: part.id },
    })

    await store.sync("child", { force: true })

    expect(store.data.part[message.id]).toBeUndefined()
  })

  test("does not cache skipped optimistic parts", () => {
    const message = userMessage("message")
    const part = { id: "part", sessionID: "child", messageID: message.id, type: "step-start" as const }
    const store = setup({ child: session("child") }).store

    store.optimistic.add({ sessionID: "child", message, parts: [part] })

    expect(store.data.part[message.id]).toEqual([])
  })

  test("preserves optimistic mixed part input order", () => {
    const message = userMessage("message")
    const before = textPart(message.id, { id: "part-z", text: "before" })
    const file: Part = {
      id: "part-a",
      sessionID: "child",
      messageID: message.id,
      type: "file",
      mime: "text/plain",
      filename: "context.txt",
      url: "data:text/plain,context",
    }
    const after = textPart(message.id, { id: "part-m", text: "after" })
    const store = setup({ child: session("child") }).store

    store.optimistic.add({ sessionID: "child", message, parts: [before, file, after] })

    expect(store.data.part[message.id]?.map((part) => part.id)).toEqual(["part-z", "part-a", "part-m"])
  })

  test("clears stale delta buffers when replacing optimistic parts", () => {
    const message = userMessage("message")
    const stale = textPart(message.id, { id: "stale", text: "stale" })
    const optimistic = textPart(message.id, { id: "optimistic", text: "optimistic" })
    const store = setup({ child: session("child") }).store
    store.optimistic.add({ sessionID: "child", message, parts: [stale] })
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: stale.id, field: "text", delta: " delta" },
    })

    store.optimistic.add({ sessionID: "child", message, parts: [optimistic] })

    expect(store.data.part_text_accum_delta[stale.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[optimistic.id]).toBeUndefined()
  })

  test("preserves removals during history prepend", async () => {
    const pending = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = { ...latest, id: "message-1", time: { created: 1 } }
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.removed", properties: { sessionID: "child", messageID: older.id } })
    pending.resolve(response([{ info: older, parts: [] }]))
    await loading

    expect(store.data.message.child).toEqual([latest])
  })

  test("does not scan cached messages for user roots during history prepend", async () => {
    const guard = { active: false }
    const latest = new Proxy(userMessage("message-2", { time: { created: 2 } }), {
      get(target, property, receiver) {
        if (guard.active && property === "role") throw new Error("cached role accessed")
        return Reflect.get(target, property, receiver)
      },
    })
    const older = userMessage("message-1")
    const store = createServerSession(
      messageClient(response([{ info: latest, parts: [] }], "older"), response([{ info: older, parts: [] }])),
    )
    await store.sync("child")
    guard.active = true

    await store.history.loadMore("child")

    guard.active = false
    expect(store.data.message.child).toEqual([older, latest])
  })

  test("preserves loaded history during an incomplete refresh", async () => {
    const older = userMessage("message-1")
    const latest = userMessage("message-2", { time: { created: 2 } })
    const fresh = userMessage("message-3", { time: { created: 3 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: older, parts: [] },
            { info: latest, parts: [] },
          ],
          "older",
        ),
        response(
          [
            { info: latest, parts: [] },
            { info: fresh, parts: [] },
          ],
          "older",
        ),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([older, latest, fresh])
  })

  test("drops stale recent messages omitted by an incomplete refresh", async () => {
    const third = userMessage("message-3", { time: { created: 3 } })
    const fourth = userMessage("message-4", { time: { created: 4 } })
    const stale = userMessage("message-5", { time: { created: 5 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: fourth, parts: [] },
            { info: stale, parts: [] },
          ],
          "older",
        ),
        response(
          [
            { info: third, parts: [] },
            { info: fourth, parts: [] },
          ],
          "older",
        ),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([third, fourth])
  })

  test("uses message creation time for incomplete refresh boundaries", async () => {
    const older = userMessage("msg_z", { time: { created: 1 } })
    const boundary = userMessage("msg_m", { time: { created: 2 } })
    const stale = userMessage("msg_a", { time: { created: 3 } })
    const store = createServerSession(
      messageClient(
        response(
          [
            { info: older, parts: [] },
            { info: stale, parts: [] },
          ],
          "older",
        ),
        response([{ info: boundary, parts: [] }], "older"),
      ),
    )
    await store.sync("child")

    await store.sync("child", { force: true })

    // The preserved older message precedes the fetched boundary in creation time.
    expect(store.data.message.child).toEqual([older, boundary])
  })

  test("preserves a part update for a message being loaded from history", async () => {
    const pending = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const stale = textPart(older.id, { text: "stale" })
    const live = { ...stale, text: "live" }
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part: live, time: 2 } })
    pending.resolve(response([{ info: older, parts: [stale] }]))
    await loading

    expect(store.data.part[older.id]).toEqual([live])
  })

  test("does not clear newer orphan parts after terminal history prepend", async () => {
    const pending = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const newer = userMessage("message-3", { time: { created: 3 } })
    const part = textPart(newer.id, { text: "live" })
    const store = createServerSession(messageClient(response([{ info: latest, parts: [] }], "older"), pending.promise))
    await store.sync("child")
    const loading = store.history.loadMore("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 3 } })
    pending.resolve(response([{ info: older, parts: [] }]))
    await loading
    store.apply({ type: "message.updated", properties: { sessionID: "child", info: newer } })

    expect(store.data.part[newer.id]).toEqual([part])
  })

  test("accepts an authoritative history part after an earlier unknown-parent update", async () => {
    const pending = deferredResponse()
    const history = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const part = textPart(older.id, { text: "live" })
    const store = createServerSession(messageClient(pending.promise, history.promise))
    const loading = store.sync("child")

    store.apply({ type: "message.part.updated", properties: { sessionID: "child", part, time: 2 } })
    pending.resolve(response([{ info: latest, parts: [] }], "older"))
    await loading

    expect(store.data.part[older.id]).toEqual([part])

    const loadingHistory = store.history.loadMore("child")
    history.resolve(response([{ info: older, parts: [{ ...part, text: "stale" }] }]))
    await loadingHistory

    expect(store.data.part[older.id]).toEqual([{ ...part, text: "stale" }])
  })

  test("preserves an unknown-parent part removal across pages", async () => {
    const initial = deferredResponse()
    const history = deferredResponse()
    const latest = userMessage("message-2", { time: { created: 2 } })
    const older = userMessage("message-1")
    const part = textPart(older.id)
    const store = createServerSession(messageClient(initial.promise, history.promise))
    const loading = store.sync("child")

    store.apply({
      type: "message.part.removed",
      properties: { sessionID: "child", messageID: older.id, partID: part.id },
    })
    initial.resolve(response([{ info: latest, parts: [] }], "older"))
    await loading
    const loadingHistory = store.history.loadMore("child")
    history.resolve(response([{ info: older, parts: [part] }]))
    await loadingHistory

    expect(store.data.part[older.id]).toBeUndefined()
  })

  test("clears orphaned parts when a refresh drops a message", async () => {
    const message = userMessage("message")
    const part = textPart(message.id, { text: "stale" })
    const store = createServerSession(messageClient(response([{ info: message, parts: [part] }]), response()))
    await store.sync("child")
    store.apply({
      type: "message.part.delta",
      properties: { sessionID: "child", messageID: message.id, partID: part.id, field: "text", delta: " delta" },
    })
    await store.sync("child", { force: true })

    expect(store.data.message.child).toEqual([])
    expect(store.data.part[message.id]).toBeUndefined()
    expect(store.data.part_text_accum_delta[part.id]).toBeUndefined()
  })

  test("applies events without a directory store", () => {
    const ctx = setup({})
    ctx.store.apply({ type: "session.created", properties: { sessionID: "root", info: session("root") } })
    ctx.store.apply({ type: "session.status", properties: { sessionID: "root", status: { type: "busy" } } })

    expect(ctx.store.get("root")?.directory).toBe("/repo")
    expect(ctx.store.data.session_working("root")).toBe(true)
    expect(ctx.get).toEqual([])
  })

  test("clears a busy session when the idle lifecycle event arrives", () => {
    const ctx = setup({})
    ctx.store.remember(session("root"))
    ctx.store.set("session_status", "root", { type: "busy" })

    ctx.store.applyV2({
      id: "evt_idle",
      created: 2,
      type: "session.idle",
      data: { sessionID: "root" },
    } as V2Event)

    expect(ctx.store.data.session_status.root).toEqual({ type: "idle" })
    expect(ctx.store.data.session_working("root")).toBe(false)
  })

  test("loads and deduplicates the V2 context projection", async () => {
    const requests: unknown[] = []
    const client = {
      session: {
        get: async () => ({ data: session("child") }),
      },
    } as unknown as OpencodeClient
    const sessionApi = {
      context: async (input: unknown) => {
        requests.push(input)
        return [
          {
            id: "assistant",
            type: "assistant" as const,
            time: { created: 2, completed: 3 },
            agent: "build",
            model: { providerID: "provider", id: "model" },
            content: [],
            tokens: {
              input: 10,
              output: 2,
              reasoning: 1,
              cache: { read: 0, write: 0 },
            },
          },
        ]
      },
    } as unknown as SessionApi
    const messageApi = {} as MessageApi
    const store = createServerSession(client, sessionApi, messageApi, {
      retry: retryImmediately,
    })

    await Promise.all([store.context.refresh("child"), store.context.refresh("child")])

    expect(requests).toEqual([{ sessionID: "child" }])
    expect(store.context.get("child")).toEqual([expect.objectContaining({ id: "assistant", type: "assistant" })])
  })

  test("refreshes V2 context only at stable compaction boundaries", async () => {
    const requests: string[] = []
    const client = {} as unknown as OpencodeClient
    const sessionApi = {
      context: async (input: { sessionID: string }) => {
        requests.push(input.sessionID)
        return []
      },
    } as unknown as SessionApi
    const store = createServerSession(client, sessionApi, {} as MessageApi, {
      retry: retryImmediately,
    })
    const current = { id: "evt_compaction", metadata: {}, location: { directory: "/repo" } }
    const apply = (type: string, data: object) => store.applyV2({ ...current, type, data } as unknown as V2Event)
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    apply("session.next.compaction.started", {
      timestamp: 1,
      sessionID: "child",
      messageID: "msg_compaction",
      reason: "manual",
    })
    await flush()
    expect(requests).toEqual([])

    apply("session.next.compaction.ended", {
      timestamp: 2,
      sessionID: "child",
      messageID: "msg_compaction",
      reason: "manual",
      text: "summary",
      recent: "recent",
    })
    await flush()
    expect(requests).toEqual(["child"])

    apply("session.next.compaction.failed", {
      timestamp: 3,
      sessionID: "child",
      messageID: "msg_compaction_2",
      reason: "auto",
      error: { type: "unknown", message: "failed" },
    })
    await flush()
    expect(requests).toEqual(["child", "child"])

    apply("session.idle", { sessionID: "child" })
    await flush()
    expect(requests).toEqual(["child", "child", "child"])
  })

  test("keeps compaction busy until the terminal status event", () => {
    const ctx = setup({})
    ctx.store.remember(session("child"))

    const status = (value: "busy" | "idle") =>
      ctx.store.apply({ type: "session.status", properties: { sessionID: "child", status: { type: value } } })
    const marker = (type: string) => ctx.store.apply({ type, properties: { sessionID: "child" } })

    status("busy")
    marker("session.next.compaction.started")
    marker("session.next.compaction.ended")
    expect(ctx.store.data.session_status.child).toEqual({ type: "busy" })
    expect(ctx.store.data.session_working("child")).toBe(true)

    status("idle")
    marker("session.idle")
    expect(ctx.store.data.session_status.child).toEqual({ type: "idle" })
    expect(ctx.store.data.session_working("child")).toBe(false)

    status("busy")
    marker("session.next.compaction.started")
    marker("session.next.compaction.failed")
    status("idle")
    expect(ctx.store.data.session_status.child).toEqual({ type: "idle" })
  })

  test("loads the canonical V2 todo projection instead of returning an empty placeholder", async () => {
    const todos = [{ content: "finish migration", status: "pending", priority: "high" }] as Todo[]
    const currentSession = {
      todo: async (input: { sessionID: string }) => {
        expect(input).toEqual({ sessionID: "child" })
        return todos
      },
    } as Pick<ServerApi["session"], "todo">
    const store = createServerSession({} as OpencodeClient, {} as SessionApi, {} as MessageApi, {
      retry: retryImmediately,
      currentSession,
    })

    await store.todo("child")

    expect(store.data.todo.child).toEqual(todos)
  })

  test("loads todo through the selected API generation", async () => {
    const todos = [{ content: "finish migration", status: "pending", priority: "high" }] as Todo[]
    const api = {
      session: {
        todo: async () => todos,
      },
    } as unknown as CompatibleApi
    const store = createServerSession(undefined, {
      api,
      retry: retryImmediately,
    })

    await store.todo("child")

    expect(store.data.todo.child).toEqual(todos)
  })

  test("preserves pinned session content under server-wide cache pressure", () => {
    const ctx = setup({})
    ctx.store.pin("active")
    ctx.store.optimistic.add({
      sessionID: "active",
      message: {
        id: "message",
        sessionID: "active",
        role: "assistant",
        time: { created: 1 },
        parentID: "parent",
        modelID: "model",
        providerID: "provider",
        mode: "build",
        agent: "agent",
        path: { cwd: "/repo", root: "/repo" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts: [],
    })

    for (let index = 0; index < 50; index++) {
      ctx.store.remember(session(`session-${index}`))
      ctx.store.apply({
        type: "session.status",
        properties: { sessionID: `session-${index}`, status: { type: "idle" } },
      })
    }

    expect(ctx.store.data.message.active?.map((message) => message.id)).toEqual(["message"])
    expect(ctx.store.data.session_status["session-0"]).toBeUndefined()
  })

  test("does not apply a late V2 message hydration after session eviction", async () => {
    const pending = Promise.withResolvers<Message>()
    const sessionApi = {
      message: async () => pending.promise,
    } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, {} as MessageApi, {
      retry: retryImmediately,
    })

    store.applyV2({
      id: "evt_imported",
      created: 1,
      type: "session.next.message.imported",
      metadata: {},
      location: { directory: "/repo" },
      data: {
        timestamp: 1,
        sessionID: "child",
        message: { id: "msg_imported", type: "user", text: "imported", time: { created: 1 } },
      },
    } as unknown as V2Event)
    store.evict("child")

    pending.resolve({ id: "msg_imported", type: "user", text: "imported", time: { created: 1 } } as unknown as Message)
    await Promise.resolve()
    await Promise.resolve()

    expect(store.data.session_message.child).toBeUndefined()
  })

  test("deduplicates V2 hydration and replays events received while the message is loading", async () => {
    const pending = Promise.withResolvers<SessionMessageInfo>()
    const requests: unknown[] = []
    const sessionApi = {
      message: async (input: unknown) => {
        requests.push(input)
        return pending.promise
      },
    } as unknown as SessionApi
    const store = createServerSession({} as OpencodeClient, sessionApi, {} as MessageApi)
    const current = { metadata: {}, location: { directory: "/repo" } }
    const apply = (type: string, data: object) =>
      store.applyV2({ ...current, id: `evt_${requests.length}_${type}`, type, data } as unknown as V2Event)

    apply("session.next.tool.input.started", {
      timestamp: 2,
      sessionID: "child",
      assistantMessageID: "msg_assistant",
      callID: "call_1",
      name: "bash",
    })
    await Promise.resolve()
    apply("session.next.tool.input.delta", {
      timestamp: 3,
      sessionID: "child",
      assistantMessageID: "msg_assistant",
      callID: "call_1",
      delta: '{"command":"pwd"}',
    })
    apply("session.next.tool.called", {
      timestamp: 4,
      sessionID: "child",
      assistantMessageID: "msg_assistant",
      callID: "call_1",
      tool: "bash",
      input: { command: "pwd" },
      provider: { executed: false },
    })
    apply("session.next.tool.success", {
      timestamp: 5,
      sessionID: "child",
      assistantMessageID: "msg_assistant",
      callID: "call_1",
      structured: { exit: 0 },
      content: [{ type: "text", text: "D:/repo" }],
      provider: { executed: false },
    })

    expect(requests).toEqual([{ sessionID: "child", messageID: "msg_assistant" }])

    pending.resolve({
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [],
      time: { created: 1 },
    } as SessionMessageInfo)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(requests).toHaveLength(1)
    expect(store.data.session_message.child).toEqual([
      expect.objectContaining({
        id: "msg_assistant",
        type: "assistant",
        content: [
          expect.objectContaining({
            type: "tool",
            id: "call_1",
            state: expect.objectContaining({ status: "completed", input: { command: "pwd" } }),
          }),
        ],
      }),
    ])
  })

  test("projects session.next.created into the session store", () => {
    const ctx = setup({})
    ctx.store.applyV2({
      id: "evt_created",
      type: "session.next.created",
      data: { timestamp: 1, sessionID: "child", info: snapshot() },
    } as unknown as V2Event)
    expect(ctx.store.data.info.child?.title).toBe("Title")
    expect(ctx.store.data.info.child?.directory).toBe("/repo")
    expect(ctx.store.data.info.child?.slug).toBe("slug")
  })

  test("projects session.next.updated and evicts archived sessions", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.applyV2({
      id: "evt_updated",
      type: "session.next.updated",
      data: { timestamp: 2, sessionID: "child", info: snapshot({ title: "New Title" }) },
    } as unknown as V2Event)
    expect(ctx.store.data.info.child?.title).toBe("New Title")

    ctx.store.applyV2({
      id: "evt_archived",
      type: "session.next.updated",
      data: { timestamp: 3, sessionID: "child", info: snapshot({ time: { created: 1, updated: 3, archived: 3 } }) },
    } as unknown as V2Event)
    expect(ctx.store.data.info.child).toBeUndefined()
  })

  test("does not let the legacy apply resolve re-add evicted V2 lifecycle sessions", async () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.applyV2({
      id: "evt_archived",
      type: "session.next.updated",
      data: { timestamp: 3, sessionID: "child", info: snapshot({ time: { created: 1, updated: 3, archived: 3 } }) },
    } as unknown as V2Event)
    expect(ctx.store.data.info.child).toBeUndefined()

    // The adapted V2 event also flows through the legacy apply() path, whose
    // resolve() would re-fetch and remember the evicted session from the server.
    ctx.store.apply({ type: "session.next.updated", properties: { sessionID: "child", info: session("child") } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ctx.store.data.info.child).toBeUndefined()
  })

  test("removes deleted sessions from the store", () => {
    const ctx = setup({ child: session("child") })
    ctx.store.remember(session("child"))
    ctx.store.applyV2({
      id: "evt_deleted",
      type: "session.next.deleted",
      data: { timestamp: 2, sessionID: "child", info: snapshot() },
    } as unknown as V2Event)
    expect(ctx.store.data.info.child).toBeUndefined()
  })

  test("maps session.next.status busy and retry shapes", () => {
    const ctx = setup({})
    ctx.store.remember(session("root"))
    ctx.store.applyV2({
      id: "evt_busy",
      type: "session.next.status",
      data: { timestamp: 1, sessionID: "root", status: { type: "busy" } },
    } as unknown as V2Event)
    expect(ctx.store.data.session_status.root).toEqual({ type: "busy" })

    ctx.store.applyV2({
      id: "evt_retry",
      type: "session.next.status",
      data: { timestamp: 2, sessionID: "root", status: { type: "retry", attempt: 2, message: "quota", next: 3 } },
    } as unknown as V2Event)
    expect(ctx.store.data.session_status.root).toEqual({ type: "retry", attempt: 2, message: "quota", next: 3 })
  })

  test("refreshes context only when session.next.status goes idle", async () => {
    const requests: string[] = []
    const client = {} as unknown as OpencodeClient
    const sessionApi = {
      context: async (input: { sessionID: string }) => {
        requests.push(input.sessionID)
        return []
      },
    } as unknown as SessionApi
    const store = createServerSession(client, sessionApi, {} as MessageApi, {
      retry: retryImmediately,
    })
    const current = { id: "evt_status", metadata: {}, location: { directory: "/repo" } }
    const applyStatus = (status: object) =>
      store.applyV2({ ...current, type: "session.next.status", data: { timestamp: 1, sessionID: "child", status } } as unknown as V2Event)
    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    store.remember(session("child"))
    applyStatus({ type: "busy" })
    await flush()
    expect(requests).toEqual([])

    applyStatus({ type: "retry", attempt: 2, message: "quota", next: 3 })
    await flush()
    expect(requests).toEqual([])

    applyStatus({ type: "idle" })
    await flush()
    expect(requests).toEqual(["child"])
    expect(store.data.session_status.child).toEqual({ type: "idle" })
  })
})
