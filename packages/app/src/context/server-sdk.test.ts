import { describe, expect, test } from "bun:test"
import { adaptServerEvent, coalesceServerEvents, enqueueServerEvent, resumeStreamAfterPageShow } from "./server-sdk"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import type { Event } from "@opencode-ai/sdk/v2/client"

describe("resumeStreamAfterPageShow", () => {
  test("restarts a stream only after a back-forward cache restore", () => {
    let starts = 0
    const start = () => starts++

    resumeStreamAfterPageShow({ persisted: false } as PageTransitionEvent, start)
    resumeStreamAfterPageShow({ persisted: true } as PageTransitionEvent, start)

    expect(starts).toBe(1)
  })
})

describe("adaptServerEvent", () => {
  test("preserves canonical V2 permission requests", () => {
    const current = {
      id: "evt_1",
      created: 1,
      type: "permission.v2.asked",
      data: { id: "perm_1", sessionID: "ses_1", action: "read", resources: ["src/**"] },
    } as OpenCodeEvent

    expect(adaptServerEvent(current)).toMatchObject({
      type: "permission.v2.asked",
      properties: { id: "perm_1", sessionID: "ses_1", action: "read", resources: ["src/**"] },
      current,
    })
  })

  test("preserves the canonical permission and question request lifecycle", () => {
    const permissionAsked = {
      id: "evt_permission_asked",
      created: 1,
      type: "permission.v2.asked",
      data: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        save: ["src/**"],
        metadata: { reason: "test" },
        source: { type: "tool", messageID: "msg_1", callID: "call_1" },
      },
    } as OpenCodeEvent
    const permissionReplied = {
      id: "evt_permission_replied",
      created: 2,
      type: "permission.v2.replied",
      data: { sessionID: "ses_1", requestID: "perm_1", reply: "once" },
    } as OpenCodeEvent
    const questionAsked = {
      id: "evt_question_asked",
      created: 3,
      type: "question.v2.asked",
      data: {
        id: "que_1",
        sessionID: "ses_1",
        questions: [{ question: "Continue?", header: "Continue", options: [] }],
        tool: { messageID: "msg_1", callID: "call_2" },
      },
    } as OpenCodeEvent
    const questionReplied = {
      id: "evt_question_replied",
      created: 4,
      type: "question.v2.replied",
      data: { sessionID: "ses_1", requestID: "que_1", answers: [["yes"]] },
    } as OpenCodeEvent
    const questionRejected = {
      id: "evt_question_rejected",
      created: 5,
      type: "question.v2.rejected",
      data: { sessionID: "ses_1", requestID: "que_1" },
    } as OpenCodeEvent

    expect(adaptServerEvent(permissionAsked)).toMatchObject({
      type: "permission.v2.asked",
      properties: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        save: ["src/**"],
        metadata: { reason: "test" },
        source: { type: "tool", messageID: "msg_1", callID: "call_1" },
      },
    })
    expect(adaptServerEvent(permissionReplied)).toMatchObject({
      type: "permission.v2.replied",
      properties: { sessionID: "ses_1", requestID: "perm_1", reply: "once" },
    })
    expect(adaptServerEvent(questionAsked)).toMatchObject({
      type: "question.v2.asked",
      properties: {
        id: "que_1",
        sessionID: "ses_1",
        questions: [{ question: "Continue?", header: "Continue", options: [] }],
      },
    })
    expect(adaptServerEvent(questionReplied)).toMatchObject({
      type: "question.v2.replied",
      properties: { sessionID: "ses_1", requestID: "que_1", answers: [["yes"]] },
    })
    expect(adaptServerEvent(questionRejected)).toMatchObject({
      type: "question.v2.rejected",
      properties: { sessionID: "ses_1", requestID: "que_1" },
    })
  })
})

