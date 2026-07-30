export * as SessionRunnerToolResultPreparation from "./tool-result-preparation"

import {
  InvalidRequestReason,
  LLMError,
  Message,
  ToolOutput,
  type ToolContent,
  type ToolResultPart,
} from "@opencode-ai/llm"
import { Effect } from "effect"
import { SessionAttachment } from "../attachment"
import type { FileAttachment } from "../prompt"

export const prepare = Effect.fn("SessionRunnerToolResultPreparation.prepare")(function* (
  messages: ReadonlyArray<Message>,
) {
  const attachments = yield* SessionAttachment.Service
  return yield* Effect.forEach(messages, (message) => prepareMessage(message, attachments))
})

const prepareMessage = Effect.fnUntraced(function* (message: Message, attachments: SessionAttachment.Interface) {
  const content = yield* Effect.forEach(message.content, (part) => preparePart(part, attachments))
  if (content.every((part, index) => part === message.content[index])) return message
  return new Message({ ...message, content })
})

const preparePart = Effect.fnUntraced(function* (
  part: Message["content"][number],
  attachments: SessionAttachment.Interface,
) {
  if (part.type !== "tool-result" || part.result.type !== "content") return part
  const original = ToolOutput.fromResultValue(part.result)
  if (original === undefined) return part
  const prepared = yield* Effect.forEach(original.content, (content) => prepareContent(content, attachments))
  const value = prepared.flat()
  if (value.length === original.content.length && value.every((content, index) => content === original.content[index]))
    return part
  return {
    ...part,
    result: {
      ...part.result,
      value,
    },
  } satisfies ToolResultPart
})

const prepareContent = Effect.fnUntraced(function* (content: ToolContent, attachments: SessionAttachment.Interface) {
  if (content.type === "text" || content.uri.startsWith("data:")) return [content]
  const file = {
    uri: content.uri,
    mime: content.mime,
    name: content.name,
  }
  const materialized = yield* attachments.materializeFile(file)
  if (materialized.materialized === undefined) return yield* invalidRequest(file, "Attachment was not materialized")
  if (materialized.materialized.length === 0)
    return yield* invalidRequest(file, "Attachment produced no materialized content")
  const failure = materialized.materialized.find((item) => item.type === "error")
  if (failure) return yield* invalidRequest(file, failure.message)
  return yield* Effect.forEach(materialized.materialized, (item) => {
    if (item.type === "text")
      return Effect.succeed<ToolContent>({
        type: "text",
        text: item.text,
        ...(content.provenance === undefined ? {} : { provenance: content.provenance }),
      })
    if (item.type === "file")
      return Effect.succeed<ToolContent>({
        type: "file",
        uri: item.uri,
        mime: item.mime,
        ...(item.name === undefined ? {} : { name: item.name }),
        ...(content.provenance === undefined ? {} : { provenance: content.provenance }),
      })
    return Effect.fail(
      invalidRequest(file, `Attachment returned unsupported materialized content variant: ${materializedType(item)}`),
    )
  })
})

const invalidRequest = (file: FileAttachment, message: string) =>
  new LLMError({
    module: "SessionRunnerToolResultPreparation",
    method: "prepare",
    reason: new InvalidRequestReason({
      message: `Unable to prepare tool result ${SessionAttachment.attachmentLabel(file)}: ${message}`,
    }),
  })

const materializedType = (content: unknown) => {
  if (typeof content !== "object" || content === null || !("type" in content)) return "unknown"
  return String(content.type)
}
