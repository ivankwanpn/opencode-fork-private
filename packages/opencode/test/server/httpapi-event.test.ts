import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer, Queue, Schema, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { legacyEventPayloads, legacyEventProjection } from "../../src/event-v2-bridge"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

const readEvent = (reader: Queue.Dequeue<Uint8Array>) =>
  Effect.gen(function* () {
    const value = yield* Queue.take(reader).pipe(
      Effect.timeoutOrElse({
        duration: "5 seconds",
        orElse: () => Effect.fail(new Error("timed out waiting for event")),
      }),
    )
    return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(value).replace(/^data: /, "")))
  })

const canonicalEvent = (type: string, data: Record<string, unknown>, directory = "/project"): EventV2.Payload =>
  ({
    id: EventV2.ID.create(),
    type,
    data,
    location: { directory },
  }) as EventV2.Payload

const beginStep = (project: ReturnType<typeof legacyEventProjection>, assistantMessageID = "msg_assistant") => {
  project(
    canonicalEvent("session.next.prompted", {
      sessionID: "ses_test",
      messageID: "msg_user",
    }),
  )
  return project(
    canonicalEvent("session.next.step.started", {
      sessionID: "ses_test",
      assistantMessageID,
      agent: "build",
      model: { providerID: "provider", id: "model", variant: "default" },
      timestamp: 100,
      snapshot: "snap_start",
    }),
  )
}

const stepData = (assistantMessageID = "msg_assistant") => ({
  sessionID: "ses_test",
  assistantMessageID,
})

const openEventStream = (directory: string) =>
  Effect.gen(function* () {
    const response = yield* requestInDirectory(EventPaths.event, directory)
    const reader = yield* Queue.unbounded<Uint8Array>()
    yield* response.stream.pipe(
      Stream.runForEach((value) => Queue.offer(reader, value)),
      Effect.forkScoped,
    )
    return { response, reader }
  })