describe("coalesceServerEvents", () => {
  test("merges adjacent canonical text deltas", () => {
    const current = (id: string, value: string) =>
      adaptServerEvent({
        id,
        type: "session.next.text.delta",
        location: { directory: "/repo" },
        data: {
          timestamp: 1,
          sessionID: "ses",
          assistantMessageID: "msg",
          textID: "text",
          delta: value,
        },
      } as unknown as OpenCodeEvent)
    const result = coalesceServerEvents([
      { directory: "/repo", payload: current("evt_1", "hello ") },
      { directory: "/repo", payload: current("evt_2", "world") },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]?.payload.current).toMatchObject({ id: "evt_2", data: { delta: "hello world" } })
  })

  test("merges adjacent canonical reasoning and tool input deltas", () => {
    const reasoning = (id: string, value: string) =>
      adaptServerEvent({
        id,
        type: "session.next.reasoning.delta",
        location: { directory: "/repo" },
        data: {
          timestamp: 1,
          sessionID: "ses",
          assistantMessageID: "msg",
          reasoningID: "reasoning",
          delta: value,
        },
      } as unknown as OpenCodeEvent)
    const tool = (id: string, value: string) =>
      adaptServerEvent({
        id,
        type: "session.next.tool.input.delta",
        location: { directory: "/repo" },
        data: {
          timestamp: 1,
          sessionID: "ses",
          assistantMessageID: "msg",
          callID: "call",
          delta: value,
        },
      } as unknown as OpenCodeEvent)

    const result = coalesceServerEvents([
      { directory: "/repo", payload: reasoning("evt_1", "think ") },
      { directory: "/repo", payload: reasoning("evt_2", "again") },
      { directory: "/repo", payload: tool("evt_3", '{"command":') },
      { directory: "/repo", payload: tool("evt_4", '"pwd"}') },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]?.payload.current).toMatchObject({ id: "evt_2", data: { delta: "think again" } })
    expect(result[1]?.payload.current).toMatchObject({ id: "evt_4", data: { delta: '{"command":"pwd"}' } })
  })
})

describe("enqueueServerEvent", () => {
  const partUpdated = (text: string) =>
    ({
      type: "message.part.updated",
      properties: {
        sessionID: "session",
        part: { id: "part", sessionID: "session", messageID: "message", type: "text", text },
      },
    }) as Event

  test("preserves part updates across message remove and re-add barriers", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (payload: Event) => enqueueServerEvent(events, { directory: "/repo", payload })

    enqueue(partUpdated("old"))
    enqueue({ type: "message.removed", properties: { sessionID: "session", messageID: "message" } } as Event)
    enqueue({
      type: "message.updated",
      properties: {
        sessionID: "session",
        info: {
          id: "message",
          sessionID: "session",
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
        },
      },
    } as Event)
    enqueue(partUpdated("new"))

    expect(events.map((event) => event.payload.type)).toEqual([
      "message.part.updated",
      "message.removed",
      "message.updated",
      "message.part.updated",
    ])
  })

  test("preserves updates after session deletion", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (payload: Event) => enqueueServerEvent(events, { directory: "/repo", payload })

    enqueue(partUpdated("old"))
    enqueue({
      type: "session.deleted",
      properties: { sessionID: "session", info: { id: "session" } },
    } as Event)
    enqueue(partUpdated("new"))

    expect(events.map((event) => event.payload.type)).toEqual([
      "message.part.updated",
      "session.deleted",
      "message.part.updated",
    ])
  })

  test("does not coalesce edge-triggered session statuses", () => {
    const events: Array<{ directory: string; payload: Event }> = []
    const enqueue = (status: "retry" | "busy") =>
      enqueueServerEvent(events, {
        directory: "/repo",
        payload: {
          type: "session.next.status",
          properties: {
            timestamp: 1,
            sessionID: "session",
            status: status === "retry" ? { type: "retry", attempt: 1, message: "retry", next: 1 } : { type: "busy" },
          },
        } as Event,
      })

    enqueue("retry")
    enqueue("busy")

    expect(events).toHaveLength(2)
  })
})
