import { SessionID, MessageID, PartID } from "./schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionMessage } from "@opencode-ai/core/session/message"
import type { SessionSchema } from "@opencode-ai/core/session/schema"
import {
  APIError,
  AbortedError,
  Assistant,
  AuthError,
  CompactionPart,
  ContextOverflowError,
  Info,
  OutputLengthError,
  Part,
  SubtaskPart,
  User,
  WithParts,
} from "@opencode-ai/core/v1/session"

import { NamedError } from "@opencode-ai/core/util/error"
import { APICallError, convertToModelMessages, LoadAPIKeyError, type ModelMessage, type UIMessage } from "ai"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { NotFoundError } from "@/storage/storage"
import { and } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lt } from "drizzle-orm"
import { or } from "drizzle-orm"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ProviderError } from "@/provider/error"
import { iife } from "@/util/iife"
import { errorMessage } from "@/util/error"
import { isMedia } from "@/util/media"
import type { SystemError } from "bun"
import type { Provider } from "@/provider/provider"
import { DateTime, Effect, Schema } from "effect"

/** Error shape thrown by Bun's fetch() when gzip/br decompression fails mid-stream */
interface FetchDecompressionError extends Error {
  code: "ZlibError"
  errno: number
  path: string
}

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached media from tool result:"
export { isMedia }

