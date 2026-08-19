import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { ACPSession } from "./session"
import { ACPPermission } from "./permission"
import { partsToContentChunks, type ReplayPart } from "./content"
import {
  duplicateRunningToolUpdate,
  errorToolUpdate,
  pendingToolCall,
  runningToolUpdate,
  shellOutputSnapshot,
  completedToolUpdate,
} from "./tool"
import type { ACPClient } from "./client"

type Connection = Pick<AgentSideConnection, "sessionUpdate"> &
  Partial<Pick<AgentSideConnection, "requestPermission" | "writeTextFile">>

type CanonicalToolContent = Extract<
  ACPClient.NativeEvent,
  { type: "session.next.tool.progress" }
>["data"]["content"][number]

type CanonicalToolState = {
  readonly sessionID: string
  readonly messageID: string
  readonly callID: string
  name: string
  input: Record<string, unknown>
  structured: Record<string, unknown>
  content: readonly CanonicalToolContent[]
}

export function start(input: { client: ACPClient.Interface; connection: Connection; session: ACPSession.Interface }) {
  const subscription = new Subscription(input)
  subscription.start()
  return subscription
}

export class Subscription {
  private readonly abort = new AbortController()
  private readonly shellSnapshots = new Map<string, string>()
  private readonly toolStarts = new Set<string>()
  private readonly tools = new Map<string, CanonicalToolState>()
  private readonly permission: ACPPermission.Handler
  private started = false

  constructor(
    private readonly input: {
      client: ACPClient.Interface
      connection: Connection
      session: ACPSession.Interface
    },
  ) {
    this.permission = new ACPPermission.Handler(input)
  }

  start() {
    if (this.started) return
    this.started = true
    this.run().catch(() => {
      if (this.abort.signal.aborted) return
    })
  }

  stop() {
    this.abort.abort()
  }

  async handle(event: ACPClient.NativeEvent) {
    switch (event.type) {
      case "permission.v2.asked":
        this.permission.handle(event)
        return
      case "session.next.text.started":
        return this.recordCanonicalPart(event.data.sessionID, event.data.assistantMessageID, event.data.textID, "text")
      case "session.next.text.delta":
        return this.handleAssistantDelta(event.data, "agent_message_chunk")
      case "session.next.text.ended":
        return this.recordCanonicalPart(event.data.sessionID, event.data.assistantMessageID, event.data.textID, "text")
      case "session.next.reasoning.started":
        return this.recordCanonicalPart(
          event.data.sessionID,
          event.data.assistantMessageID,
          event.data.reasoningID,
          "reasoning",
          event.data.providerMetadata,
        )
      case "session.next.reasoning.delta":
        return this.handleAssistantDelta(event.data, "agent_thought_chunk")
      case "session.next.reasoning.ended":
        return this.recordCanonicalPart(
          event.data.sessionID,
          event.data.assistantMessageID,
          event.data.reasoningID,
          "reasoning",
          event.data.providerMetadata,
        )
      case "session.next.tool.input.started":
        return this.handleToolInputStarted(event)
      case "session.next.tool.input.ended":
        return this.handleToolInputEnded(event)
      case "session.next.tool.called":
        return this.handleToolCalled(event)
      case "session.next.tool.progress":
        return this.handleToolProgress(event)
      case "session.next.tool.success":
        return this.handleToolSuccess(event)
      case "session.next.tool.failed":
        return this.handleToolFailed(event)
    }
  }

  async replayMessage(message: ACPClient.LegacySessionMessage) {
    if (message.info.role !== "assistant" && message.info.role !== "user") return

    const cwd = message.info.role === "assistant" ? message.info.path?.cwd : undefined
    for (const part of message.parts) {
      await this.recordFetchedPart(message.info.sessionID, message, part)
      if (part.type === "tool") {
        await this.handleToolPart(message.info.sessionID, part, cwd ?? process.cwd())
        continue
      }
      await this.replayContentPart(message, part)
    }
  }

