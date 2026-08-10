import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageShell,
  SessionMessageUser,
} from "@opencode-ai/client/promise"
import type { AssistantMessage, FilePart, Message, Part, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Option, Schema } from "effect"

const emptyTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const emptyModel: { id: string; providerID: string; variant?: string; protocol?: CustomProvider.Protocol } = {
  id: "",
  providerID: "",
}
const decodeToolInput = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function modelProtocol(value: object) {
  if (!("protocol" in value)) return
  const protocol = value.protocol
  if (
    protocol === "openai-responses" ||
    protocol === "openai-compatible" ||
    protocol === "anthropic-messages"
  )
    return protocol
}

function normalizeToolInput(name: string, input: Record<string, unknown>) {
  if (!["edit", "read", "write"].includes(name) || typeof input.path !== "string" || typeof input.filePath === "string")
    return input
  return { ...input, filePath: input.path }
}

function normalizeToolMetadata(name: string, metadata: Record<string, unknown>) {
  const normalized =
    name === "task" && record(metadata.metadata) ? { ...metadata, ...metadata.metadata } : metadata
  if (name !== "edit" || !Array.isArray(normalized.files)) return normalized
  const file = normalized.files.find(record)
  if (!file || typeof file.file !== "string") return normalized
  return {
    ...normalized,
    filediff: {
      file: file.file,
      patch: typeof file.patch === "string" ? file.patch : undefined,
      additions: typeof file.additions === "number" ? file.additions : 0,
      deletions: typeof file.deletions === "number" ? file.deletions : 0,
    },
  }
}

export function normalizeSessionMessages(sessionID: string, source: readonly SessionMessageInfo[]) {
  const messages: Message[] = []
  const parts = new Map<string, Part[]>()
  let agent = ""
  let model = emptyModel
  let parentID: string | undefined

  source.forEach((message) => {
    if (message.type === "agent-switched") {
      agent = message.agent
      return
    }
    if (message.type === "model-switched") {
      model = { ...message.model, protocol: modelProtocol(message.model) }
      return
    }
    if (message.type === "user") {
      parentID = message.id
      messages.push(userMessage(sessionID, message, agent, model))
      parts.set(message.id, userParts(sessionID, message))
      return
    }
    if (message.type === "synthetic" && message.description?.trim()) {
      parentID = message.id
      messages.push({
        id: message.id,
        sessionID,
        role: "user",
        time: message.time,
        agent,
        model: {
          providerID: model.providerID,
          modelID: model.id,
          variant: model.variant,
          protocol: model.protocol,
        },
      })
      parts.set(message.id, [textPart(sessionID, message.id, 0, message.description, true)])
      return
    }
    if (message.type === "shell") {
      messages.push(...shellMessages(sessionID, message, agent, model))
      parts.set(message.id, [textPart(sessionID, message.id, 0, message.command)])
      parts.set(`${message.id}:assistant`, [shellPart(sessionID, message)])
      parentID = undefined
      return
    }
    if (message.type === "assistant") {
      agent = message.agent
      model = { ...message.model, protocol: modelProtocol(message.model) }
      if (!parentID) return
      const parent = messages.findLast((item) => item.id === parentID)
      if (parent?.role === "user") {
        parent.agent = message.agent
        parent.model = {
          providerID: message.model.providerID,
          modelID: message.model.id,
          variant: message.model.variant,
          protocol: modelProtocol(message.model),
        }
      }
      messages.push(assistantMessage(sessionID, parentID, message))
      parts.set(message.id, assistantParts(sessionID, message))
      return
    }
    if (message.type !== "compaction" || message.status !== "completed" || !parentID) return
    parts.set(parentID, [
      ...(parts.get(parentID) ?? []),
      {
        id: `${message.id}:compaction`,
        sessionID,
        messageID: parentID,
        type: "compaction",
        auto: message.reason === "auto",
      },
    ])
  })

  return { messages, parts }
}

