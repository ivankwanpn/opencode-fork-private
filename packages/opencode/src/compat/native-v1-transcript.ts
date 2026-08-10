import { AssistantErrorCodec } from "@opencode-ai/core/session/assistant-error-codec"
import type {
  AssistantMessage,
  Message,
  Part,
  Session,
  SessionMessage,
  SessionV2Info,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk/v2"

type NativeMessage = SessionMessage
type NativeSession = SessionV2Info
type LegacyMessage = { info: Message; parts: Part[] }

const CONTENT_FILTER_ERROR_MESSAGE = "Response blocked by content filter"

function partID(messageID: string, suffix: string) {
  return `prt_${messageID.replace(/^msg_/, "")}_${suffix}`
}

function original(message: NativeMessage) {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== "object") return undefined
  const legacy = Reflect.get(metadata, "legacy")
  if (!legacy || typeof legacy !== "object") return undefined
  const info = Reflect.get(legacy, "info")
  const parts = Reflect.get(legacy, "parts")
  if (!info || typeof info !== "object" || !Array.isArray(parts)) return undefined
  if (Reflect.get(info, "role") !== "user" && Reflect.get(info, "role") !== "assistant") return undefined
  return legacy as LegacyMessage
}

function retained(input: {
  message: NativeMessage
  sessionID: string
  ids: Map<string, string>
  parentID?: string
}): LegacyMessage | undefined {
  const legacy = original(input.message)
  if (!legacy) return undefined
  const info = structuredClone(legacy.info)
  const oldID = info.id
  info.id = input.message.id
  info.sessionID = input.sessionID
  if (info.role === "assistant") info.parentID = input.ids.get(info.parentID) ?? input.parentID ?? info.parentID
  const parts = structuredClone(legacy.parts).map((part) => ({
    ...part,
    sessionID: input.sessionID,
    messageID: input.message.id,
    ...(part.type === "tool" && part.state.status === "completed" && part.state.attachments
      ? {
          state: {
            ...part.state,
            attachments: part.state.attachments.map((attachment) => ({
              ...attachment,
              sessionID: input.sessionID,
              messageID: input.message.id,
            })),
          },
        }
      : {}),
  })) as Part[]
  input.ids.set(oldID, input.message.id)
  return { info, parts }
}

function user(input: {
  message: Extract<NativeMessage, { type: "user" }>
  session: NativeSession
  agent: string
  model: { id: string; providerID: string; variant?: string }
}): LegacyMessage {
  const message = input.message
  const info: UserMessage = {
    id: message.id,
    sessionID: input.session.id,
    role: "user",
    time: { created: message.time.created },
    agent: input.agent,
    model: {
      modelID: input.model.id,
      providerID: input.model.providerID,
      variant: input.model.variant,
    },
    system: message.system,
    tools: message.tools ? { ...message.tools } : undefined,
    format: message.format,
  }
  const parts: Part[] = [
    {
      id: partID(message.id, "text"),
      sessionID: input.session.id,
      messageID: message.id,
      type: "text",
      text: message.text,
    },
    ...(message.context ?? []).map(
      (context, index): Part => ({
        id: partID(message.id, `context_${index}`),
        sessionID: input.session.id,
        messageID: message.id,
        type: "text",
        text: context.text,
        synthetic: true,
        metadata: context.metadata,
      }),
    ),
  ]
  for (const [index, file] of (message.files ?? []).entries()) {
    parts.push({
      id: partID(message.id, `file_${index}`),
      sessionID: input.session.id,
      messageID: message.id,
      type: "file",
      mime: file.mime,
      filename: file.name,
      url: file.uri,
      source: file.resource
        ? {
            type: "resource",
            clientName: file.resource.clientName,
            uri: file.resource.uri,
            text: file.source
              ? { value: file.source.text, start: file.source.start, end: file.source.end }
              : { value: "", start: 0, end: 0 },
          }
        : file.source
          ? {
              type: "file",
              path: file.uri,
              text: { value: file.source.text, start: file.source.start, end: file.source.end },
            }
          : undefined,
    })
  }
  for (const [index, agent] of (message.agents ?? []).entries()) {
    parts.push({
      id: partID(message.id, `agent_${index}`),
      sessionID: input.session.id,
      messageID: message.id,
      type: "agent",
      name: agent.name,
      source: agent.source ? { value: agent.source.text, start: agent.source.start, end: agent.source.end } : undefined,
    })
  }
  return { info, parts }
}

