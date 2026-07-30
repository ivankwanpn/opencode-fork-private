/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { ClientError, type OpenCodeEvent } from "@opencode-ai/client"
import type { Event, SessionMessageAssistant } from "@opencode-ai/sdk/v2"
import { testRender } from "@opentui/solid"
import { createEffect, onCleanup, onMount } from "solid-js"
import { unwrap } from "solid-js/store"
import { DataProvider, useData } from "../../../src/context/data"
import { useEvent, useNativeEvent } from "../../../src/context/event"
import type { RecoveryError } from "../../../src/context/native-event-recovery"
import { ProjectProvider } from "../../../src/context/project"
import { SDKProvider } from "../../../src/context/sdk"
import { createEventSource, createFetch, directory, json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

test("delivers native-only events with their location metadata", async () => {
  const events = createEventSource()
  const seen: Array<{ event: OpenCodeEvent; location: OpenCodeEvent["location"] }> = []
  const legacySeen: Event[] = []
  const delivered = deferred<void>()
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })
  const event = {
    id: "evt_catalog",
    type: "catalog.updated",
    data: {},
    location: { directory, workspaceID: "ws_test" },
  } as OpenCodeEvent

  function Probe() {
    const legacyEvent = useEvent()
    const nativeEvent = useNativeEvent()

    onMount(() => {
      legacyEvent.subscribe((event) => {
        legacySeen.push(event)
      })
      nativeEvent.on("catalog.updated", (event, location) => {
        seen.push({ event, location })
        delivered.resolve(undefined)
      })
      ready()
    })

    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={createFetch().fetch}>
        <Probe />
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    const reader = events.response().body!.getReader()
    events.emitNative(event)

    await delivered.promise
    expect(seen).toEqual([{ event, location: event.location }])
    expect(legacySeen).toEqual([])
    expect(await Promise.race([reader.read(), Bun.sleep(25).then(() => undefined)])).toBeUndefined()
    await reader.cancel()
  } finally {
    app.renderer.destroy()
  }
})