  private async replayContentPart(message: ACPClient.LegacySessionMessage, part: ACPClient.LegacyPart) {
    if (part.type !== "text" && part.type !== "file" && part.type !== "reasoning") return

    const sessionUpdate =
      part.type === "reasoning"
        ? "agent_thought_chunk"
        : message.info.role === "user"
          ? "user_message_chunk"
          : "agent_message_chunk"

    for (const chunk of partsToContentChunks([part as ReplayPart])) {
      await this.input.connection.sessionUpdate({
        sessionId: message.info.sessionID,
        update: {
          sessionUpdate,
          messageId: message.info.id,
          ...chunk,
        },
      })
    }
  }

  private async run() {
    while (!this.abort.signal.aborted) {
      for await (const event of this.input.client.events.subscribe({ signal: this.abort.signal })) {
        if (this.abort.signal.aborted) return
        await this.handle(event.payload).catch(() => {})
      }
      if (!this.abort.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  private async recordCanonicalPart(
    sessionID: string,
    messageID: string,
    partID: string,
    partType: "text" | "reasoning" | "tool",
    metadata?: unknown,
    toolCallID?: string,
  ) {
    const session = await Effect.runPromise(this.input.session.tryGet(sessionID))
    if (!session) return

    await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId: session.id,
        messageId: messageID,
        partId: partID,
        partType,
        role: "assistant",
        toolCallId: toolCallID,
        metadata,
      }),
    )
  }

  private async handleToolInputStarted(
    event: Extract<ACPClient.NativeEvent, { type: "session.next.tool.input.started" }>,
  ) {
    const session = await Effect.runPromise(this.input.session.tryGet(event.data.sessionID))
    if (!session) return
    const key = toolKey(event.data.sessionID, event.data.assistantMessageID, event.data.callID)
    const tool: CanonicalToolState = {
      sessionID: event.data.sessionID,
      messageID: event.data.assistantMessageID,
      callID: event.data.callID,
      name: event.data.name,
      input: {},
      structured: {},
      content: [],
    }
    this.tools.set(key, tool)
    this.shellSnapshots.delete(key)
    await this.recordCanonicalPart(tool.sessionID, tool.messageID, tool.callID, "tool", undefined, tool.callID)
  }

  private async handleToolInputEnded(event: Extract<ACPClient.NativeEvent, { type: "session.next.tool.input.ended" }>) {
    const tool = this.tools.get(toolKey(event.data.sessionID, event.data.assistantMessageID, event.data.callID))
    if (!tool) return
    tool.input = inputRecord(event.data.text)
    const session = await Effect.runPromise(this.input.session.tryGet(tool.sessionID))
    if (!session) return
    await this.canonicalToolStart(tool, session.cwd)
  }