function toolPart(input: {
  messageID: string
  sessionID: string
  created: number
  tool: Extract<Extract<NativeMessage, { type: "assistant" }>["content"][number], { type: "tool" }>
}): ToolPart {
  const item = input.tool
  const base = {
    id: partID(input.messageID, `tool_${item.id}`),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool" as const,
    callID: item.id,
    tool: item.name,
  }
  if (item.state.status === "pending")
    return { ...base, state: { status: "pending", input: {}, raw: item.state.input } }
  const started = item.time.ran ?? item.time.created ?? input.created
  if (item.state.status === "running")
    return {
      ...base,
      state: {
        status: "running",
        input: { ...item.state.input },
        title: typeof item.state.structured.title === "string" ? item.state.structured.title : undefined,
        metadata: { ...item.state.structured },
        time: { start: started },
      },
    }
  if (item.state.status === "completed")
    return {
      ...base,
      state: {
        status: "completed",
        input: { ...item.state.input },
        output: item.state.content.map((content) => (content.type === "text" ? content.text : content.uri)).join("\n"),
        title: typeof item.state.structured.title === "string" ? item.state.structured.title : "",
        metadata: { ...item.state.structured },
        time: {
          start: started,
          end: item.time.completed ?? started,
          compacted: item.time.pruned,
        },
        attachments: item.state.attachments?.map((attachment, index) => ({
          id: partID(input.messageID, `tool_${item.id}_attachment_${index}`),
          sessionID: input.sessionID,
          messageID: input.messageID,
          type: "file",
          mime: attachment.mime,
          filename: attachment.name,
          url: attachment.uri,
        })),
      },
    }
  return {
    ...base,
    state: {
      status: "error",
      input: { ...item.state.input },
      error: item.state.error.message,
      metadata: { ...item.state.structured },
      time: { start: started, end: item.time.completed ?? started },
    },
  }
}

function assistantError(message: Extract<NativeMessage, { type: "assistant" }>): AssistantMessage["error"] {
  if (message.finish === "length") return { name: "MessageOutputLengthError", data: {} }
  const error = message.error ? AssistantErrorCodec.decode(message.error.message) : undefined
  if (message.finish === "content-filter")
    return {
      name: "ContentFilterError",
      data: { message: error?.message ?? CONTENT_FILTER_ERROR_MESSAGE },
    }
  if (!error) return undefined
  if (error.kind === "authentication")
    return {
      name: "ProviderAuthError",
      data: {
        providerID: message.model.providerID,
        message: error.message,
      },
    }
  if (error.message === "Provider turn interrupted")
    return { name: "MessageAbortedError", data: { message: error.message } }
  return { name: "UnknownError", data: { message: error.message } }
}