function shellMessages(
  sessionID: string,
  message: SessionMessageShell,
  agent: string,
  model: { id: string; providerID: string; variant?: string; protocol?: CustomProvider.Protocol },
): [UserMessage, AssistantMessage] {
  return [
    {
      id: message.id,
      sessionID,
      role: "user",
      time: { created: message.time.created },
      agent,
      model: {
        providerID: model.providerID,
        modelID: model.id,
        variant: model.variant,
        protocol: model.protocol,
      },
    },
    {
      id: `${message.id}:assistant`,
      sessionID,
      role: "assistant",
      time: message.time,
      parentID: message.id,
      modelID: model.id,
      providerID: model.providerID,
      variant: model.variant,
      mode: agent,
      agent,
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: emptyTokens,
    },
  ]
}

function shellPart(sessionID: string, message: SessionMessageShell): ToolPart {
  const input = { command: message.command }
  const start = message.time.created
  const state: ToolPart["state"] =
    message.status === "running"
      ? { status: "running", input, time: { start } }
      : {
          status: "completed",
          input,
          output: message.output?.output ?? "",
          title: "Shell",
          metadata: {
            status: message.status,
            exit: message.exit,
            truncated: message.output?.truncated,
          },
          time: { start, end: message.time.completed ?? start },
        }
  return {
    id: `${message.id}:tool`,
    sessionID,
    messageID: `${message.id}:assistant`,
    type: "tool",
    callID: message.shellID,
    tool: "bash",
    state,
  }
}

export function sessionMessagePartID(messageID: string, type: "text" | "reasoning", ordinal: number) {
  return `${messageID}:${type}:${ordinal}`
}

function userMessage(
  sessionID: string,
  message: SessionMessageUser,
  agent: string,
  model: { id: string; providerID: string; variant?: string; protocol?: CustomProvider.Protocol },
): UserMessage {
  return {
    id: message.id,
    sessionID,
    role: "user",
    time: message.time,
    agent,
    model: {
      providerID: model.providerID,
      modelID: model.id,
      variant: model.variant,
      protocol: model.protocol,
    },
  }
}

function userParts(sessionID: string, message: SessionMessageUser): Part[] {
  return [
    textPart(sessionID, message.id, 0, message.text),
    ...(message.files ?? []).map(
      (file, index): FilePart => {
        const mention = attachmentMention(file)
        return {
          id: `${message.id}:file:${index}`,
          sessionID,
          messageID: message.id,
          type: "file",
          mime: file.mime,
          filename: file.name,
          url: attachmentURL(file, file.mime),
          source: mention
            ? {
                type: "file",
                text: { value: mention.text, start: mention.start, end: mention.end },
                path: mention.text.startsWith("@") ? mention.text.slice(1) : (file.name ?? mention.text),
              }
            : undefined,
        }
      },
    ),
    ...(message.agents ?? []).map(
      (item, index): Part => {
        const mention = attachmentMention(item)
        return {
          id: `${message.id}:agent:${index}`,
          sessionID,
          messageID: message.id,
          type: "agent",
          name: item.name,
          source: mention ? { value: mention.text, start: mention.start, end: mention.end } : undefined,
        }
      },
    ),
  ]
}

function attachmentURL(file: object, mime: string) {
  if ("uri" in file && typeof file.uri === "string") return file.uri
  if (
    "source" in file &&
    record(file.source) &&
    file.source.type === "uri" &&
    typeof file.source.uri === "string"
  )
    return file.source.uri
  if ("data" in file && typeof file.data === "string") return `data:${mime};base64,${file.data}`
  return ""
}

function attachmentMention(value: object) {
  if ("source" in value) {
    const source = mentionSource(value.source)
    if (source) return source
  }
  if (!("mention" in value)) return
  return mentionSource(value.mention)
}

function mentionSource(value: unknown) {
  if (!record(value)) return
  if (typeof value.text !== "string" || typeof value.start !== "number" || typeof value.end !== "number") return
  return { text: value.text, start: value.start, end: value.end }
}

