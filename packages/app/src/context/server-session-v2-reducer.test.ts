import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import type { V2Event } from "@opencode-ai/sdk/v2/client"
import { createV2SessionReducer } from "./server-session-v2-reducer"

const event = (input: object) => input as OpenCodeEvent | V2Event
const base = { created: 1, location: { directory: "/repo" }, durable: { aggregateID: "ses_1", seq: 1, version: 1 } }

describe("v2 session reducer", () => {
  test("projects promoted input and streaming assistant content", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }

    apply({
      ...base,
      id: "evt_admitted",
      type: "session.input.admitted",
      data: {
        sessionID: "ses_1",
        inputID: "msg_user",
        input: { type: "user", delivery: "steer", data: { text: "hello" } },
      },
    })
    apply({
      ...base,
      id: "evt_promoted",
      type: "session.input.promoted",
      data: { sessionID: "ses_1", inputID: "msg_user" },
    })
    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_text_start",
      type: "session.text.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0 },
    })
    apply({
      ...base,
      id: "evt_text_delta",
      type: "session.text.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, delta: "hel" },
    })
    apply({
      ...base,
      id: "evt_text_end",
      type: "session.text.ended",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", ordinal: 0, text: "hello" },
    })

    expect(messages[0]).toMatchObject({ id: "msg_user", type: "user", text: "hello" })
    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      type: "assistant",
      content: [{ type: "text", text: "hello" }],
    })
  })

  test("projects durable background results as synthetic turns", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        id: "evt_background_result",
        type: "session.next.prompted",
        metadata: {},
        location: { directory: "/repo" },
        data: {
          timestamp: 1,
          sessionID: "ses_1",
          messageID: "msg_background_result",
          prompt: { text: "<task_result>complete</task_result>" },
          synthetic: { description: "Background task completed: inspect flow" },
          delivery: "steer",
        },
      }),
    )

    expect(result?.messages).toEqual([
      expect.objectContaining({
        id: "msg_background_result",
        type: "synthetic",
        text: "<task_result>complete</task_result>",
        description: "Background task completed: inspect flow",
      }),
    ])
    expect(result?.messages.some((message) => message.type === "user")).toBe(false)
  })

  test("projects current session.next events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }
    const current = {
      id: "evt_current",
      metadata: {},
      location: { directory: "/repo" },
    }

    apply({
      ...current,
      type: "session.next.prompted",
      data: {
        timestamp: 1,
        sessionID: "ses_1",
        messageID: "msg_user",
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    apply({
      ...current,
      type: "session.next.step.started",
      data: {
        timestamp: 2,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...current,
      type: "session.next.reasoning.delta",
      data: {
        timestamp: 3,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        reasoningID: "reasoning-0",
        delta: "why",
      },
    })
    apply({
      ...current,
      type: "session.next.reasoning.ended",
      data: {
        timestamp: 4,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        reasoningID: "reasoning-0",
        text: "why",
      },
    })
    apply({
      ...current,
      type: "session.next.text.started",
      data: {
        timestamp: 5,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        textID: "text-0",
      },
    })
    apply({
      ...current,
      type: "session.next.text.delta",
      data: {
        timestamp: 6,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        textID: "text-0",
        delta: "OK",
      },
    })
    apply({
      ...current,
      type: "session.next.step.ended",
      data: {
        timestamp: 7,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 1, cache: { read: 0, write: 0 } },
      },
    })

    expect(messages).toMatchObject([
      { id: "msg_user", type: "user", text: "hello" },
      {
        id: "msg_assistant",
        type: "assistant",
        content: [
          { type: "reasoning", text: "why" },
          { type: "text", text: "OK" },
        ],
        finish: "stop",
        time: { created: 2, completed: 7 },
      },
    ])
  })

  test("requests hydration when a current assistant start event was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        id: "evt_done",
        type: "session.next.step.ended",
        data: {
          timestamp: 7,
          sessionID: "ses_1",
          assistantMessageID: "msg_assistant",
          finish: "stop",
          cost: 0,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      }),
    )

    expect(result).toMatchObject({
      sessionID: "ses_1",
      missing: "msg_assistant",
      touched: [],
    })
  })

  test("projects current session.next tool events and requests hydration for a missed tool start", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }
    const current = {
      id: "evt_current",
      metadata: {},
      location: { directory: "/repo" },
    }

    apply({
      ...current,
      type: "session.next.prompted",
      data: {
        timestamp: 1,
        sessionID: "ses_1",
        messageID: "msg_user",
        prompt: { text: "run it" },
        delivery: "steer",
      },
    })
    apply({
      ...current,
      type: "session.next.step.started",
      data: {
        timestamp: 2,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...current,
      type: "session.next.tool.input.started",
      data: {
        timestamp: 3,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        name: "bash",
      },
    })
    apply({
      ...current,
      type: "session.next.tool.input.delta",
      data: {
        timestamp: 4,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        delta: '{"command":"pwd"}',
      },
    })
    apply({
      ...current,
      type: "session.next.tool.input.ended",
      data: {
        timestamp: 5,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        text: '{"command":"pwd"}',
      },
    })
    apply({
      ...current,
      type: "session.next.tool.called",
      data: {
        timestamp: 6,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        tool: "bash",
        input: { command: "pwd" },
        provider: { executed: false, metadata: { openai: { itemId: "item_1" } } },
      },
    })
    apply({
      ...current,
      type: "session.next.tool.success",
      data: {
        timestamp: 7,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        structured: { exit: 0, truncated: false },
        content: [{ type: "text", text: "D:/repo" }],
        provider: { executed: false },
      },
    })

    expect(messages[1]).toMatchObject({
      id: "msg_assistant",
      type: "assistant",
      content: [
        {
          type: "tool",
          id: "call_1",
          name: "bash",
          state: {
            status: "completed",
            input: { command: "pwd" },
            structured: { exit: 0, truncated: false },
            content: [{ type: "text", text: "D:/repo" }],
          },
          time: { created: 3, ran: 6, completed: 7 },
        },
      ],
    })

    const missing = reducer.reduce(
      messages,
      event({
        ...current,
        type: "session.next.tool.success",
        data: {
          timestamp: 8,
          sessionID: "ses_1",
          assistantMessageID: "msg_assistant",
          callID: "call_missed",
          structured: {},
          content: [{ type: "text", text: "done" }],
          provider: { executed: false },
        },
      }),
    )
    expect(missing).toMatchObject({ missing: "msg_assistant", touched: [] })
  })

  test("folds tool, retry, and completion events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
    }

    apply({
      ...base,
      id: "evt_step",
      type: "session.step.started",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...base,
      id: "evt_tool_start",
      type: "session.tool.input.started",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", name: "bash" },
    })
    apply({
      ...base,
      id: "evt_tool_delta",
      type: "session.tool.input.delta",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", delta: "{}" },
    })
    apply({
      ...base,
      id: "evt_tool_called",
      type: "session.tool.called",
      data: { sessionID: "ses_1", assistantMessageID: "msg_assistant", callID: "call_1", input: {}, executed: true },
    })
    apply({
      ...base,
      id: "evt_tool_success",
      type: "session.tool.success",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        callID: "call_1",
        structured: {},
        content: [{ type: "text", text: "done" }],
        executed: true,
      },
    })
    apply({
      ...base,
      id: "evt_retry",
      type: "session.retry.scheduled",
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        at: 10,
        error: { type: "ProviderError", message: "retry" },
      },
    })
    apply({ ...base, id: "evt_done", type: "session.execution.succeeded", data: { sessionID: "ses_1" } })

    expect(messages[0]).toMatchObject({
      type: "assistant",
      retry: undefined,
      content: [{ type: "tool", id: "call_1", state: { status: "completed", content: [{ text: "done" }] } }],
    })
  })

  test("requests hydration when promotion admission was missed", () => {
    const result = createV2SessionReducer().reduce(
      [],
      event({
        ...base,
        id: "evt_promoted",
        type: "session.input.promoted",
        data: { sessionID: "ses_1", inputID: "msg_user" },
      }),
    )

    expect(result).toMatchObject({ sessionID: "ses_1", missing: "msg_user", touched: [] })
  })

  test("projects current retry, provider attempt, context, and compaction events", () => {
    const reducer = createV2SessionReducer()
    let messages: SessionMessageInfo[] = []
    const apply = (input: object) => {
      const result = reducer.reduce(messages, event(input))
      if (result) messages = result.messages
      return result
    }
    const current = {
      id: "evt_current",
      metadata: {},
      location: { directory: "/repo" },
    }

    apply({
      ...current,
      type: "session.next.prompted",
      data: {
        timestamp: 1,
        sessionID: "ses_1",
        messageID: "msg_user",
        prompt: { text: "hello" },
        delivery: "steer",
      },
    })
    apply({
      ...current,
      type: "session.next.step.started",
      data: {
        timestamp: 2,
        sessionID: "ses_1",
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    })
    apply({
      ...current,
      type: "session.next.retried",
      data: {
        timestamp: 3,
        sessionID: "ses_1",
        attemptID: "evt_attempt_1",
        attempt: 2,
        next: 10,
        error: { message: "retry", isRetryable: true },
      },
    })

    expect(messages[1]).toMatchObject({
      type: "assistant",
      retry: { attempt: 2, at: 10, error: { type: "ProviderError", message: "retry" } },
    })

    apply({
      ...current,
      type: "session.next.provider.attempt.started",
      data: {
        timestamp: 10,
        sessionID: "ses_1",
        attemptID: "evt_attempt_2",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        retryOf: "evt_attempt_1",
      },
    })
    apply({
      ...current,
      type: "session.next.context.updated",
      data: { timestamp: 11, sessionID: "ses_1", messageID: "msg_system", text: "context" },
    })
    apply({
      ...current,
      type: "session.next.compaction.started",
      data: {
        timestamp: 12,
        sessionID: "ses_1",
        messageID: "msg_compaction",
        reason: "auto",
      },
    })
    apply({
      ...current,
      type: "session.next.compaction.delta",
      data: {
        timestamp: 13,
        sessionID: "ses_1",
        messageID: "msg_compaction",
        text: "partial",
      },
    })
    apply({
      ...current,
      type: "session.next.compaction.ended",
      data: {
        timestamp: 14,
        sessionID: "ses_1",
        messageID: "msg_compaction",
        reason: "auto",
        text: "summary",
        recent: "recent",
      },
    })

    expect(messages[1]).toMatchObject({ type: "assistant", retry: undefined })
    expect(messages[2]).toMatchObject({ id: "msg_system", type: "system", text: "context" })
    expect(messages[3]).toMatchObject({
      id: "msg_compaction",
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "summary",
      recent: "recent",
      time: { created: 12 },
    })
  })

  test("hydrates a current imported message once", () => {
    const reducer = createV2SessionReducer()
    const imported = {
      id: "msg_imported",
      type: "user",
      text: "forked",
      time: { created: 1 },
    }
    const current = event({
      id: "evt_imported",
      type: "session.next.message.imported",
      metadata: {},
      location: { directory: "/repo" },
      data: { timestamp: 1, sessionID: "ses_1", message: imported },
    })

    expect(reducer.reduce([], current)).toMatchObject({
      sessionID: "ses_1",
      missing: "msg_imported",
      touched: [],
    })
    expect(reducer.reduce([imported] as SessionMessageInfo[], current)).toMatchObject({
      sessionID: "ses_1",
      touched: [],
    })
  })
})
