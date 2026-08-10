import type {
  ModelV2Info,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageShell,
  SessionMessageUser,
} from "@opencode-ai/sdk/v2"
import { Locale } from "./locale"
import * as Model from "./model"
import { chronological, toolError, toolInput, toolOutput } from "./native-transcript"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  models?: readonly ModelV2Info[]
}

export type SessionInfo = {
  id: string
  title: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  time: {
    created: number
    updated: number
  }
}

export function formatTranscript(
  session: SessionInfo,
  messages: readonly SessionMessage[],
  options: TranscriptOptions,
) {
  const body = chronological(messages).flatMap((message) => {
    if (message.type === "user" || message.type === "assistant")
      return [formatMessage(message, options, options.models)]
    if (message.type === "shell") return [formatShell(message)]
    if (message.type === "compaction") return ["## Compaction\n\n"]
    return []
  })

  return [
    `# ${session.title}\n\n`,
    `**Session ID:** ${session.id}\n`,
    `**Created:** ${new Date(session.time.created).toLocaleString()}\n`,
    `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`,
    "---\n\n",
    ...body.flatMap((message) => [message, "---\n\n"]),
  ].join("")
}

export function formatMessage(
  message: SessionMessageUser | SessionMessageAssistant,
  options: TranscriptOptions,
  models?: readonly ModelV2Info[],
) {
  if (message.type === "user") return `## User\n\n${message.text}\n\n`
  return [
    formatAssistantHeader(message, options.assistantMetadata, models ?? options.models),
    ...message.content.map((content) => formatPart(content, options)),
  ].join("")
}

export function formatAssistantHeader(
  message: SessionMessageAssistant,
  includeMetadata: boolean,
  models?: readonly ModelV2Info[],
) {
  if (!includeMetadata) return `## Assistant\n\n`
  const duration = message.time.completed
    ? ((message.time.completed - message.time.created) / 1000).toFixed(1) + "s"
    : ""
  const model = Model.name(models, message.model.providerID, message.model.id)
  return `## Assistant (${Locale.titlecase(message.agent)} - ${model}${duration ? ` - ${duration}` : ""})\n\n`
}

export function formatPart(
  part: SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool,
  options: TranscriptOptions,
) {
  if (part.type === "text") return `${part.text}\n\n`
  if (part.type === "reasoning") return options.thinking ? `_Thinking:_\n\n${part.text}\n\n` : ""

  const input = toolInput(part)
  const output = toolOutput(part)
  const error = toolError(part)
  return [
    `**Tool: ${part.name}**\n`,
    ...(options.toolDetails && Object.keys(input).length
      ? [`\n**Input:**\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n`]
      : []),
    ...(options.toolDetails && output ? [`\n**Output:**\n\`\`\`\n${output}\n\`\`\`\n`] : []),
    ...(options.toolDetails && error ? [`\n**Error:**\n\`\`\`\n${error}\n\`\`\`\n`] : []),
    "\n",
  ].join("")
}

function formatShell(message: SessionMessageShell) {
  return [
    "## Shell\n\n",
    `\`\`\`sh\n$ ${message.command}\n\`\`\`\n\n`,
    ...(message.output ? [`\`\`\`text\n${message.output}\n\`\`\`\n\n`] : []),
  ].join("")
}
