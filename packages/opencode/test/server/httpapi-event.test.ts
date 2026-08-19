import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Queue, Schema, Stream } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { Command } from "@opencode-ai/schema/command"
import { legacyEventPayloads } from "../../src/event-v2-bridge"
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

describe("legacy event adapter", () => {
  test("keeps the current command event type and payload unchanged", () => {
    const data = {
      name: "init",
      sessionID: "ses_command",
      arguments: "--force",
      messageID: "msg_command",
    }
    const source = canonicalEvent(Command.Event.Executed.type, data)

    expect(legacyEventPayloads(source)).toEqual([{ id: source.id, type: "command.executed", properties: data }])
  })

  test("forwards canonical events without renaming them", () => {
    const source = canonicalEvent("session.next.step.started", {
      sessionID: "ses_test",
      assistantMessageID: "msg_assistant",
      agent: "build",
      model: { providerID: "provider", id: "model" },
      timestamp: 1,
    })

    expect(legacyEventPayloads(source)).toEqual([
      { id: source.id, type: source.type, properties: source.data as Record<string, unknown> },
    ])
  })

  test("keeps transcript mutations canonical", () => {
    const sources = [
      canonicalEvent("session.next.transcript.message.removed", {
        sessionID: "ses_test",
        messageID: "msg_removed",
        timestamp: 1,
      }),
      canonicalEvent("session.next.transcript.user-text.updated", {
        sessionID: "ses_test",
        messageID: "msg_user",
        partID: "prt_user",
        text: "updated",
        timestamp: 2,
      }),
      canonicalEvent("session.next.transcript.user-text.removed", {
        sessionID: "ses_test",
        messageID: "msg_user",
        partID: "prt_user",
        timestamp: 3,
      }),
      canonicalEvent("session.next.transcript.content.updated", {
        sessionID: "ses_test",
        assistantMessageID: "msg_assistant",
        contentIndex: 0,
        partID: "prt_assistant",
        content: { type: "text", id: "text", text: "updated" },
        timestamp: 4,
      }),
      canonicalEvent("session.next.transcript.content.removed", {
        sessionID: "ses_test",
        assistantMessageID: "msg_assistant",
        contentIndex: 0,
        partID: "prt_assistant",
        timestamp: 5,
      }),
    ]

    const types = sources.flatMap(legacyEventPayloads).map((event) => event.type)
    expect(types).toEqual(sources.map((event) => event.type))
    expect(types.some((type) => /^message(?:\.|$)/.test(type))).toBe(false)
  })

  test("keeps durable tool discovery out of the legacy event stream", () => {
    const source = canonicalEvent("session.next.tool-discovery.completed", {
      sessionID: "ses_test",
      assistantMessageID: "msg_assistant",
      callID: "call_search",
      query: "calendar",
      limit: 8,
      catalogRevision: "revision",
      matches: [],
      pendingSources: [],
      timestamp: 1,
    })

    expect(legacyEventPayloads(source)).toEqual([])
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

        const status = yield* Queue.take(reader).pipe(
          Effect.as("event" as const),
          Effect.timeoutOrElse({ duration: "250 millis", orElse: () => Effect.succeed("open" as const) }),
        )
        expect(status).toBe("open")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "delivers canonical instance events after the initial event",
    () =>
      Effect.gen(function* () {
        const { directory } = yield* TestInstance
        const { reader } = yield* openEventStream(directory)
        expect(yield* readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

        const created = yield* requestInDirectory("/session", directory, { method: "POST" })
        expect(created.status).toBe(200)
        expect(yield* readEvent(reader)).toMatchObject({ type: "session.next.created" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
