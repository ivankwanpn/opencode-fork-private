export * as TranscriptRead from "./transcript-read"

import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionRead } from "@opencode-ai/server/session-read"
import { DateTime, Effect, Layer } from "effect"
import { Session } from "./session"

export const layer = Layer.effect(
  SessionRead.Service,
  Effect.gen(function* () {
    const legacy = yield* Session.Service
    const canonical = yield* SessionV2.Service

    const all = Effect.fn("TranscriptRead.all")(function* (sessionID: SessionSchema.ID) {
      yield* canonical.get(sessionID)
      const [current, retained, removed] = yield* Effect.all([
        canonical.messages({ sessionID, order: "asc" }),
        legacy.messages({ sessionID }).pipe(Effect.orDie),
        canonical.transcript.removedMessages(sessionID),
      ])
      const merged = new Map(
        project(retained)
          .filter((message) => !removed.has(message.id))
          .map((message) => [message.id, message]),
      )
      for (const message of current) merged.set(message.id, message)
      return Array.from(merged.values()).toSorted(compare)
    })

    const messages: SessionRead.Interface["messages"] = Effect.fn("TranscriptRead.messages")(function* (input) {
      const timeline = yield* all(input.sessionID)
      const ordered = input.order === "asc" ? timeline : timeline.toReversed()
      if (!input.cursor) return input.limit === undefined ? ordered : ordered.slice(0, input.limit)
      const index = ordered.findIndex((message) => message.id === input.cursor?.id)
      if (index < 0) return []
      if (input.cursor.direction === "next")
        return input.limit === undefined ? ordered.slice(index + 1) : ordered.slice(index + 1, index + 1 + input.limit)
      const start = input.limit === undefined ? 0 : Math.max(0, index - input.limit)
      return ordered.slice(start, index)
    })

    const message: SessionRead.Interface["message"] = Effect.fn("TranscriptRead.message")(function* (input) {
      const current = yield* canonical.message(input)
      if (current) return current
      if ((yield* canonical.transcript.removedMessages(input.sessionID).pipe(Effect.orDie)).has(input.messageID)) return
      const retained = yield* legacy
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.orDie)
      return project(retained).find((item) => item.id === input.messageID)
    })

    return SessionRead.Service.of({ messages, message })
  }),
)

export function project(messages: readonly SessionV1.WithParts[]): SessionMessage.Message[] {
  return messages.map((message) => (message.info.role === "user" ? user(message) : assistant(message)))
}

function user(message: SessionV1.WithParts): SessionMessage.User {
  const info = message.info as SessionV1.User
  const text = message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text]
      if (part.type === "subtask") return [part.prompt]
      if (part.type === "compaction") return ["What did we do so far?"]
      return []
    })
    .join("\n")
  const files = message.parts
    .filter((part): part is SessionV1.FilePart => part.type === "file")
    .map((part) => ({
      uri: part.url,
      mime: part.mime,
      name: part.filename,
      description: part.source?.type === "symbol" ? part.source.name : undefined,
      source: part.source
        ? { text: part.source.text.value, start: part.source.text.start, end: part.source.text.end }
        : undefined,
      resource:
        part.source?.type === "resource"
          ? { clientName: part.source.clientName, uri: part.source.uri }
          : undefined,
    }))
  const agents = message.parts
    .filter((part): part is SessionV1.AgentPart => part.type === "agent")
    .map((part) => ({
      name: part.name,
      source: part.source
        ? { text: part.source.value, start: part.source.start, end: part.source.end }
        : undefined,
    }))
  const format =
    info.format?.type === "json_schema"
      ? { type: "json_schema" as const, schema: info.format.schema, retryCount: info.format.retryCount }
      : info.format?.type === "text"
        ? { type: "text" as const }
        : undefined
  return {
    id: id(info.id),
    type: "user",
    text,
    files: files.length > 0 ? files : undefined,
    agents: agents.length > 0 ? agents : undefined,
    system: info.system,
    tools: info.tools,
    format,
    metadata: { legacy: message },
    time: { created: DateTime.makeUnsafe(info.time.created) },
  }
}