describe("legacy event projection", () => {
  test("projects text, reasoning, and successful step lifecycles", () => {
    const project = legacyEventProjection()
    const started = beginStep(project)

    expect(started.map((event) => event.type)).toEqual(["message.updated", "message.part.updated"])
    expect(started[0]?.properties.info).toMatchObject({
      id: "msg_assistant",
      sessionID: "ses_test",
      parentID: "msg_user",
      role: "assistant",
      agent: "build",
      providerID: "provider",
      modelID: "model",
      path: { cwd: "/project", root: "/project" },
      time: { created: 100 },
    })
    expect(started[1]?.properties.part).toMatchObject({
      type: "step-start",
      snapshot: "snap_start",
    })

    const textStarted = project(
      canonicalEvent("session.next.text.started", {
        ...stepData(),
        textID: "text_1",
        timestamp: 110,
      }),
    )
    expect(textStarted[0]?.properties.part).toMatchObject({
      type: "text",
      text: "",
      time: { start: 110 },
    })
    const textDelta = project(
      canonicalEvent("session.next.text.delta", {
        ...stepData(),
        textID: "text_1",
        delta: "hello",
        timestamp: 115,
      }),
    )
    expect(textDelta[0]).toMatchObject({
      type: "message.part.delta",
      properties: { field: "text", delta: "hello" },
    })
    const textEnded = project(
      canonicalEvent("session.next.text.ended", {
        ...stepData(),
        textID: "text_1",
        text: "hello",
        timestamp: 120,
      }),
    )
    expect(textEnded[0]?.properties.part).toMatchObject({
      type: "text",
      text: "hello",
      time: { start: 110, end: 120 },
    })

    const reasoningStarted = project(
      canonicalEvent("session.next.reasoning.started", {
        ...stepData(),
        reasoningID: "reasoning_1",
        providerMetadata: { provider: "start" },
        timestamp: 130,
      }),
    )
    expect(reasoningStarted[0]?.properties.part).toMatchObject({
      type: "reasoning",
      text: "",
      metadata: { provider: "start" },
      time: { start: 130 },
    })
    const reasoningDelta = project(
      canonicalEvent("session.next.reasoning.delta", {
        ...stepData(),
        reasoningID: "reasoning_1",
        delta: "thinking",
        timestamp: 135,
      }),
    )
    expect(reasoningDelta[0]).toMatchObject({
      type: "message.part.delta",
      properties: { field: "text", delta: "thinking" },
    })
    const reasoningEnded = project(
      canonicalEvent("session.next.reasoning.ended", {
        ...stepData(),
        reasoningID: "reasoning_1",
        text: "thinking",
        providerMetadata: { provider: "end" },
        timestamp: 140,
      }),
    )
    expect(reasoningEnded[0]?.properties.part).toMatchObject({
      type: "reasoning",
      text: "thinking",
      metadata: { provider: "end" },
      time: { start: 130, end: 140 },
    })

    const ended = project(
      canonicalEvent("session.next.step.ended", {
        ...stepData(),
        finish: "stop",
        cost: 0.25,
        tokens: {
          input: 10,
          output: 5,
          reasoning: 2,
          cache: { read: 1, write: 0 },
        },
        snapshot: "snap_end",
        timestamp: 150,
      }),
    )
    expect(ended.map((event) => event.type)).toEqual(["message.part.updated", "message.updated"])
    expect(ended[0]?.properties.part).toMatchObject({
      type: "step-finish",
      reason: "stop",
      snapshot: "snap_end",
      cost: 0.25,
    })
    expect(ended[1]?.properties.info).toMatchObject({
      finish: "stop",
      cost: 0.25,
      time: { created: 100, completed: 150 },
    })
  })

  test("projects pending, running, completed, and failed tool states", () => {
    const project = legacyEventProjection()
    beginStep(project)

    const pending = project(
      canonicalEvent("session.next.tool.input.started", {
        ...stepData(),
        callID: "call_success",
        name: "bash",
        timestamp: 200,
      }),
    )
    expect(pending[0]?.properties.part).toMatchObject({
      type: "tool",
      callID: "call_success",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    })

    const input = project(
      canonicalEvent("session.next.tool.input.ended", {
        ...stepData(),
        callID: "call_success",
        text: '{"command":"pwd"}',
        timestamp: 205,
      }),
    )
    expect(input[0]?.properties.part).toMatchObject({
      state: { status: "pending", input: { command: "pwd" } },
    })

    const running = project(
      canonicalEvent("session.next.tool.called", {
        ...stepData(),
        callID: "call_success",
        input: { command: "pwd" },
        provider: { metadata: { providerCall: true } },
        timestamp: 210,
      }),
    )
    expect(running[0]?.properties.part).toMatchObject({
      metadata: { providerCall: true },
      state: {
        status: "running",
        input: { command: "pwd" },
        title: "bash",
        time: { start: 210 },
      },
    })

    const progress = project(
      canonicalEvent("session.next.tool.progress", {
        ...stepData(),
        callID: "call_success",
        structured: { title: "Working" },
        content: [{ type: "text", text: "partial" }],
        timestamp: 215,
      }),
    )
    expect(progress[0]?.properties.part).toMatchObject({
      state: { status: "running", title: "Working", metadata: { title: "Working" } },
    })

    const completed = project(
      canonicalEvent("session.next.tool.success", {
        ...stepData(),
        callID: "call_success",
        structured: { title: "Done" },
        content: [
          { type: "text", text: "complete" },
          { type: "file", uri: "file:///result.txt", mime: "text/plain", name: "result.txt" },
        ],
        timestamp: 220,
      }),
    )
    expect(completed[0]?.properties.part).toMatchObject({
      state: {
        status: "completed",
        output: "complete\nfile:///result.txt",
        title: "Done",
        time: { start: 210, end: 220 },
        attachments: [
          {
            type: "file",
            mime: "text/plain",
            filename: "result.txt",
            url: "file:///result.txt",
          },
        ],
      },
    })

    project(
      canonicalEvent("session.next.tool.input.started", {
        ...stepData(),
        callID: "call_failed",
        name: "read",
        timestamp: 230,
      }),
    )
    project(
      canonicalEvent("session.next.tool.called", {
        ...stepData(),
        callID: "call_failed",
        input: { path: "missing.txt" },
        timestamp: 235,
      }),
    )
    const failed = project(
      canonicalEvent("session.next.tool.failed", {
        ...stepData(),
        callID: "call_failed",
        error: { message: "missing" },
        timestamp: 240,
      }),
    )
    expect(failed[0]?.properties.part).toMatchObject({
      callID: "call_failed",
      tool: "read",
      state: {
        status: "error",
        input: { path: "missing.txt" },
        error: "missing",
        time: { start: 235, end: 240 },
      },
    })
  })

  test("projects step failures and permission events", () => {
    const project = legacyEventProjection()
    beginStep(project)

    const failed = project(
      canonicalEvent("session.next.step.failed", {
        ...stepData(),
        error: { message: "provider failed" },
        timestamp: 300,
      }),
    )
    expect(failed.map((event) => event.type)).toEqual(["message.updated", "session.error"])
    expect(failed[0]?.properties.info).toMatchObject({
      finish: "error",
      error: { name: "UnknownError", data: { message: "provider failed" } },
      time: { created: 100, completed: 300 },
    })
    expect(failed[1]?.properties).toMatchObject({
      sessionID: "ses_test",
      error: { name: "UnknownError", data: { message: "provider failed" } },
    })

    const asked = project(
      canonicalEvent("permission.v2.asked", {
        id: "per_test",
        sessionID: "ses_test",
        action: "bash",
        resources: ["rm file"],
        save: ["rm *"],
        metadata: { reason: "test" },
        source: { type: "tool", messageID: "msg_assistant", callID: "call_1" },
      }),
    )
    expect(asked[0]).toMatchObject({
      type: "permission.asked",
      properties: {
        id: "per_test",
        sessionID: "ses_test",
        permission: "bash",
        patterns: ["rm file"],
        always: ["rm *"],
        metadata: { reason: "test" },
        tool: { messageID: "msg_assistant", callID: "call_1" },
      },
    })

    const replied = project(
      canonicalEvent("permission.v2.replied", {
        sessionID: "ses_test",
        requestID: "per_test",
        reply: "reject",
      }),
    )
    expect(replied[0]).toMatchObject({
      type: "permission.replied",
      properties: { sessionID: "ses_test", requestID: "per_test", reply: "reject" },
    })
  })

  test("emits only the legacy projection and never the raw canonical envelope", () => {
    const project = legacyEventProjection()
    project(
      canonicalEvent("session.next.prompted", {
        sessionID: "ses_test",
        messageID: "msg_user",
      }),
    )
    const source = canonicalEvent("session.next.step.started", {
      ...stepData(),
      agent: "build",
      model: { providerID: "provider", id: "model", variant: "default" },
      timestamp: 100,
    })
    const payloads = legacyEventPayloads(project, source)

    expect(payloads.map((event) => event.type)).toEqual(["message.updated", "message.part.updated"])
    expect(payloads.some((event) => event.type === "session.next.step.started")).toBe(false)
  })

  test("falls back to one raw canonical envelope when the projection is empty", () => {
    const project = legacyEventProjection()
    const source = canonicalEvent("session.next.message.imported", {
      sessionID: "ses_test",
      messageID: "legacy-message",
      partID: "legacy-part",
    })
    const payloads = legacyEventPayloads(project, source)

    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toEqual({
      id: source.id,
      type: source.type,
      properties: source.data as Record<string, unknown>,
    })
  })

  test("projects transcript mutation compatibility events", () => {
    const project = legacyEventProjection()
    expect(
      project(
        canonicalEvent("session.next.transcript.message.removed", {
          sessionID: "ses_test",
          messageID: "msg_removed",
          timestamp: 9,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.removed",
        properties: { sessionID: "ses_test", messageID: "msg_removed" },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.user-text.updated", {
          sessionID: "ses_test",
          messageID: "msg_user",
          partID: "prt_user",
          text: "updated",
          timestamp: 10,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.updated",
        properties: {
          part: { id: "prt_user", messageID: "msg_user", type: "text", text: "updated" },
        },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.user-text.removed", {
          sessionID: "ses_test",
          messageID: "msg_user",
          partID: "prt_user",
          timestamp: 11,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.removed",
        properties: { messageID: "msg_user", partID: "prt_user" },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.content.updated", {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          contentIndex: 0,
          partID: "prt_assistant",
          content: { type: "text", id: "text", text: "updated" },
          timestamp: 12,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.updated",
        properties: {
          part: { id: "prt_assistant", messageID: "msg_assistant", type: "text", text: "updated" },
        },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.content.removed", {
          sessionID: "ses_test",
          assistantMessageID: "msg_assistant",
          contentIndex: 0,
          partID: "prt_assistant",
          timestamp: 13,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.removed",
        properties: { messageID: "msg_assistant", partID: "prt_assistant" },
      },
    ])
  })

  test("preserves imported legacy ids exactly across transcript mutations", () => {
    const project = legacyEventProjection()

    expect(
      project(
        canonicalEvent("session.next.transcript.message.removed", {
          sessionID: "ses_test",
          messageID: "legacy-message",
          timestamp: 9,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.removed",
        properties: { sessionID: "ses_test", messageID: "legacy-message" },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.user-text.updated", {
          sessionID: "ses_test",
          messageID: "legacy-message",
          partID: "legacy-part",
          text: "updated",
          timestamp: 10,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.updated",
        properties: {
          part: { id: "legacy-part", sessionID: "ses_test", messageID: "legacy-message", type: "text", text: "updated" },
        },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.user-text.removed", {
          sessionID: "ses_test",
          messageID: "legacy-message",
          partID: "legacy-part",
          timestamp: 11,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.removed",
        properties: { sessionID: "ses_test", messageID: "legacy-message", partID: "legacy-part" },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.content.updated", {
          sessionID: "ses_test",
          assistantMessageID: "legacy-message",
          contentIndex: 0,
          partID: "legacy-part",
          content: { type: "text", id: "text", text: "updated" },
          timestamp: 12,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.updated",
        properties: {
          part: { id: "legacy-part", sessionID: "ses_test", messageID: "legacy-message", type: "text", text: "updated" },
        },
      },
    ])
    expect(
      project(
        canonicalEvent("session.next.transcript.content.removed", {
          sessionID: "ses_test",
          assistantMessageID: "legacy-message",
          contentIndex: 0,
          partID: "legacy-part",
          timestamp: 13,
        }),
      ),
    ).toMatchObject([
      {
        type: "message.part.removed",
        properties: { sessionID: "ses_test", messageID: "legacy-message", partID: "legacy-part" },
      },
    ])
  })
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const it = testEffect(httpApiLayer)

describe("event HttpApi", () => {
  it.instance(
    "serves event stream",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { response, reader } = yield* openEventStream(directory)

        expect(response.status).toBe(200)
        expect(response.headers["content-type"]).toContain("text/event-stream")
        expect(response.headers["cache-control"]).toBe("no-cache, no-transform")
        expect(response.headers["x-accel-buffering"]).toBe("no")
        expect(response.headers["x-content-type-options"]).toBe("nosniff")
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps the event stream open after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        // If no second event arrives within 250ms, the stream is still open.
        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers instance events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        expect(yield* readEvent(reader)).toMatchObject({ type: "session.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