test("converges buffered streaming and tool lifecycle events after rebuild", async () => {
  const events = createEventSource()
  const content: SessionMessageAssistant["content"] = [
    {
      type: "text",
      id: "text-1",
      text: "canonical text",
    },
    {
      type: "reasoning",
      id: "reasoning-1",
      text: "canonical reasoning",
    },
    {
      type: "tool",
      id: "call-1",
      name: "bash",
      state: { status: "pending", input: "canonical input" },
      time: { created: 4 },
    },
    {
      type: "tool",
      id: "call-stale",
      name: "bash",
      provider: { executed: true },
      state: {
        status: "completed",
        input: { command: "canonical" },
        structured: { canonical: true },
        content: [],
        result: "canonical result",
      },
      time: { created: 5, ran: 6, completed: 7 },
    },
    {
      type: "tool",
      id: "call-success",
      name: "bash",
      state: { status: "pending", input: "buffered input" },
      time: { created: 8 },
    },
    {
      type: "tool",
      id: "call-failure",
      name: "bash",
      state: { status: "pending", input: "buffered input" },
      time: { created: 9 },
    },
  ]
  const messageResponse = () =>
    json({
      data: [
        {
          id: "msg_assistant",
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          time: { created: 1 },
          content,
        },
      ],
      cursor: {},
    })
  const historyRequested = deferred<URL>()
  const historyResponse = deferred<Response>()
  const rebuildRequested = deferred<void>()
  const rebuildResponse = deferred<Response>()
  let messageReads = 0
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_test/history") {
      historyRequested.resolve(url)
      return historyResponse.promise
    }
    if (url.pathname !== "/api/session/ses_test/message") return
    messageReads++
    if (messageReads === 1) return messageResponse()
    rebuildRequested.resolve(undefined)
    return rebuildResponse.promise
  })
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })
  const cursorObserved = deferred<void>()
  const bufferedEventsObserved = deferred<void>()
  const bufferDrained = deferred<void>()

  function Probe() {
    data = useData()
    const nativeEvent = useNativeEvent()
    createEffect(() => {
      const messages = data.session.message.list("ses_test")
      if (messages?.some((message) => message.id === "msg_cursor")) cursorObserved.resolve(undefined)
      if (messages?.some((message) => message.id === "msg_buffer_marker")) bufferDrained.resolve(undefined)
    })
    onMount(() => {
      const unsub = nativeEvent.subscribe((event) => {
        if (event.id === "evt_buffer_marker") bufferedEventsObserved.resolve(undefined)
      })
      onCleanup(unsub)
      ready()
    })
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))

  try {
    await mounted
    await data.session.message.refresh("ses_test")
    events.emitNative({
      id: "evt_connected",
      type: "server.connected",
      data: {},
    } as OpenCodeEvent)
    events.emitNative({
      id: "evt_cursor",
      type: "session.next.model.switched",
      durable: { aggregateID: "ses_test", seq: 0, version: 1 },
      data: {
        sessionID: "ses_test",
        messageID: "msg_cursor",
        timestamp: 1,
        model: { id: "cursor-model", providerID: "provider" },
      },
    } as OpenCodeEvent)
    await cursorObserved.promise

    events.emitNative({
      id: "evt_reconnected",
      type: "server.connected",
      data: {},
    } as OpenCodeEvent)
    const historyURL = await historyRequested.promise
    expect(historyURL.searchParams.get("after")).toBe("0")
    expect(historyURL.searchParams.get("limit")).toBe("100")

    const started = [
      {
        id: "evt_text_started",
        type: "session.next.text.started",
        durable: { aggregateID: "ses_test", seq: 1, version: 1 },
        data: {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          textID: "text-1",
          timestamp: 2,
        },
      },
      {
        id: "evt_reasoning_started",
        type: "session.next.reasoning.started",
        durable: { aggregateID: "ses_test", seq: 2, version: 1 },
        data: {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          reasoningID: "reasoning-1",
          timestamp: 3,
          providerMetadata: { provider: { signature: "sig" } },
        },
      },
      {
        id: "evt_tool_started",
        type: "session.next.tool.input.started",
        durable: { aggregateID: "ses_test", seq: 3, version: 1 },
        data: {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          callID: "call-1",
          name: "bash",
          timestamp: 4,
        },
      },
    ] as OpenCodeEvent[]

    for (const event of started) events.emitNative(event)
    events.emitNative({
      id: "evt_stale_called",
      type: "session.next.tool.called",
      durable: { aggregateID: "ses_test", seq: 4, version: 1 },
      data: {
        sessionID: "ses_test",
        assistantMessageID: "msg_assistant",
        callID: "call-stale",
        tool: "bash",
        input: { command: "stale" },
        timestamp: 10,
        provider: { executed: false },
      },
    } as OpenCodeEvent)
    events.emitNative({
      id: "evt_tool_success",
      type: "session.next.tool.success",
      durable: { aggregateID: "ses_test", seq: 5, version: 1 },
      data: {
        sessionID: "ses_test",
        assistantMessageID: "msg_assistant",
        callID: "call-success",
        tool: "bash",
        structured: { exit: 0 },
        content: [],
        result: "success",
        timestamp: 11,
        provider: { executed: true, metadata: { test: { result: "success" } } },
      },
    } as OpenCodeEvent)
    events.emitNative({
      id: "evt_tool_failed",
      type: "session.next.tool.failed",
      durable: { aggregateID: "ses_test", seq: 6, version: 1 },
      data: {
        sessionID: "ses_test",
        assistantMessageID: "msg_assistant",
        callID: "call-failure",
        tool: "bash",
        error: { type: "unknown", message: "failed" },
        result: "failure",
        timestamp: 12,
        provider: { executed: false, metadata: { test: { result: "failure" } } },
      },
    } as OpenCodeEvent)
    events.emitNative({
      id: "evt_buffer_marker",
      type: "session.next.context.updated",
      data: {
        sessionID: "ses_test",
        messageID: "msg_buffer_marker",
        timestamp: 5,
        text: "buffer drained",
      },
    } as OpenCodeEvent)
    await bufferedEventsObserved.promise

    historyResponse.resolve(json({ data: [], hasMore: false }))
    await rebuildRequested.promise
    rebuildResponse.resolve(messageResponse())
    await bufferDrained.promise

    expect(messageReads).toBe(2)
    expect(data.session.message.list("ses_test")?.some((message) => message.id === "msg_cursor")).toBe(false)
    expect(data.session.message.list("ses_test")?.find((message) => message.id === "msg_buffer_marker")).toMatchObject({
      type: "system",
      text: "buffer drained",
    })
    const message = data.session.message.list("ses_test")?.find((message) => message.id === "msg_assistant")
    expect(message?.type).toBe("assistant")
    if (message?.type !== "assistant") return
    expect(message.content.slice(0, 3)).toEqual(content.slice(0, 3))
    expect(message.content.find((item) => item.type === "tool" && item.id === "call-stale")).toEqual(content[3])
    const successfulTool = message.content.find((item) => item.type === "tool" && item.id === "call-success")
    expect(unwrap(successfulTool)).toMatchObject({
      type: "tool",
      provider: {
        executed: true,
        resultMetadata: { test: { result: "success" } },
      },
      state: {
        status: "completed",
        input: {},
        structured: { exit: 0 },
        content: [],
        result: "success",
      },
      time: { created: 8, completed: 11 },
    })
    expect(unwrap(message.content.find((item) => item.type === "tool" && item.id === "call-failure"))).toMatchObject({
      type: "tool",
      provider: {
        executed: false,
        resultMetadata: { test: { result: "failure" } },
      },
      state: {
        status: "error",
        input: {},
        structured: {},
        content: [],
        error: { type: "unknown", message: "failed" },
        result: "failure",
      },
      time: { created: 9, completed: 12 },
    })
  } finally {
    app.renderer.destroy()
  }
})