function truncateToolOutput(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`
}

export const Event = {
  Updated: SessionV1.Event.MessageUpdated,
  Removed: SessionV1.Event.MessageRemoved,
  PartUpdated: SessionV1.Event.PartUpdated,
  PartDelta: SessionV1.Event.PartDelta,
  PartRemoved: SessionV1.Event.PartRemoved,
}

const Cursor = Schema.Struct({
  id: MessageID,
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})
type Cursor = typeof Cursor.Type

const decodeCursor = Schema.decodeUnknownSync(Cursor)

export const cursor = {
  encode(input: Cursor) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const info = (row: typeof MessageTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as Info

const part = (row: typeof PartTable.$inferSelect) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Part

const older = (row: Cursor) =>
  or(lt(MessageTable.time_created, row.time), and(eq(MessageTable.time_created, row.time), lt(MessageTable.id, row.id)))

function hydrate(db: Database.Interface["db"], rows: (typeof MessageTable.$inferSelect)[]) {
  const ids = rows.map((row) => row.id)
  const partByMessage = new Map<string, Part[]>()
  return Effect.gen(function* () {
    if (ids.length > 0) {
      const partRows = yield* db
        .select()
        .from(PartTable)
        .where(inArray(PartTable.message_id, ids))
        .orderBy(PartTable.message_id, PartTable.id)
        .all()
        .pipe(Effect.orDie)
      for (const row of partRows) {
        const next = part(row)
        const list = partByMessage.get(row.message_id)
        if (list) list.push(next)
        else partByMessage.set(row.message_id, [next])
      }
    }

    return rows.map((row) => ({
      info: info(row),
      parts: partByMessage.get(row.id) ?? [],
    }))
  })
}

function providerMeta(metadata: Record<string, any> | undefined) {
  if (!metadata) return undefined
  const { providerExecuted: _, ...rest } = metadata
  return Object.keys(rest).length > 0 ? rest : undefined
}

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  // Track media from tool results that need to be injected as user messages
  // for providers that don't support that media type in tool results.
  //
  // OpenAI-compatible APIs only support string content in tool results, so we need
  // to extract media and inject as user messages. Some SDKs only support a subset
  // of media in tool results; e.g. Bedrock supports images but not PDFs there.
  //
  // Only apply this workaround if the model actually supports that media input -
  // otherwise unsupportedParts() will turn it into a user-visible error.
  const supportsMediaInToolResult = (attachment: { mime: string }) => {
    if (model.api.npm === "@ai-sdk/anthropic") return true
    if (model.api.npm === "@ai-sdk/openai") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock/mantle") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock") return attachment.mime.startsWith("image/")
    if (model.api.npm === "@ai-sdk/xai") return attachment.mime.startsWith("image/")
    if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
    if (model.api.npm === "@ai-sdk/google") {
      const id = model.api.id.toLowerCase()
      return id.includes("gemini-3") && !id.includes("gemini-2")
    }
    return false
  }

  const toModelOutput = (options: { toolCallId: string; input: unknown; output: unknown }) => {
    const output = options.output
    if (typeof output === "string") {
      return { type: "text", value: output }
    }

    if (typeof output === "object") {
      const outputObject = output as {
        text: string
        attachments?: Array<{ mime: string; url: string }>
      }
      const attachments = (outputObject.attachments ?? []).filter((attachment) => {
        return attachment.url.startsWith("data:") && attachment.url.includes(",")
      })

      return {
        type: "content",
        value: [
          ...(outputObject.text ? [{ type: "text", text: outputObject.text }] : []),
          ...attachments.map((attachment) => ({
            type: "media",
            mediaType: attachment.mime,
            data: iife(() => {
              const commaIndex = attachment.url.indexOf(",")
              return commaIndex === -1 ? attachment.url : attachment.url.slice(commaIndex + 1)
            }),
          })),
        ],
      }
    }

    return { type: "json", value: output as never }
  }

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      for (const part of msg.parts) {
        // User message parts should never be empty
        if (part.type === "text" && !part.ignored && part.text !== "")
          userMessage.parts.push({
            type: "text",
            text: part.text,
          })
        // text/plain and directory files are converted into text parts, ignore them
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          if (options?.stripMedia && isMedia(part.mime)) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else {
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })
          }
        }

        if (part.type === "compaction") {
          userMessage.parts.push({
            type: "text",
            text: "What did we do so far?",
          })
        }
        if (part.type === "subtask") {
          userMessage.parts.push({
            type: "text",
            text: "The following tool was executed by the user",
          })
        }
      }
      if (userMessage.parts.length > 0) result.push(userMessage)
    }

    if (msg.info.role === "assistant") {
      const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
      const media: Array<{ mime: string; url: string; filename?: string }> = []

      if (
        msg.info.error &&
        !(
          AbortedError.isInstance(msg.info.error) &&
          msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
        )
      ) {
        continue
      }
      const assistantMessage: UIMessage = {
        id: msg.info.id,
        role: "assistant",
        parts: [],
      }
      // Anthropic adaptive thinking can persist assistant turns like:
      // step-start, reasoning(signature), text(""), step-start,
      // reasoning(signature). The empty text part is a structural separator,
      // but it does not carry the signature metadata itself. Dropping it shifts
      // signed thinking positions after step-start splitting/provider regrouping;
      // keeping it as "" is filtered by the AI SDK and rejected by Anthropic.
      // It is unclear whether this shape originates in our stream processing,
      // a proxy, or a lower-level library, but preserving a non-empty separator
      // here is the only safe replay point we have.
      // Use a single space so the separator survives replay without changing
      // the neighboring signed reasoning blocks.
      const hasSignedReasoning = msg.parts.some((part) => {
        if (part.type !== "reasoning") return false
        return part.metadata?.anthropic?.signature != null
      })
      for (const part of msg.parts) {
        if (part.type === "text") {
          const text = part.text === "" && hasSignedReasoning ? " " : part.text
          assistantMessage.parts.push({
            type: "text",
            text,
            ...(differentModel ? {} : { providerMetadata: part.metadata }),
          })
        }
        if (part.type === "step-start")
          assistantMessage.parts.push({
            type: "step-start",
          })
        if (part.type === "tool") {
          toolNames.add(part.tool)
          if (part.state.status === "completed") {
            const outputText = part.state.time.compacted
              ? "[Old tool result content cleared]"
              : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
            const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])

            // For providers that don't support media in tool results, extract media files
            // (images, PDFs) to be sent as a separate user message
            const mediaAttachments = attachments.filter((a) => isMedia(a.mime))
            const extractedMedia = mediaAttachments.filter((a) => !supportsMediaInToolResult(a))
            if (extractedMedia.length > 0) {
              media.push(...extractedMedia)
            }
            const finalAttachments = attachments.filter((a) => !isMedia(a.mime) || supportsMediaInToolResult(a))

            const output =
              finalAttachments.length > 0
                ? {
                    text: outputText,
                    attachments: finalAttachments,
                  }
                : outputText

            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-available",
              toolCallId: part.callID,
              input: part.state.input,
              output,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
          }
          if (part.state.status === "error") {
            const output = part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined
            if (typeof output === "string") {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-available",
                toolCallId: part.callID,
                input: part.state.input,
                output,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            } else {
              assistantMessage.parts.push({
                type: ("tool-" + part.tool) as `tool-${string}`,
                state: "output-error",
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
              })
            }
          }
          // Handle pending/running tool calls to prevent dangling tool_use blocks
          // Anthropic/Claude APIs require every tool_use to have a corresponding tool_result
          if (part.state.status === "pending" || part.state.status === "running")
            assistantMessage.parts.push({
              type: ("tool-" + part.tool) as `tool-${string}`,
              state: "output-error",
              toolCallId: part.callID,
              input: part.state.input,
              errorText: "[Tool execution was interrupted]",
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              ...(differentModel ? {} : { callProviderMetadata: providerMeta(part.metadata) }),
            })
        }
        if (part.type === "reasoning") {
          if (differentModel) {
            if (part.text.trim().length > 0)
              assistantMessage.parts.push({
                type: "text",
                text: part.text,
              })
            continue
          }
          assistantMessage.parts.push({
            type: "reasoning",
            text: part.text,
            providerMetadata: part.metadata,
          })
        }
      }
      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage)
        // Inject pending media as a user message for providers that don't support
        // media (images, PDFs) in tool results
        if (media.length > 0) {
          result.push({
            id: MessageID.ascending(),
            role: "user",
            parts: [
              {
                type: "text" as const,
                text: SYNTHETIC_ATTACHMENT_PROMPT,
              },
              ...media.map((attachment) => ({
                type: "file" as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename,
              })),
            ],
          })
        }
      }
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return yield* Effect.promise(() =>
    convertToModelMessages(
      result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
      {
        //@ts-expect-error (convertToModelMessages expects a ToolSet but only actually needs tools[name]?.toModelOutput)
        tools,
      },
    ),
  )
})

export function toModelMessages(
  input: WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options))
}

export const page = Effect.fn("MessageV2.page")(function* (input: {
  sessionID: SessionID
  limit: number
  before?: string
}) {
  const { db } = yield* Database.Service
  const before = input.before ? cursor.decode(input.before) : undefined
  const where = before
    ? and(eq(MessageTable.session_id, input.sessionID), older(before))
    : eq(MessageTable.session_id, input.sessionID)
  const rows = yield* db
    .select()
    .from(MessageTable)
    .where(where)
    .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie)
  if (rows.length === 0) {
    const row = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get()
      .pipe(Effect.orDie)
    if (!row) return yield* new NotFoundError({ message: `Session not found: ${input.sessionID}` })
    return {
      items: [] as WithParts[],
      more: false,
    }
  }

  const more = rows.length > input.limit
  const slice = more ? rows.slice(0, input.limit) : rows
  const items = yield* hydrate(db, slice)
  items.reverse()
  const tail = slice.at(-1)
  return {
    items,
    more,
    cursor: more && tail ? cursor.encode({ id: tail.id, time: tail.time_created }) : undefined,
  }
})

export function stream(sessionID: SessionID) {
  const size = 50
  return Effect.gen(function* () {
    const result = [] as WithParts[]
    let before: string | undefined
    while (true) {
      const next = yield* page({ sessionID, limit: size, before }).pipe(
        Effect.catchIf(NotFoundError.isInstance, () =>
          Effect.succeed({ items: [] as WithParts[], more: false, cursor: undefined }),
        ),
      )
      if (next.items.length === 0) break
      for (let i = next.items.length - 1; i >= 0; i--) {
        const item = next.items[i]
        if (item) result.push(item)
      }
      if (!next.more || !next.cursor) break
      before = next.cursor
    }
    return result
  })
}

export function parts(messageID: MessageID) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .select()
      .from(PartTable)
      .where(eq(PartTable.message_id, messageID))
      .orderBy(PartTable.id)
      .all()
      .pipe(Effect.orDie)
    return rows.map(part)
  })
}

export const get = Effect.fn("MessageV2.get")(function* (input: { sessionID: SessionID; messageID: MessageID }) {
  const { db } = yield* Database.Service
  const row = yield* db
    .select()
    .from(MessageTable)
    .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (!row) return yield* new NotFoundError({ message: `Message not found: ${input.messageID}` })
  return {
    info: info(row),
    parts: yield* parts(input.messageID),
  }
})

export function toLegacy(
  session: SessionSchema.Info,
  messages: readonly SessionMessage.Message[],
): SessionV1.WithParts[] {
  const result: SessionV1.WithParts[] = []
  const sessionID = SessionID.make(session.id)
  let agent = session.agent ?? "build"
  let model = session.model
  let parentID: MessageID | undefined

  const currentModel = () => ({
    providerID: model?.providerID ?? ProviderV2.ID.make(""),
    modelID: model?.id ?? ModelV2.ID.make(""),
    ...(model?.variant === undefined || model.variant === "default" ? {} : { variant: model.variant }),
    ...(model?.protocol === undefined ? {} : { protocol: model.protocol }),
  })
  const id = (messageID: SessionMessage.ID) => MessageID.ascending(messageID)
  const partID = (messageID: MessageID, type: string, index: number) =>
    PartID.ascending(`prt_${messageID}_${type}_${index}`)
  const millis = (value: DateTime.Utc) => DateTime.toEpochMillis(value)
  const legacyFormat = (value: SessionMessage.User["format"]) =>
    value === undefined ? undefined : Schema.decodeUnknownSync(SessionV1.Format)(value)
  const syntheticUser = (messageID: MessageID, text: string, created: number): SessionV1.WithParts => {
    const info: SessionV1.User = {
      id: messageID,
      sessionID,
      role: "user",
      time: { created },
      agent,
      model: currentModel(),
    }
    return {
      info,
      parts: [
        {
          id: partID(messageID, "text", 0),
          sessionID,
          messageID,
          type: "text" as const,
          text,
          synthetic: true,
        },
      ],
    }
  }
  const assistantInfo = (
    messageID: MessageID,
    input: {
      agent: string
      model: { providerID: ProviderV2.ID; id: ModelV2.ID; variant?: ModelV2.VariantID }
      created: number
      completed?: number
      finish?: string
      cost?: number
      tokens?: SessionV1.Assistant["tokens"]
      summary?: boolean
      error?: SessionV1.Assistant["error"]
      structured?: SessionV1.Assistant["structured"]
    },
  ): SessionV1.Assistant => ({
    id: messageID,
    sessionID,
    parentID: parentID ?? messageID,
    role: "assistant",
    mode: input.agent,
    agent: input.agent,
    modelID: input.model.id,
    providerID: input.model.providerID,
    variant: input.model.variant === undefined || input.model.variant === "default" ? undefined : input.model.variant,
    path: { cwd: session.location.directory, root: session.location.directory },
    time: { created: input.created, completed: input.completed },
    cost: input.cost ?? 0,
    tokens: input.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: input.finish,
    summary: input.summary,
    error: input.error,
    structured: input.structured,
  })
  const toolOutput = (content: readonly { type: "text"; text: string }[] | readonly any[]) =>
    content.map((item) => (item.type === "text" ? item.text : item.uri)).join("\n")
  const inputRecord = (value: string) => {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  const toolPart = (messageID: MessageID, item: SessionMessage.AssistantTool, index: number): SessionV1.ToolPart => {
    const base = {
      id: partID(messageID, "tool", index),
      sessionID,
      messageID,
      type: "tool" as const,
      callID: item.id,
      tool: item.name,
      metadata: item.provider?.metadata,
    }
    if (item.state.status === "pending") {
      return {
        ...base,
        state: {
          status: "pending",
          input: inputRecord(item.state.input),
          raw: item.state.input,
        },
      }
    }
    const started = millis(item.time.ran ?? item.time.created)
    if (item.state.status === "running") {
      return {
        ...base,
        state: {
          status: "running",
          input: { ...item.state.input },
          title: typeof item.state.structured.title === "string" ? item.state.structured.title : item.name,
          metadata: { ...item.state.structured },
          time: { start: started },
        },
      }
    }
    const completed = millis(item.time.completed ?? item.time.ran ?? item.time.created)
    if (item.state.status === "completed") {
      const files = [
        ...(item.state.attachments ?? []),
        ...item.state.content
          .filter((content) => content.type === "file")
          .map((content) => ({ uri: content.uri, mime: content.mime, name: content.name })),
      ]
      return {
        ...base,
        state: {
          status: "completed",
          input: { ...item.state.input },
          output: toolOutput(item.state.content),
          title: typeof item.state.structured.title === "string" ? item.state.structured.title : item.name,
          metadata: { ...item.state.structured },
          time: { start: started, end: completed },
          attachments:
            files.length === 0
              ? undefined
              : files.map((file, fileIndex) => ({
                  id: partID(messageID, `tool-file-${index}`, fileIndex),
                  sessionID,
                  messageID,
                  type: "file" as const,
                  mime: file.mime,
                  filename: file.name,
                  url: file.uri,
                })),
        },
      }
    }
    return {
      ...base,
      state: {
        status: "error",
        input: { ...item.state.input },
        error: item.state.error.message,
        metadata: { ...item.state.structured },
        time: { start: started, end: completed },
      },
    }
  }

  for (const message of messages) {
    if (message.type === "agent-switched") {
      agent = message.agent
      continue
    }
    if (message.type === "model-switched") {
      model = message.model
      continue
    }
    if (message.type === "user") {
      const messageID = id(message.id)
      const info: SessionV1.User = {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: millis(message.time.created) },
        agent,
        model: currentModel(),
        system: message.system,
        tools: message.tools,
        format: legacyFormat(message.format),
      }
      const parts: SessionV1.Part[] = [
        {
          id: partID(messageID, "text", 0),
          sessionID,
          messageID,
          type: "text",
          text: message.text,
        },
        ...(message.files ?? []).map(
          (file, index): SessionV1.FilePart => ({
            id: partID(messageID, "file", index),
            sessionID,
            messageID,
            type: "file",
            mime: file.mime,
            filename: file.name,
            url: file.uri,
            source: file.source && {
              type: "file",
              path: file.name ?? file.uri,
              text: {
                value: file.source.text,
                start: file.source.start,
                end: file.source.end,
              },
            },
          }),
        ),
        ...(message.agents ?? []).map(
          (item, index): SessionV1.AgentPart => ({
            id: partID(messageID, "agent", index),
            sessionID,
            messageID,
            type: "agent",
            name: item.name,
            source: item.source && {
              value: item.source.text,
              start: item.source.start,
              end: item.source.end,
            },
          }),
        ),
      ]
      result.push({ info, parts })
      parentID = messageID
      continue
    }
    if (message.type === "assistant") {
      const messageID = id(message.id)
      const info = assistantInfo(messageID, {
        agent: message.agent,
        model: message.model,
        created: millis(message.time.created),
        completed: message.time.completed && millis(message.time.completed),
        finish: message.finish,
        cost: message.cost,
        tokens: message.tokens && {
          input: message.tokens.input,
          output: message.tokens.output,
          reasoning: message.tokens.reasoning,
          cache: { read: message.tokens.cache.read, write: message.tokens.cache.write },
        },
        error: message.error
          ? ({ name: "UnknownError", data: { message: message.error.message } } as SessionV1.Assistant["error"])
          : undefined,
        structured: message.structured,
      })
      const parts: SessionV1.Part[] = []
      if (message.snapshot?.start) {
        parts.push({
          id: partID(messageID, "step-start", 0),
          sessionID,
          messageID,
          type: "step-start",
          snapshot: message.snapshot.start,
        })
      }
      for (const [index, item] of message.content.entries()) {
        if (item.type === "text") {
          parts.push({
            id: partID(messageID, "text", index),
            sessionID,
            messageID,
            type: "text",
            text: item.text,
          })
          continue
        }
        if (item.type === "reasoning") {
          parts.push({
            id: partID(messageID, "reasoning", index),
            sessionID,
            messageID,
            type: "reasoning",
            text: item.text,
            metadata: item.providerMetadata,
            time: {
              start: millis(item.time?.created ?? message.time.created),
              end: item.time?.completed && millis(item.time.completed),
            },
          })
          continue
        }
        parts.push(toolPart(messageID, item, index))
      }
      if (message.finish) {
        parts.push({
          id: partID(messageID, "step-finish", parts.length),
          sessionID,
          messageID,
          type: "step-finish",
          reason: message.finish,
          snapshot: message.snapshot?.end,
          cost: message.cost ?? 0,
          tokens: message.tokens ?? {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })
      }
      result.push({ info, parts })
      continue
    }
    if (message.type === "shell") {
      const messageID = id(message.id)
      const userID = message.userID ? MessageID.ascending(message.userID) : MessageID.ascending(`${message.id}_user`)
      result.push(syntheticUser(userID, "The following tool was executed by the user", millis(message.time.created)))
      parentID = userID
      const completed = message.time.completed ?? message.time.created
      const info = assistantInfo(messageID, {
        agent,
        model: model ?? {
          providerID: ProviderV2.ID.make(""),
          id: ModelV2.ID.make(""),
        },
        created: millis(message.time.created),
        completed: millis(completed),
        finish: "stop",
      })
      result.push({
        info,
        parts: [
          {
            id: partID(messageID, "tool", 0),
            sessionID,
            messageID,
            type: "tool",
            callID: message.callID,
            tool: "bash",
            state: {
              status: "completed",
              input: { command: message.command },
              output: message.output,
              title: "",
              metadata: { output: message.output },
              time: { start: millis(message.time.created), end: millis(completed) },
            },
          },
        ],
      })
      continue
    }
    if (message.type === "compaction") {
      const messageID = id(message.id)
      const userID = MessageID.ascending(`${message.id}_user`)
      const user = syntheticUser(userID, "What did we do so far?", millis(message.time.created))
      user.parts = [
        {
          id: partID(userID, "compaction", 0),
          sessionID,
          messageID: userID,
          type: "compaction",
          auto: message.reason === "auto",
        },
      ]
      result.push(user)
      parentID = userID
      const info = assistantInfo(messageID, {
        agent,
        model: model ?? {
          providerID: ProviderV2.ID.make(""),
          id: ModelV2.ID.make(""),
        },
        created: millis(message.time.created),
        completed: millis(message.time.created),
        finish: "stop",
        summary: true,
      })
      result.push({
        info,
        parts: [
          {
            id: partID(messageID, "text", 0),
            sessionID,
            messageID,
            type: "text",
            text: message.summary,
          },
        ],
      })
    }
  }

  return result
}

export function filterCompacted(msgs: Iterable<WithParts>) {
  const result = [] as WithParts[]
  const completed = new Set<string>()
  let retain: MessageID | undefined
  for (const msg of msgs) {
    result.push(msg)
    if (retain) {
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id)) {
      const part = msg.parts.find((item): item is CompactionPart => item.type === "compaction")
      if (!part) continue
      if (!part.tail_start_id) break
      retain = part.tail_start_id
      if (msg.info.id === retain) break
      continue
    }
    if (msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some((part) => part.type === "compaction"))
      break
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error)
      completed.add(msg.info.parentID)
  }
  result.reverse()
  const compactionIndex = result.findLastIndex(
    (msg) =>
      msg.info.role === "user" &&
      msg.parts.some((item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined),
  )
  const compaction = result[compactionIndex]
  const part = compaction?.parts.find(
    (item): item is CompactionPart => item.type === "compaction" && item.tail_start_id !== undefined,
  )
  const summaryIndex = compaction
    ? result.findIndex(
        (msg, index) =>
          index > compactionIndex &&
          msg.info.role === "assistant" &&
          msg.info.summary &&
          msg.info.parentID === compaction.info.id,
      )
    : -1
  const tailIndex = part?.tail_start_id ? result.findIndex((msg) => msg.info.id === part.tail_start_id) : -1
  if (tailIndex >= 0 && tailIndex < compactionIndex && summaryIndex > compactionIndex) {
    return [
      ...result.slice(compactionIndex, summaryIndex + 1),
      ...result.slice(tailIndex, compactionIndex),
      ...result.slice(summaryIndex + 1),
    ]
  }
  return result
}

export const filterCompactedEffect = Effect.fnUntraced(function* (sessionID: SessionID) {
  return filterCompacted(yield* stream(sessionID))
})

// filterCompacted reorders messages for model consumption
// ([compaction-user, summary, ...retained tail..., continue-user]), so array
// position is not chronological. Derive each binding by max id (MessageID
// is monotonic via MessageID.ascending) so a pre-compaction overflowing tail
// assistant doesn't get mistaken for the most recent turn. tasks are
// compaction/subtask parts attached to user messages newer than the latest
// finished assistant — i.e. unprocessed work.
export function latest(msgs: WithParts[]) {
  let user: User | undefined
  let assistant: Assistant | undefined
  let finished: Assistant | undefined
  for (const msg of msgs) {
    const info = msg.info
    if (info.role === "user" && (!user || messageAfter(info, user))) user = info
    if (info.role === "assistant" && (!assistant || messageAfter(info, assistant))) assistant = info
    if (info.role === "assistant" && info.finish && (!finished || messageAfter(info, finished))) finished = info
  }
  const tasks = msgs.flatMap((m) =>
    finished && !messageAfter(m.info, finished)
      ? []
      : m.parts.filter((p): p is CompactionPart | SubtaskPart => p.type === "compaction" || p.type === "subtask"),
  )
  return { user, assistant, finished, tasks }
}

export function messageAfter(left: Pick<SessionV1.Info, "id" | "time">, right: Pick<SessionV1.Info, "id" | "time">) {
  if (left.time.created !== right.time.created) return left.time.created > right.time.created
  return left.id > right.id
}

export function fromError(
  e: unknown,
  ctx: { providerID: ProviderV2.ID; aborted?: boolean },
): NonNullable<Assistant["error"]> {
  switch (true) {
    case e instanceof DOMException && e.name === "AbortError":
      return new AbortedError(
        { message: e.message },
        {
          cause: e,
        },
      ).toObject()
    case OutputLengthError.isInstance(e):
      return e
    case LoadAPIKeyError.isInstance(e):
      return new AuthError(
        {
          providerID: ctx.providerID,
          message: e.message,
        },
        { cause: e },
      ).toObject()
    case (e as SystemError)?.code === "ECONNRESET":
      return new APIError(
        {
          message: "Connection reset by server",
          isRetryable: true,
          metadata: {
            code: (e as SystemError).code ?? "",
            syscall: (e as SystemError).syscall ?? "",
            message: (e as SystemError).message ?? "",
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof Error && (e as FetchDecompressionError).code === "ZlibError":
      if (ctx.aborted) {
        return new AbortedError({ message: e.message }, { cause: e }).toObject()
      }
      return new APIError(
        {
          message: "Response decompression failed",
          isRetryable: true,
          metadata: {
            code: (e as FetchDecompressionError).code,
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof ProviderError.HeaderTimeoutError:
      return new APIError(
        {
          message: e.message,
          isRetryable: true,
          metadata: {
            code: e.name,
            timeoutMs: String(e.ms),
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof ProviderError.ResponseStreamError:
      return new APIError(
        {
          message: e.message,
          isRetryable: true,
          metadata: {
            code: e.name,
          },
        },
        { cause: e },
      ).toObject()
    case APICallError.isInstance(e):
      const parsed = ProviderError.parseAPICallError({
        providerID: ctx.providerID,
        error: e,
      })
      if (parsed.type === "context_overflow") {
        return new ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody,
          },
          { cause: e },
        ).toObject()
      }

      return new APIError(
        {
          message: parsed.message,
          statusCode: parsed.statusCode,
          isRetryable: parsed.isRetryable,
          responseHeaders: parsed.responseHeaders,
          responseBody: parsed.responseBody,
          metadata: parsed.metadata,
        },
        { cause: e },
      ).toObject()
    case e instanceof Error:
      return new NamedError.Unknown({ message: errorMessage(e) }, { cause: e }).toObject()
    default:
      try {
        const parsed = ProviderError.parseStreamError(e)
        if (parsed) {
          if (parsed.type === "context_overflow") {
            return new ContextOverflowError(
              {
                message: parsed.message,
                responseBody: parsed.responseBody,
              },
              { cause: e },
            ).toObject()
          }
          return new APIError(
            {
              message: parsed.message,
              isRetryable: parsed.isRetryable,
              responseBody: parsed.responseBody,
            },
            {
              cause: e,
            },
          ).toObject()
        }
      } catch {}
      return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
  }
}

export * as MessageV2 from "./message-v2"
export const node = LayerNode.group([Database.node])