  private async handleToolCalled(event: Extract<ACPClient.NativeEvent, { type: "session.next.tool.called" }>) {
    const session = await Effect.runPromise(this.input.session.tryGet(event.data.sessionID))
    if (!session) return
    const key = toolKey(event.data.sessionID, event.data.assistantMessageID, event.data.callID)
    const tool = this.tools.get(key) ?? {
      sessionID: event.data.sessionID,
      messageID: event.data.assistantMessageID,
      callID: event.data.callID,
      name: event.data.tool,
      input: {},
      structured: {},
      content: [],
    }
    this.tools.set(key, tool)
    tool.name = event.data.tool
    tool.input = { ...event.data.input }
    await this.recordCanonicalPart(tool.sessionID, tool.messageID, tool.callID, "tool", undefined, tool.callID)
    await this.canonicalToolStart(tool, session.cwd)
    await this.input.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        ...runningToolUpdate({
          toolCallId: tool.callID,
          toolName: tool.name,
          state: { status: "running", input: tool.input, title: tool.name },
          cwd: session.cwd,
        }),
      },
    })
  }

  private async handleToolProgress(event: Extract<ACPClient.NativeEvent, { type: "session.next.tool.progress" }>) {
    const key = toolKey(event.data.sessionID, event.data.assistantMessageID, event.data.callID)
    const tool = this.tools.get(key)
    if (!tool) return
    const session = await Effect.runPromise(this.input.session.tryGet(tool.sessionID))
    if (!session) return
    tool.structured = { ...event.data.structured }
    tool.content = event.data.content
    const output = toolOutput(tool.content)
    if (output !== undefined && this.shellSnapshots.get(key) === output) {
      await this.input.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: "tool_call_update",
          ...duplicateRunningToolUpdate({
            toolCallId: tool.callID,
            toolName: tool.name,
            state: {
              status: "running",
              input: tool.input,
              title: stringValue(tool.structured.title) ?? tool.name,
            },
            cwd: session.cwd,
          }),
        },
      })
      return
    }
    if (output !== undefined) this.shellSnapshots.set(key, output)
    await this.input.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        ...runningToolUpdate({
          toolCallId: tool.callID,
          toolName: tool.name,
          state: {
            status: "running",
            input: tool.input,
            title: stringValue(tool.structured.title) ?? tool.name,
          },
          output,
          cwd: session.cwd,
        }),
      },
    })
  }

  private async handleToolSuccess(event: Extract<ACPClient.NativeEvent, { type: "session.next.tool.success" }>) {
    const key = toolKey(event.data.sessionID, event.data.assistantMessageID, event.data.callID)
    const tool = this.tools.get(key)
    if (!tool) return
    const session = await Effect.runPromise(this.input.session.tryGet(tool.sessionID))
    if (!session) return
    tool.structured = { ...event.data.structured }
    tool.content = event.data.content
    this.clearTool(key)
    this.tools.delete(key)
    await this.input.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        ...completedToolUpdate({
          toolCallId: tool.callID,
          toolName: tool.name,
          state: {
            status: "completed",
            input: tool.input,
            output: toolOutput(tool.content) ?? "",
            title: stringValue(tool.structured.title) ?? tool.name,
            metadata: tool.structured,
            attachments: tool.content.flatMap((content) =>
              content.type === "file" ? [{ mime: content.mime, url: content.uri }] : [],
            ),
          },
          cwd: session.cwd,
        }),
      },
    })
  }

  private async handleToolFailed(event: Extract<ACPClient.NativeEvent, { type: "session.next.tool.failed" }>) {
    const key = toolKey(event.data.sessionID, event.data.assistantMessageID, event.data.callID)
    const tool = this.tools.get(key)
    if (!tool) return
    const session = await Effect.runPromise(this.input.session.tryGet(tool.sessionID))
    if (!session) return
    this.clearTool(key)
    this.tools.delete(key)
    await this.input.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "tool_call_update",
        ...errorToolUpdate({
          toolCallId: tool.callID,
          toolName: tool.name,
          state: {
            status: "error",
            input: tool.input,
            error: errorMessage(event.data.error),
            metadata: event.data.result,
          },
          cwd: session.cwd,
        }),
      },
    })
  }

  private async canonicalToolStart(tool: CanonicalToolState, cwd: string) {
    const key = toolKey(tool.sessionID, tool.messageID, tool.callID)
    if (this.toolStarts.has(key)) return
    this.toolStarts.add(key)
    await this.input.connection.sessionUpdate({
      sessionId: tool.sessionID,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: tool.callID,
          toolName: tool.name,
          state: { input: tool.input, title: tool.name },
          cwd,
        }),
      },
    })
  }

  private async handleAssistantDelta(
    props: {
      readonly sessionID: string
      readonly assistantMessageID: string
      readonly delta: string
    },
    sessionUpdate: "agent_message_chunk" | "agent_thought_chunk",
  ) {
    const session = await Effect.runPromise(this.input.session.tryGet(props.sessionID))
    if (!session) return
    await this.input.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate,
        messageId: props.assistantMessageID,
        content: { type: "text", text: props.delta },
      },
    })
  }

  private async recordFetchedPart(
    sessionId: string,
    message: ACPClient.LegacySessionMessage,
    part: ACPClient.LegacyPart,
  ) {
    return await Effect.runPromise(
      this.input.session.recordPartMetadata({
        sessionId,
        messageId: part.messageID,
        partId: part.id,
        partType: part.type,
        role: message.info.role,
        ignored: part.type === "text" ? part.ignored : undefined,
        toolCallId: part.type === "tool" ? part.callID : undefined,
        metadata: "metadata" in part ? part.metadata : undefined,
      }),
    )
  }

  private async handleToolPart(sessionId: string, part: ACPClient.LegacyToolPart, cwd: string) {
    const key = toolKey(sessionId, part.messageID, part.callID)
    if (part.state.status === "pending" || part.state.status === "running") {
      const metadata = part.state.status === "running" ? recordValue(part.state.metadata) : {}
      const output = part.state.status === "running" ? shellOutputSnapshot(part.state) : undefined
      this.tools.set(key, {
        sessionID: sessionId,
        messageID: part.messageID,
        callID: part.callID,
        name: part.tool,
        input: { ...part.state.input },
        structured: metadata,
        content: output === undefined ? [] : [{ type: "text", text: output }],
      })
    }
    await this.toolStart(sessionId, part, cwd)

    switch (part.state.status) {
      case "pending":
        this.shellSnapshots.delete(key)
        return

      case "running":
        await this.runningTool(sessionId, part, cwd)
        return

      case "completed":
        this.clearTool(key)
        this.tools.delete(key)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...completedToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
        })
        return

      case "error":
        this.clearTool(key)
        this.tools.delete(key)
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...errorToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
        })
        return
    }
  }

  private async runningTool(sessionId: string, part: ACPClient.LegacyToolPart, cwd: string) {
    if (part.state.status !== "running") return

    const key = toolKey(sessionId, part.messageID, part.callID)
    const output = part.tool === "bash" ? shellOutputSnapshot(part.state) : undefined
    if (output !== undefined) {
      if (this.shellSnapshots.get(key) === output) {
        await this.input.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            ...duplicateRunningToolUpdate({
              toolCallId: part.callID,
              toolName: part.tool,
              state: part.state,
              cwd,
            }),
          },
        })
        return
      }
      this.shellSnapshots.set(key, output)
    }

    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        ...runningToolUpdate({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
          output,
          cwd,
        }),
      },
    })
  }

  private async toolStart(sessionId: string, part: ACPClient.LegacyToolPart, cwd: string) {
    const key = toolKey(sessionId, part.messageID, part.callID)
    if (this.toolStarts.has(key)) return
    this.toolStarts.add(key)
    await this.input.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        ...pendingToolCall({
          toolCallId: part.callID,
          toolName: part.tool,
          state: part.state,
          cwd,
        }),
      },
    })
  }

  private clearTool(toolCallId: string) {
    this.toolStarts.delete(toolCallId)
    this.shellSnapshots.delete(toolCallId)
  }
}

function toolKey(sessionID: string, messageID: string, callID: string) {
  return `${sessionID}:${messageID}:${callID}`
}

function toolOutput(content: readonly CanonicalToolContent[]) {
  if (content.length === 0) return undefined
  const output = content.flatMap((item) => {
    if (item.type === "text") return [item.text]
    return item.mime.startsWith("image/") ? [] : [item.uri]
  })
  return output.length === 0 ? undefined : output.join("\n")
}

function inputRecord(value: string) {
  try {
    const input: unknown = JSON.parse(value)
    if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  } catch {
    return {}
  }
  return {}
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== "object") return String(error)
  if ("message" in error && typeof error.message === "string") return error.message
  if ("data" in error && error.data && typeof error.data === "object") {
    if ("message" in error.data && typeof error.data.message === "string") return error.data.message
  }
  if ("name" in error && typeof error.name === "string") return error.name
  return "Tool execution failed"
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function recordValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export * as ACPEvent from "./event"