function assistant(message: SessionV1.WithParts): SessionMessage.Assistant {
  const info = message.info as SessionV1.Assistant
  const start = message.parts.find((part): part is SessionV1.StepStartPart => part.type === "step-start")
  const finish = message.parts.findLast((part): part is SessionV1.StepFinishPart => part.type === "step-finish")
  const content = message.parts.flatMap((part): SessionMessage.AssistantContent[] => {
    if (part.type === "text") return [{ type: "text", id: part.id, text: part.text }]
    if (part.type === "reasoning")
      return [
        {
          type: "reasoning",
          id: part.id,
          text: part.text,
          time: {
            created: DateTime.makeUnsafe(part.time.start),
            completed: part.time.end === undefined ? undefined : DateTime.makeUnsafe(part.time.end),
          },
        },
      ]
    if (part.type === "tool") return [tool(part, info.time.created)]
    return []
  })
  return {
    id: id(info.id),
    type: "assistant",
    agent: info.agent,
    model: {
      id: ModelV2.ID.make(info.modelID),
      providerID: ProviderV2.ID.make(info.providerID),
      variant: info.variant ? ModelV2.VariantID.make(info.variant) : undefined,
    },
    content,
    snapshot:
      start?.snapshot || finish?.snapshot
        ? { start: start?.snapshot, end: finish?.snapshot }
        : undefined,
    finish: info.finish ?? finish?.reason,
    structured: info.structured,
    cost: info.cost,
    tokens: {
      input: info.tokens.input,
      output: info.tokens.output,
      reasoning: info.tokens.reasoning,
      cache: { read: info.tokens.cache.read, write: info.tokens.cache.write },
    },
    error: legacyError(info.error),
    metadata: { legacy: message },
    time: {
      created: DateTime.makeUnsafe(info.time.created),
      completed: info.time.completed === undefined ? undefined : DateTime.makeUnsafe(info.time.completed),
    },
  }
}

function tool(part: SessionV1.ToolPart, created: number): SessionMessage.AssistantTool {
  const base = {
    type: "tool" as const,
    id: part.callID,
    name: part.tool,
    time: { created: DateTime.makeUnsafe(created) },
  }
  if (part.state.status === "pending")
    return { ...base, state: { status: "pending", input: part.state.raw } }
  if (part.state.status === "running")
    return {
      ...base,
      state: {
        status: "running",
        input: part.state.input,
        structured: structured(part.state.title, part.state.metadata),
        content: [],
      },
      time: { ...base.time, ran: DateTime.makeUnsafe(part.state.time.start) },
    }
  if (part.state.status === "completed")
    return {
      ...base,
      state: {
        status: "completed",
        input: part.state.input,
        structured: structured(part.state.title, part.state.metadata),
        content: [{ type: "text", text: part.state.output }],
        attachments: part.state.attachments?.map((attachment) => ({
          uri: attachment.url,
          mime: attachment.mime,
          name: attachment.filename,
        })),
      },
      time: {
        ...base.time,
        ran: DateTime.makeUnsafe(part.state.time.start),
        completed: DateTime.makeUnsafe(part.state.time.end),
        pruned:
          part.state.time.compacted === undefined ? undefined : DateTime.makeUnsafe(part.state.time.compacted),
      },
    }
  return {
    ...base,
    state: {
      status: "error",
      input: part.state.input,
      structured: structured(undefined, part.state.metadata),
      content: [],
      error: { type: "unknown", message: part.state.error },
    },
    time: {
      ...base.time,
      ran: DateTime.makeUnsafe(part.state.time.start),
      completed: DateTime.makeUnsafe(part.state.time.end),
    },
  }
}

function structured(title?: string, metadata?: Record<string, unknown>) {
  return { ...(metadata ?? {}), ...(title === undefined ? {} : { title }) }
}

function legacyError(error: SessionV1.Assistant["error"]): SessionMessage.UnknownError | undefined {
  if (!error) return undefined
  const data = error.data as Record<string, unknown>
  return {
    type: "unknown",
    message: typeof data.message === "string" ? data.message : error.name,
  }
}

function id(value: SessionV1.MessageID): SessionMessage.ID {
  return SessionMessage.ID.make(value.startsWith("msg_") ? value : `msg_legacy_${Buffer.from(value).toString("base64url")}`)
}

function compare(left: SessionMessage.Message, right: SessionMessage.Message) {
  return DateTime.toEpochMillis(left.time.created) - DateTime.toEpochMillis(right.time.created) || left.id.localeCompare(right.id)
}