test("retains every labeled canonical rebuild failure and original cause", async () => {
  const events = createEventSource()
  const messageFailure = new Error("messages unavailable")
  const questionFailure = new Error("questions unavailable")
  let messageReads = 0
  let questionReads = 0
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session/ses_test/history") return json({ data: [], hasMore: false })
    if (url.pathname === "/api/session/ses_test/message") {
      messageReads++
      if (messageReads === 1) return json({ data: [], cursor: {} })
      throw messageFailure
    }
    if (url.pathname === "/api/session/ses_test/question") {
      questionReads++
      if (questionReads === 1) return json({ data: [] })
      throw questionFailure
    }
  })
  const reported = deferred<RecoveryError>()
  const originalError = console.error
  let data!: ReturnType<typeof useData>
  let ready!: () => void
  const mounted = new Promise<void>((resolve) => {
    ready = resolve
  })

  function Probe() {
    data = useData()
    onMount(ready)
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <SDKProvider url="http://test" directory={directory} events={events.source} fetch={calls.fetch}>
        <ProjectProvider>
          <DataProvider>
            <Probe />
          </DataProvider>
        </ProjectProvider>
      </SDKProvider>
    </TestTuiContexts>
  ))
  console.error = (message: unknown, error?: unknown) => {
    if (message !== "Failed to recover native event state") return
    reported.resolve(error as RecoveryError)
  }

  try {
    await mounted
    await Promise.all([data.session.message.refresh("ses_test"), data.session.question.refresh("ses_test")])
    events.emitNative({
      id: "evt_connected",
      type: "server.connected",
      data: {},
    } as OpenCodeEvent)
    events.emitNative({
      id: "evt_cursor",
      type: "session.next.model.switched",
      durable: { aggregateID: "ses_test", seq: 0, version: 1 },
      data: {
        sessionID: "ses_test",
        messageID: "msg_cursor",
        timestamp: 1,
        model: { id: "cursor-model", providerID: "provider" },
      },
    } as OpenCodeEvent)
    events.emitNative({
      id: "evt_reconnected",
      type: "server.connected",
      data: {},
    } as OpenCodeEvent)

    const error = await reported.promise
    expect(error.operation).toBe("rebuild")
    expect(error.cause).toBeInstanceOf(AggregateError)
    if (!(error.cause instanceof AggregateError)) return
    const failures = error.cause.errors as Error[]
    expect(failures.map((failure) => failure.message)).toEqual([
      "Failed to rebuild Session messages (ses_test)",
      "Failed to rebuild Session questions (ses_test)",
    ])
    expect(failures.map((failure) => failure.cause)).toEqual([expect.any(ClientError), expect.any(ClientError)])
    expect(failures.map((failure) => (failure.cause instanceof ClientError ? failure.cause.cause : undefined))).toEqual(
      [messageFailure, questionFailure],
    )
  } finally {
    console.error = originalError
    app.renderer.destroy()
  }
})
