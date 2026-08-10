import { describe, expect, test } from "bun:test"
import { formatAssistantHeader, formatMessage, formatPart, formatTranscript } from "../../src/util/transcript"
import type {
  ModelV2Info,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/sdk/v2"

const models: ModelV2Info[] = [
  {
    id: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    api: {
      id: "claude-sonnet-4-20250514",
      type: "aisdk",
      package: "@ai-sdk/anthropic",
      url: "https://example.com/claude-sonnet-4-20250514",
    },
    name: "Claude Sonnet 4",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      tools: true,
      input: ["text", "image", "pdf"],
      output: ["text"],
      interleaved: false,
    },
    request: { headers: {}, body: {} },
    variants: [],
    time: { released: Date.UTC(2025, 4, 14) },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    limit: { context: 200_000, output: 8_192 },
    status: "active",
    enabled: true,
  },
]

const options = { thinking: true, toolDetails: true, assistantMetadata: true, models }

function assistant(content: SessionMessageAssistant["content"] = []): SessionMessageAssistant {
  return {
    id: "msg_assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "anthropic", id: "claude-sonnet-4-20250514" },
    content,
    time: { created: 1_000_000, completed: 1_005_400 },
  }
}

function completedTool(): SessionMessageAssistantTool {
  return {
    id: "call_1",
    type: "tool",
    name: "bash",
    time: { created: 1_000, ran: 1_010, completed: 1_100 },
    state: {
      status: "completed",
      input: { command: "ls" },
      structured: { title: "List files" },
      content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
    },
  }
}

describe("transcript", () => {
  describe("formatAssistantHeader", () => {
    test("includes native agent, model, and duration metadata", () => {
      expect(formatAssistantHeader(assistant(), true)).toBe(
        "## Assistant (Build - claude-sonnet-4-20250514 - 5.4s)\n\n",
      )
      expect(formatAssistantHeader(assistant(), true, models)).toBe("## Assistant (Build - Claude Sonnet 4 - 5.4s)\n\n")
    })

    test("can omit metadata", () => {
      expect(formatAssistantHeader(assistant(), false)).toBe("## Assistant\n\n")
    })

    test("handles an active assistant turn", () => {
      expect(formatAssistantHeader({ ...assistant(), time: { created: 1_000_000 } }, true)).toBe(
        "## Assistant (Build - claude-sonnet-4-20250514)\n\n",
      )
    })
  })

  describe("formatPart", () => {
    test("formats text and optional reasoning", () => {
      expect(formatPart({ id: "text_1", type: "text", text: "Hello world" }, options)).toBe("Hello world\n\n")
      const reasoning = { id: "reasoning_1", type: "reasoning" as const, text: "Let me think..." }
      expect(formatPart(reasoning, options)).toBe("_Thinking:_\n\nLet me think...\n\n")
      expect(formatPart(reasoning, { ...options, thinking: false })).toBe("")
    })

    test("formats canonical tool input and text content", () => {
      const result = formatPart(completedTool(), options)
      expect(result).toContain("**Tool: bash**")
      expect(result).toContain('"command": "ls"')
      expect(result).toContain("**Output:**")
      expect(result).toContain("file1.txt")
    })

    test("omits tool details when disabled", () => {
      const result = formatPart(completedTool(), { ...options, toolDetails: false })
      expect(result).toContain("**Tool: bash**")
      expect(result).not.toContain("**Input:**")
      expect(result).not.toContain("**Output:**")
    })

    test("formats canonical tool errors", () => {
      const tool: SessionMessageAssistantTool = {
        ...completedTool(),
        state: {
          status: "error",
          input: { command: "invalid" },
          structured: {},
          content: [],
          error: { type: "unknown", message: "Command failed" },
        },
      }
      expect(formatPart(tool, options)).toContain("**Error:**\n```\nCommand failed")
    })
  })

  describe("formatMessage", () => {
    test("formats canonical user text", () => {
      const message: SessionMessageUser = {
        id: "msg_user",
        type: "user",
        text: "Hello",
        time: { created: 1_000_000 },
      }
      expect(formatMessage(message, options)).toBe("## User\n\nHello\n\n")
    })

    test("formats canonical assistant content", () => {
      const result = formatMessage(assistant([{ id: "text_1", type: "text", text: "Hi there" }]), options)
      expect(result).toContain("## Assistant (Build - Claude Sonnet 4 - 5.4s)")
      expect(result).toContain("Hi there")
    })
  })

  describe("formatTranscript", () => {
    const session = {
      id: "ses_abc123",
      title: "Test Session",
      time: { created: 1_000_000_000_000, updated: 1_000_000_001_000 },
    }

    test("sorts and formats native timeline messages", () => {
      const messages: SessionMessage[] = [
        { ...assistant([{ id: "text_1", type: "text", text: "Hi!" }]), time: { created: 200, completed: 700 } },
        { id: "msg_user", type: "user", text: "Hello", time: { created: 100 } },
        {
          id: "msg_compaction",
          type: "compaction",
          reason: "auto",
          summary: "summary",
          recent: "recent",
          time: { created: 300 },
        },
        {
          id: "msg_shell",
          type: "shell",
          callID: "shell_1",
          command: "pwd",
          output: "/test",
          time: { created: 400, completed: 500 },
        },
      ]
      const result = formatTranscript(session, messages, options)

      expect(result).toContain("# Test Session")
      expect(result).toContain("**Session ID:** ses_abc123")
      expect(result.indexOf("## User")).toBeLessThan(result.indexOf("## Assistant"))
      expect(result).toContain("## Assistant (Build - Claude Sonnet 4 - 0.5s)")
      expect(result).toContain("## Compaction")
      expect(result).toContain("## Shell\n\n```sh\n$ pwd")
      expect(result).toContain("```text\n/test")
    })

    test("skips non-transcript state messages", () => {
      const messages: SessionMessage[] = [
        { id: "agent_1", type: "agent-switched", agent: "plan", time: { created: 1 } },
        { id: "system_1", type: "system", text: "hidden system context", time: { created: 2 } },
      ]
      const result = formatTranscript(session, messages, options)
      expect(result).not.toContain("hidden system context")
      expect(result).not.toContain("Plan")
    })
  })
})