function assistant(input: {
  message: Extract<NativeMessage, { type: "assistant" }>
  session: NativeSession
  parentID: string
}): LegacyMessage {
  const message = input.message
  const info: AssistantMessage = {
    id: message.id,
    sessionID: input.session.id,
    role: "assistant",
    time: { created: message.time.created, completed: message.time.completed },
    parentID: input.parentID,
    modelID: message.model.id,
    providerID: message.model.providerID,
    variant: message.model.variant,
    mode: message.agent,
    agent: message.agent,
    path: { cwd: input.session.location.directory, root: input.session.location.directory },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    structured: message.structured,
    finish: message.finish,
    error: assistantError(message),
  }
  const parts: Part[] = []
  if (message.snapshot?.start)
    parts.push({
      id: partID(message.id, "step_start"),
      sessionID: input.session.id,
      messageID: message.id,
      type: "step-start",
      snapshot: message.snapshot.start,
    })
  for (const content of message.content) {
    if (content.type === "text")
      parts.push({
        id: content.id,
        sessionID: input.session.id,
        messageID: message.id,
        type: "text",
        text: content.text,
      })
    if (content.type === "reasoning")
      parts.push({
        id: content.id,
        sessionID: input.session.id,
        messageID: message.id,
        type: "reasoning",
        text: content.text,
        metadata: content.providerMetadata,
        time: {
          start: content.time?.created ?? message.time.created,
          end: content.time?.completed,
        },
      })
    if (content.type === "tool")
      parts.push(
        toolPart({
          messageID: message.id,
          sessionID: input.session.id,
          created: message.time.created,
          tool: content,
        }),
      )
  }
  if (message.finish || message.snapshot?.end)
    parts.push({
      id: partID(message.id, "step_finish"),
      sessionID: input.session.id,
      messageID: message.id,
      type: "step-finish",
      reason: message.finish ?? "stop",
      snapshot: message.snapshot?.end,
      cost: message.cost ?? 0,
      tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
  return { info, parts }
}

function syntheticUser(input: {
  id: string
  session: NativeSession
  created: number
  text?: string
  description?: string
  compaction?: boolean
  agent: string
  model: { id: string; providerID: string; variant?: string }
}): LegacyMessage {
  return {
    info: {
      id: input.id,
      sessionID: input.session.id,
      role: "user",
      time: { created: input.created },
      agent: input.agent,
      model: {
        modelID: input.model.id,
        providerID: input.model.providerID,
        variant: input.model.variant,
      },
    },
    parts: input.compaction
      ? [
          {
            id: partID(input.id, "compaction"),
            sessionID: input.session.id,
            messageID: input.id,
            type: "compaction",
            auto: true,
          },
        ]
      : [
          {
            id: partID(input.id, "text"),
            sessionID: input.session.id,
            messageID: input.id,
            type: "text",
            text: [input.description, input.text].filter(Boolean).join("\n\n"),
            synthetic: true,
          },
        ],
  }
}

export function legacyTranscriptFromNative(input: {
  messages: readonly NativeMessage[]
  session: NativeSession
}): LegacyMessage[] {
  let agent = input.session.agent ?? "build"
  let model = input.session.model ?? { id: "unknown", providerID: "unknown" }
  let parentID: string | undefined
  const ids = new Map<string, string>()
  for (const message of input.messages) {
    const legacy = original(message)
    if (legacy) ids.set(legacy.info.id, message.id)
  }
  const result: LegacyMessage[] = []
  for (const message of input.messages) {
    if (message.type === "agent-switched") {
      agent = message.agent
      continue
    }
    if (message.type === "model-switched") {
      model = message.model
      continue
    }
    const old = retained({ message, sessionID: input.session.id, ids, parentID })
    if (old) {
      result.push(old)
      if (old.info.role === "user") parentID = old.info.id
      if (old.info.role === "assistant") {
        agent = old.info.agent
        model = { id: old.info.modelID, providerID: old.info.providerID, variant: old.info.variant }
      }
      continue
    }
    if (message.type === "user") {
      const item = user({ message, session: input.session, agent, model })
      result.push(item)
      parentID = item.info.id
      continue
    }
    if (message.type === "assistant") {
      if (!parentID) continue
      result.push(assistant({ message, session: input.session, parentID }))
      agent = message.agent
      model = message.model
      continue
    }
    if (message.type === "shell") {
      const shellUser = syntheticUser({
        id: `msg_shell_user_${message.id.replace(/^msg_/, "")}`,
        session: input.session,
        created: message.time.created,
        text: "The following tool was executed by the user",
        agent,
        model,
      })
      result.push(shellUser)
      parentID = shellUser.info.id
      const shellAssistant: AssistantMessage = {
        id: message.id,
        sessionID: input.session.id,
        role: "assistant",
        time: message.time,
        parentID,
        modelID: model.id,
        providerID: model.providerID,
        variant: model.variant,
        mode: agent,
        agent,
        path: { cwd: input.session.location.directory, root: input.session.location.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      const shellPart: ToolPart = {
        id: partID(message.id, "shell"),
        sessionID: input.session.id,
        messageID: message.id,
        type: "tool",
        callID: message.callID,
        tool: "shell",
        state: message.time.completed
          ? {
              status: "completed",
              input: { command: message.command },
              output: message.output,
              title: "",
              metadata: { output: message.output },
              time: { start: message.time.created, end: message.time.completed },
            }
          : {
              status: "running",
              input: { command: message.command },
              metadata: { output: message.output },
              time: { start: message.time.created },
            },
      }
      result.push({ info: shellAssistant, parts: [shellPart] })
      continue
    }
    if (message.type === "compaction") {
      const item = syntheticUser({
        id: message.id,
        session: input.session,
        created: message.time.created,
        compaction: true,
        agent,
        model,
      })
      result.push(item)
      parentID = item.info.id
      continue
    }
    if (message.type === "synthetic" || message.type === "system") {
      const item = syntheticUser({
        id: message.id,
        session: input.session,
        created: message.time.created,
        text: message.text,
        description: message.type === "synthetic" ? message.description : undefined,
        agent,
        model,
      })
      result.push(item)
      parentID = item.info.id
    }
  }
  return result
}

export * as NativeV1Transcript from "./native-v1-transcript"
