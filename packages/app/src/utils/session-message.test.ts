import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { compareMessages, sliceAtBoundary } from "./session-message"
import { normalizeSessionMessages } from "./session-message"

describe("normalizeSessionMessages", () => {
  test("projects current turns into stable legacy rendering records", () => {
    const source = [
      { id: "msg_1", type: "agent-switched", agent: "build", time: { created: 1 } },
      {
        id: "msg_2",
        type: "model-switched",
        model: {
          id: "claude",
          providerID: "anthropic",
          variant: "high",
          ...{ protocol: "anthropic-messages" as const },
        },
        time: { created: 2 },
      },
      {
        id: "msg_3",
        type: "user",
        text: "inspect @src/client.ts",
        files: [
          {
            data: "aGVsbG8=",
            mime: "text/plain",
            name: "note.txt",
            source: { type: "inline" },
          },
          {
            data: "ZXhwb3J0IHt9",
            mime: "text/plain",
            name: "client.ts",
            source: { type: "inline" },
            mention: { text: "@src/client.ts", start: 8, end: 22 },
          },
        ],
        agents: [{ name: "review", mention: { text: "@review", start: 0, end: 7 } }],
        time: { created: 3 },
      },
      {
        id: "msg_4",
        type: "assistant",
        agent: "build",
        model: {
          id: "claude",
          providerID: "anthropic",
          variant: "high",
          ...{ protocol: "anthropic-messages" as const },
        },
        content: [
          { type: "reasoning", text: "Thinking", time: { created: 4, completed: 5 } },
          { type: "text", text: "Result" },
          {
            type: "tool",
            id: "call_1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "note.txt" },
              structured: { title: "note.txt" },
              content: [{ type: "text", text: "hello" }],
            },
            time: { created: 5, ran: 6, completed: 7 },
          },
        ],
        cost: 0.1,
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 0 } },
        time: { created: 4, completed: 7 },
      },
      {
        id: "msg_5",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
        time: { created: 8 },
      },
    ] satisfies SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toMatchObject({
      id: "msg_3",
      role: "user",
      agent: "build",
      model: {
        providerID: "anthropic",
        modelID: "claude",
        variant: "high",
        protocol: "anthropic-messages",
      },
    })
    expect(result.messages[1]).toMatchObject({ id: "msg_4", role: "assistant", parentID: "msg_3", cost: 0.1 })
    expect(result.parts.get("msg_3")?.map((part) => part.id)).toEqual([
      "msg_3:text:0",
      "msg_3:file:0",
      "msg_3:file:1",
      "msg_3:agent:0",
      "msg_5:compaction",
    ])
    expect(result.parts.get("msg_3")?.[2]).toMatchObject({
      type: "file",
      source: {
        type: "file",
        path: "src/client.ts",
        text: { value: "@src/client.ts", start: 8, end: 22 },
      },
    })
    expect(result.parts.get("msg_4")?.map((part) => part.id)).toEqual(["msg_4:reasoning:0", "msg_4:text:0", "call_1"])
    expect(result.parts.get("msg_4")?.[2]).toMatchObject({
      type: "tool",
      tool: "read",
      state: { status: "completed", output: "hello" },
    })
  })

  test("projects only completed compaction messages into timeline parts", () => {
    const user = { id: "msg_user", type: "user", text: "hello", time: { created: 1 } } as SessionMessageInfo
    const partsFor = (message: SessionMessageInfo) =>
      normalizeSessionMessages("ses_1", [user, message]).parts.get("msg_user") ?? []
    const running = {
      id: "msg_running",
      type: "compaction",
      status: "running",
      reason: "auto",
      summary: "partial",
      recent: "",
      time: { created: 2 },
    } as SessionMessageInfo
    const failed = {
      id: "msg_failed",
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "unknown", message: "summary unavailable" },
      time: { created: 3 },
    } as SessionMessageInfo
    const completedAuto = {
      id: "msg_completed_auto",
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "summary",
      recent: "recent",
      time: { created: 4 },
    } as SessionMessageInfo
    const completedManual = {
      id: "msg_completed_manual",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "summary",
      recent: "recent",
      time: { created: 5 },
    } as SessionMessageInfo

    expect(partsFor(running).some((part) => part.type === "compaction")).toBeFalse()
    expect(partsFor(failed).some((part) => part.type === "compaction")).toBeFalse()
    expect(partsFor(completedAuto)).toContainEqual(expect.objectContaining({ type: "compaction", auto: true }))
    expect(partsFor(completedManual)).toContainEqual(expect.objectContaining({ type: "compaction", auto: false }))
  })

  test("projects current V2 attachments without legacy source metadata", () => {
    const source = [
      {
        id: "msg_current",
        type: "user",
        text: "inspect @src/client.ts with @review",
        files: [
          {
            uri: "data:image/png;base64,aGVsbG8=",
            mime: "image/png",
            name: "image.png",
            materialized: [],
          },
          {
            uri: "file:///repo/src/client.ts",
            mime: "text/plain",
            name: "client.ts",
            source: { text: "@src/client.ts", start: 8, end: 22 },
            materialized: [],
          },
        ],
        agents: [{ name: "review", source: { text: "@review", start: 28, end: 35 } }],
        time: { created: 1 },
      },
    ] as unknown as SessionMessageInfo[]

    const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_current")

    expect(parts?.[1]).toEqual({
      id: "msg_current:file:0",
      sessionID: "ses_1",
      messageID: "msg_current",
      type: "file",
      mime: "image/png",
      filename: "image.png",
      url: "data:image/png;base64,aGVsbG8=",
      source: undefined,
    })
    expect(parts?.[2]).toMatchObject({
      type: "file",
      url: "file:///repo/src/client.ts",
      source: {
        type: "file",
        path: "src/client.ts",
        text: { value: "@src/client.ts", start: 8, end: 22 },
      },
    })
    expect(parts?.[3]).toMatchObject({
      type: "agent",
      name: "review",
      source: { value: "@review", start: 28, end: 35 },
    })
  })

  test("does not invent a parent for an assistant-only page", () => {
    const source = [
      {
        id: "msg_2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "orphan" }],
        time: { created: 2 },
      },
    ] satisfies SessionMessageInfo[]

    expect(normalizeSessionMessages("ses_1", source).messages).toEqual([])
  })

  test("projects a current shell message into a renderable standalone turn", () => {
    const source = [
      {
        id: "msg_shell",
        type: "shell",
        shellID: "shell_1",
        command: "printf hello",
        status: "exited",
        exit: 0,
        output: { output: "hello", cursor: 5, size: 5, truncated: false },
        time: { created: 1, completed: 2 },
      },
    ] satisfies SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.messages).toEqual([
      expect.objectContaining({ id: "msg_shell", role: "user" }),
      expect.objectContaining({ id: "msg_shell:assistant", role: "assistant", parentID: "msg_shell" }),
    ])
    expect(result.parts.get("msg_shell")).toEqual([expect.objectContaining({ type: "text", text: "printf hello" })])
    expect(result.parts.get("msg_shell:assistant")).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "bash",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "printf hello" },
          output: "hello",
          title: "Shell",
        }),
      }),
    ])
  })

  test("adapts current edit fields for the legacy edit renderer", () => {
    const source = [
      { id: "msg_user", type: "user", text: "edit it", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_edit",
            name: "edit",
            state: {
              status: "completed",
              input: { path: "/repo/README.md", oldString: "old", newString: "new" },
              content: [{ type: "text", text: "Edited file successfully" }],
              structured: {
                files: [
                  {
                    file: "README.md",
                    patch: "@@ -1 +1 @@\n-old\n+new",
                    additions: 1,
                    deletions: 1,
                    status: "modified",
                  },
                ],
                replacements: 1,
              },
            },
            time: { created: 2, ran: 3, completed: 4 },
          },
        ],
        time: { created: 2, completed: 4 },
      },
    ] satisfies SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.parts.get("msg_assistant")).toEqual([
      expect.objectContaining({
        type: "tool",
        tool: "edit",
        state: expect.objectContaining({
          status: "completed",
          input: expect.objectContaining({ path: "/repo/README.md", filePath: "/repo/README.md" }),
          metadata: expect.objectContaining({
            filediff: {
              file: "README.md",
              patch: "@@ -1 +1 @@\n-old\n+new",
              additions: 1,
              deletions: 1,
            },
          }),
        }),
      }),
    ])
  })

  test("projects the durable V2 tool shape returned after session reload", () => {
    const source = [
      { id: "msg_user", type: "user", text: "run pwd", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_bash",
            name: "bash",
            provider: { executed: false },
            state: {
              status: "completed",
              input: { command: "pwd" },
              structured: { exit: 0, truncated: false },
              content: [{ type: "text", text: "D:/repo" }],
              outputPaths: [],
            },
            time: { created: 2, ran: 3, completed: 4 },
          },
        ],
        time: { created: 2, completed: 4 },
      },
    ] as unknown as SessionMessageInfo[]

    const result = normalizeSessionMessages("ses_1", source)

    expect(result.parts.get("msg_assistant")).toEqual([
      expect.objectContaining({
        id: "call_bash",
        type: "tool",
        callID: "call_bash",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "pwd" },
          output: "D:/repo",
          title: "bash",
          metadata: { exit: 0, truncated: false },
          time: { start: 3, end: 4 },
        },
      }),
    ])
  })

  test("adapts current read and task fields for legacy tool cards", () => {
    const source = [
      { id: "msg_user", type: "user", text: "inspect", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_read",
            name: "read",
            state: {
              status: "completed",
              input: { path: "src/index.ts" },
              structured: { loaded: ["D:/repo/src/index.ts"] },
              content: [],
            },
            time: { created: 2, ran: 3, completed: 4 },
          },
          {
            type: "tool",
            id: "call_task",
            name: "task",
            state: {
              status: "completed",
              input: { description: "Inspect code", prompt: "Inspect", subagent_type: "explore" },
              structured: {
                title: "Inspect code",
                metadata: {
                  parentSessionId: "ses_parent",
                  sessionId: "ses_child",
                  agent: "explore",
                },
                output: "done",
              },
              content: [{ type: "text", text: "done" }],
            },
            time: { created: 5, ran: 6, completed: 7 },
          },
        ],
        time: { created: 2, completed: 7 },
      },
    ] as unknown as SessionMessageInfo[]

    const parts = normalizeSessionMessages("ses_1", source).parts.get("msg_assistant")

    expect(parts?.[0]).toMatchObject({
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "src/index.ts", filePath: "src/index.ts" },
        metadata: { loaded: ["D:/repo/src/index.ts"] },
      },
    })
    expect(parts?.[1]).toMatchObject({
      type: "tool",
      tool: "task",
      state: {
        status: "completed",
        title: "Inspect code",
        metadata: {
          sessionId: "ses_child",
          parentSessionId: "ses_parent",
          agent: "explore",
        },
      },
    })
  })
})

const msg = (id: string, created: number) =>
  ({ id, type: "system", text: "", time: { created } }) satisfies SessionMessageInfo

test("compareMessages orders numerically by time.created then by id", () => {
  expect(compareMessages(msg("a", 10), msg("b", 2))).toBeGreaterThan(0)
  expect(compareMessages(msg("a", 2), msg("b", 10))).toBeLessThan(0)
  expect(compareMessages(msg("a", 1), msg("b", 1))).toBeLessThan(0)
  expect(compareMessages(msg("b", 1), msg("a", 1))).toBeGreaterThan(0)
})

test("sliceAtBoundary slices by array position and preserves identity without a boundary", () => {
  const messages: SessionMessageInfo[] = [msg("z_shell", 1), msg("a", 2), msg("b", 3)]
  expect(sliceAtBoundary(messages, undefined)).toBe(messages)
  expect(sliceAtBoundary(messages, "missing")).toBe(messages)
  expect(sliceAtBoundary(messages, "b")).toEqual([msg("z_shell", 1), msg("a", 2)])
})
