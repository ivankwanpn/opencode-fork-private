import type {
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageShell,
  SessionMessageUser,
  SessionV2Info,
} from "@opencode-ai/sdk/v2"
import type { PromptInfo } from "../prompt/history"

type Model = { readonly id: string; readonly providerID: string; readonly variant?: string }

export type TimelineEntry =
  | {
      readonly type: "user"
      readonly message: SessionMessageUser
      readonly agent: string
      readonly model: Model
    }
  | {
      readonly type: "assistant"
      readonly message: SessionMessageAssistant
      readonly parent?: SessionMessageUser
    }
  | {
      readonly type: "shell"
      readonly message: SessionMessageShell
    }
  | {
      readonly type: "compaction"
      readonly message: SessionMessageCompaction
    }

export function chronological(messages: readonly SessionMessage[]) {
  return messages
    .slice()
    .sort((left, right) => left.time.created - right.time.created || left.id.localeCompare(right.id))
}

export function timeline(session: SessionV2Info | undefined, messages: readonly SessionMessage[]): TimelineEntry[] {
  let agent = session?.agent ?? "build"
  let model: Model = session?.model ?? { id: "unknown", providerID: "unknown" }
  let parent: SessionMessageUser | undefined

  return chronological(messages).flatMap((message): TimelineEntry[] => {
    if (message.type === "agent-switched") {
      agent = message.agent
      return []
    }
    if (message.type === "model-switched") {
      model = message.model
      return []
    }
    if (message.type === "user") {
      parent = message
      return [{ type: "user", message, agent, model }]
    }
    if (message.type === "assistant") {
      agent = message.agent
      model = message.model
      return [{ type: "assistant", message, parent }]
    }
    if (message.type === "shell") return [{ type: "shell", message }]
    if (message.type === "compaction") return [{ type: "compaction", message }]
    return []
  })
}

export function promptInfo(message: SessionMessageUser): PromptInfo {
  return {
    input: message.text,
    parts: [
      ...(message.files ?? []).map((file) => ({
        type: "file" as const,
        mime: file.mime,
        filename: file.name,
        url: file.uri,
        source: file.resource
          ? {
              type: "resource" as const,
              clientName: file.resource.clientName,
              uri: file.resource.uri,
              text: file.source
                ? { value: file.source.text, start: file.source.start, end: file.source.end }
                : { value: "", start: 0, end: 0 },
            }
          : file.source
            ? {
                type: "file" as const,
                path: file.uri,
                text: { value: file.source.text, start: file.source.start, end: file.source.end },
              }
            : undefined,
      })),
      ...(message.agents ?? []).map((item) => ({
        type: "agent" as const,
        name: item.name,
        source: item.source ? { value: item.source.text, start: item.source.start, end: item.source.end } : undefined,
      })),
    ],
  }
}

export function toolInput(tool: SessionMessageAssistantTool) {
  return typeof tool.state.input === "string" ? {} : tool.state.input
}

export function toolMetadata(tool: SessionMessageAssistantTool) {
  return tool.state.status === "pending" ? {} : tool.state.structured
}

export function toolOutput(tool: SessionMessageAssistantTool) {
  if (tool.state.status !== "completed") return undefined
  return tool.state.content.map((content) => (content.type === "text" ? content.text : content.uri)).join("\n")
}

export function toolError(tool: SessionMessageAssistantTool) {
  return tool.state.status === "error" ? tool.state.error.message : undefined
}

export function toolPruned(tool: SessionMessageAssistantTool) {
  return tool.time.pruned !== undefined
}