function assistantMessage(sessionID: string, parentID: string, message: SessionMessageAssistant): AssistantMessage {
  const error = message.error
    ? message.error.type.toLowerCase().includes("abort") || message.error.type.toLowerCase().includes("interrupt")
      ? { name: "MessageAbortedError" as const, data: { message: message.error.message } }
      : { name: "UnknownError" as const, data: { message: message.error.message } }
    : undefined
  return {
    id: message.id,
    sessionID,
    role: "assistant",
    time: message.time,
    error,
    parentID,
    modelID: message.model.id,
    providerID: message.model.providerID,
    variant: message.model.variant,
    mode: message.agent,
    agent: message.agent,
    path: { cwd: "", root: "" },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? emptyTokens,
    finish: message.finish,
  }
}

function assistantParts(sessionID: string, message: SessionMessageAssistant): Part[] {
  const ordinals = { text: 0, reasoning: 0 }
  return message.content.flatMap((content): Part[] => {
    if (content.type === "text") {
      const part = textPart(sessionID, message.id, ordinals.text++, content.text)
      return content.text.trim() ? [part] : []
    }
    if (content.type === "reasoning") {
      const part: Part = {
        id: sessionMessagePartID(message.id, "reasoning", ordinals.reasoning++),
        sessionID,
        messageID: message.id,
        type: "reasoning",
        text: content.text,
        metadata: content.state,
        time: {
          start: content.time?.created ?? message.time.created,
          end: content.time?.completed,
        },
      }
      return content.text.trim() ? [part] : []
    }
    return [toolPart(sessionID, message.id, content)]
  })
}

function textPart(sessionID: string, messageID: string, ordinal: number, text: string, synthetic?: boolean): Part {
  return {
    id: sessionMessagePartID(messageID, "text", ordinal),
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic,
  }
}

function toolPart(sessionID: string, messageID: string, tool: SessionMessageAssistantTool): ToolPart {
  const start = tool.time.ran ?? tool.time.created
  const state = (() => {
    if (tool.state.status === "streaming") {
      const value = Option.getOrUndefined(decodeToolInput(tool.state.input))
      const input = normalizeToolInput(tool.name, record(value) ? value : {})
      return { status: "pending" as const, input, raw: tool.state.input }
    }
    if (tool.state.status === "running") {
      return {
        status: "running" as const,
        input: normalizeToolInput(tool.name, tool.state.input),
        metadata: normalizeToolMetadata(tool.name, tool.state.structured),
        time: { start },
      }
    }
    if (tool.state.status === "error") {
      return {
        status: "error" as const,
        input: normalizeToolInput(tool.name, tool.state.input),
        error: tool.state.error.message,
        metadata: normalizeToolMetadata(tool.name, tool.state.structured),
        time: { start, end: tool.time.completed ?? start },
      }
    }
    const attachments = tool.state.content.flatMap((item, index): FilePart[] =>
      item.type === "file"
        ? [
            {
              id: `${tool.id}:file:${index}`,
              sessionID,
              messageID,
              type: "file",
              mime: item.mime,
              filename: item.name,
              url: item.uri,
            },
          ]
        : [],
    )
    return {
      status: "completed" as const,
      input: normalizeToolInput(tool.name, tool.state.input),
      output: tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n"),
      title: typeof tool.state.structured.title === "string" ? tool.state.structured.title : tool.name,
      metadata: normalizeToolMetadata(tool.name, tool.state.structured),
      time: { start, end: tool.time.completed ?? start },
      attachments: attachments.length ? attachments : undefined,
    }
  })()
  return {
    id: tool.id,
    sessionID,
    messageID,
    type: "tool",
    callID: tool.id,
    tool: tool.name,
    state,
    metadata: { providerState: tool.providerState, providerResultState: tool.providerResultState },
  }
}
