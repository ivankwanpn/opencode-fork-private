import type { Event, ToolPart } from "@opencode-ai/sdk/v2"

export type CanonicalToolEvent = Extract<
  Event,
  {
    type:
      | "session.next.tool.called"
      | "session.next.tool.progress"
      | "session.next.tool.success"
      | "session.next.tool.failed"
      | "session.next.transcript.content.updated"
  }
>

export type CanonicalToolRemovalEvent = Extract<Event, { type: "session.next.transcript.content.removed" }>

export function canonicalToolKey(messageID: string, callID: string) {
  return `${messageID}:${callID}`
}

export function canonicalToolPartID(messageID: string, callID: string) {
  return `tool:${messageID}:${callID}`
}

export function updateCanonicalTool(parts: Map<string, ToolPart>, event: CanonicalToolEvent) {
  if (event.type === "session.next.transcript.content.updated") {
    const content = event.properties.content
    if (content.type !== "tool") return undefined
    const key = canonicalToolKey(event.properties.assistantMessageID, content.id)
    const started = content.time.ran ?? content.time.created ?? event.properties.timestamp
    const base = {
      id: event.properties.partID,
      sessionID: event.properties.sessionID,
      messageID: event.properties.assistantMessageID,
      type: "tool" as const,
      callID: content.id,
      tool: content.name,
      ...(content.provider?.metadata ? { metadata: content.provider.metadata } : {}),
    }
    const part: ToolPart =
      content.state.status === "pending"
        ? { ...base, state: { status: "pending", input: {}, raw: content.state.input } }
        : content.state.status === "running"
          ? {
              ...base,
              state: {
                status: "running",
                input: content.state.input,
                title:
                  typeof content.state.structured.title === "string" ? content.state.structured.title : content.name,
                metadata: content.state.structured,
                time: { start: started },
              },
            }
          : content.state.status === "completed"
            ? {
                ...base,
                state: {
                  status: "completed",
                  input: content.state.input,
                  output: output(content.state.content),
                  title:
                    typeof content.state.structured.title === "string" ? content.state.structured.title : content.name,
                  metadata: content.state.structured,
                  time: { start: started, end: content.time.completed ?? event.properties.timestamp },
                },
              }
            : {
                ...base,
                state: {
                  status: "error",
                  input: content.state.input,
                  error: content.state.error.message,
                  metadata: content.state.structured,
                  time: { start: started, end: content.time.completed ?? event.properties.timestamp },
                },
              }
    if (part.state.status === "pending" || part.state.status === "running") parts.set(key, part)
    else parts.delete(key)
    return part
  }

  const key = canonicalToolKey(event.properties.assistantMessageID, event.properties.callID)
  const current = parts.get(key)
  if (event.type === "session.next.tool.called") {
    const properties = event.properties
    const part: ToolPart = {
      id: current?.id ?? canonicalToolPartID(properties.assistantMessageID, properties.callID),
      sessionID: properties.sessionID,
      messageID: properties.assistantMessageID,
      type: "tool",
      callID: properties.callID,
      tool: properties.tool,
      ...(properties.provider.metadata ? { metadata: properties.provider.metadata } : {}),
      state: {
        status: "running",
        input: properties.input,
        title: properties.tool,
        metadata: {},
        time: { start: properties.timestamp },
      },
    }
    parts.set(key, part)
    return part
  }
  if (!current) return undefined

  const started = "time" in current.state ? current.state.time.start : event.properties.timestamp
  if (event.type === "session.next.tool.progress") {
    const properties = event.properties
    const part: ToolPart = {
      ...current,
      state: {
        status: "running",
        input: current.state.input,
        title: typeof properties.structured.title === "string" ? properties.structured.title : current.tool,
        metadata: properties.structured,
        time: { start: started },
      },
    }
    parts.set(key, part)
    return part
  }
  if (event.type === "session.next.tool.success") {
    const properties = event.properties
    const part: ToolPart = {
      ...current,
      ...(properties.provider.metadata ? { metadata: properties.provider.metadata } : {}),
      state: {
        status: "completed",
        input: current.state.input,
        output: output(properties.content),
        title: typeof properties.structured.title === "string" ? properties.structured.title : current.tool,
        metadata: properties.structured,
        time: { start: started, end: properties.timestamp },
      },
    }
    parts.delete(key)
    return part
  }

  const properties = event.properties
  const part: ToolPart = {
    ...current,
    ...(properties.provider.metadata ? { metadata: properties.provider.metadata } : {}),
    state: {
      status: "error",
      input: current.state.input,
      error: properties.error.message,
      metadata: "metadata" in current.state ? current.state.metadata : undefined,
      time: { start: started, end: properties.timestamp },
    },
  }
  parts.delete(key)
  return part
}

export function removeCanonicalTool(parts: Map<string, ToolPart>, event: CanonicalToolRemovalEvent) {
  const entries = [...parts.entries()].filter(([, part]) => part.messageID === event.properties.assistantMessageID)
  const exact = entries.find(([, part]) => part.id === event.properties.partID)
  const projected = event.properties.partID.startsWith(`prt_${event.properties.assistantMessageID}_tool_`)
  const removed = exact ?? (projected ? entries.at(-1) : undefined)
  if (!removed) return
  parts.delete(removed[0])
  return removed[1]
}

function output(content: ReadonlyArray<{ type: "text"; text: string } | { type: "file"; uri: string }>) {
  return content.map((item) => (item.type === "text" ? item.text : item.uri)).join("\n")
}
