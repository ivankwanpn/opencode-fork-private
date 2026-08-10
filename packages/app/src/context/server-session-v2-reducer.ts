import type {
  JsonValue,
  OpenCodeEvent,
  SessionMessageInfo,
  SessionPendingMessage,
  V2Event as LegacyV2Event,
} from "@opencode-ai/client/promise"
import type { V2Event } from "@opencode-ai/sdk/v2/client"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Compaction = Extract<SessionMessageInfo, { type: "compaction" }>
type Shell = Extract<SessionMessageInfo, { type: "shell" }>

export type V2SessionReduction = {
  sessionID: string
  messages: SessionMessageInfo[]
  touched: string[]
  missing?: string
}

export function createV2SessionReducer() {
  const pending = new Map<string, SessionPendingMessage>()
  const contentIDs = new Map<string, string[]>()

  const contentOrdinal = (sessionID: string, messageID: string, type: "text" | "reasoning", contentID: string) => {
    const id = `${sessionID}:${messageID}:${type}`
    const items = contentIDs.get(id) ?? []
    const current = items.indexOf(contentID)
    if (current >= 0) return current
    items.push(contentID)
    contentIDs.set(id, items)
    return items.length - 1
  }

  const reduce = (
    source: readonly SessionMessageInfo[],
    event: OpenCodeEvent | LegacyV2Event | V2Event,
  ): V2SessionReduction | undefined => {
    if (!("data" in event) || !("sessionID" in event.data) || typeof event.data.sessionID !== "string") return
    const sessionID = event.data.sessionID
    const result = (messages: SessionMessageInfo[], touched: string[] = []): V2SessionReduction => ({
      sessionID,
      messages,
      touched,
    })
    const append = (message: SessionMessageInfo) =>
      result(source.some((item) => item.id === message.id) ? [...source] : [...source, message], [message.id])

    switch (event.type) {
      case "session.next.prompt.admitted":
        return result([...source])
      case "session.next.message.imported":
        return source.some((item) => item.id === event.data.message.id)
          ? result([...source])
          : { ...result([...source]), missing: event.data.message.id }
      case "session.next.context.updated":
        return append({
          id: event.data.messageID,
          type: "system",
          metadata: legacyJsonRecord(event.metadata),
          text: event.data.text,
          time: { created: event.data.timestamp },
        })
      case "session.next.prompted":
        if (event.data.synthetic)
          return append({
            id: event.data.messageID,
            type: "synthetic",
            text: event.data.prompt.text,
            description: event.data.synthetic.description,
            time: { created: event.data.timestamp },
          })
        return append({
          id: event.data.messageID,
          type: "user",
          text: event.data.prompt.text,
          files: event.data.prompt.files?.map((file) => ({
            data: "",
            mime: file.mime,
            source: { type: "uri", uri: file.uri },
            name: file.name,
            description: file.description,
            mention: file.source,
          })),
          agents: event.data.prompt.agents?.map((agent) => ({
            name: agent.name,
            mention: agent.source,
          })),
          time: { created: event.data.timestamp },
        })
      case "session.input.admitted":
        pending.set(key(sessionID, event.data.inputID), event.data.input)
        return result([...source])
      case "session.input.promoted": {
        const input = pending.get(key(sessionID, event.data.inputID))
        pending.delete(key(sessionID, event.data.inputID))
        if (!input) return { ...result([...source]), missing: event.data.inputID }
        if (input.type === "user")
          return append({
            id: event.data.inputID,
            type: "user",
            metadata: input.data.metadata,
            text: input.data.text,
            files: input.data.files,
            agents: input.data.agents,
            time: { created: event.created },
          })
        return append({
          id: event.data.inputID,
          type: "synthetic",
          metadata: input.data.metadata,
          text: input.data.text,
          description: input.data.description,
          time: { created: event.created },
        })
      }
      case "session.next.agent.switched":
        return append({
          id: event.data.messageID,
          type: "agent-switched",
          agent: event.data.agent,
          time: { created: event.data.timestamp },
        })
      case "session.agent.selected":
        return append({
          id: messageID(event.id),
          type: "agent-switched",
          metadata: event.metadata,
          agent: event.data.agent,
          time: { created: event.created },
        })
      case "session.next.model.switched":
        return append({
          id: event.data.messageID,
          type: "model-switched",
          model: event.data.model,
          previous: source.findLast(
            (item): item is Extract<SessionMessageInfo, { type: "model-switched" | "assistant" }> =>
              item.type === "model-switched" || item.type === "assistant",
          )?.model,
          time: { created: event.data.timestamp },
        })
      case "session.model.selected":
        return append({
          id: messageID(event.id),
          type: "model-switched",
          metadata: event.metadata,
          model: event.data.model,
          previous: source.findLast(
            (item): item is Extract<SessionMessageInfo, { type: "model-switched" | "assistant" }> =>
              item.type === "model-switched" || item.type === "assistant",
          )?.model,
          time: { created: event.created },
        })
      case "session.next.synthetic":
        return append({
          id: event.data.messageID,
          type: "synthetic",
          text: event.data.text,
          description: event.data.kind,
          time: { created: event.data.timestamp },
        })
      case "session.synthetic":
        return append({
          id: messageID(event.id),
          type: "synthetic",
          metadata: event.data.metadata,
          text: event.data.text,
          description: event.data.description,
          time: { created: event.created },
        })
      case "session.skill.activated":
        return append({
          id: messageID(event.id),
          type: "skill",
          metadata: event.metadata,
          skill: event.data.id,
          name: event.data.name,
          text: event.data.text,
          time: { created: event.created },
        })
      case "session.next.shell.started":
        return append({
          id: event.data.messageID,
          type: "shell",
          shellID: event.data.callID,
          command: event.data.command,
          status: "running",
          time: { created: event.data.timestamp },
        })
      case "session.next.shell.delta":
        return updateMessage<Shell>(
          source,
          (item): item is Shell => item.type === "shell" && item.shellID === event.data.callID,
          (item) => {
            const output = (item.output?.output ?? "") + event.data.delta
            return {
              ...item,
              output: { output, cursor: output.length, size: output.length, truncated: false },
            }
          },
          sessionID,
        )
      case "session.next.shell.ended":
        return updateMessage<Shell>(
          source,
          (item): item is Shell => item.type === "shell" && item.shellID === event.data.callID,
          (item) => ({
            ...item,
            status: "exited",
            output: {
              output: event.data.output,
              cursor: event.data.output.length,
              size: event.data.output.length,
              truncated: false,
            },
            time: { ...item.time, completed: event.data.timestamp },
          }),
          sessionID,
        )
      case "session.shell.started":
        return append({
          id: messageID(event.id),
          type: "shell",
          metadata: event.metadata,
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          time: { created: event.created },
        })
      case "session.shell.ended":
        return updateMessage<Shell>(
          source,
          (item): item is Shell => item.type === "shell" && item.shellID === event.data.shell.id,
          (item) => ({
            ...item,
            status: event.data.shell.status,
            exit: event.data.shell.exit,
            output: event.data.output,
            time: { ...item.time, completed: event.created },
          }),
          sessionID,
        )
      case "session.next.step.started":
      case "session.step.started": {
        const created = eventTime(event)
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        const completed =
          current && current.id !== event.data.assistantMessageID
            ? update(source, current.id, (item) =>
                item.type === "assistant"
                  ? { ...item, retry: undefined, time: { ...item.time, completed: created } }
                  : item,
              )
            : [...source]
        const existing = completed.find((item) => item.id === event.data.assistantMessageID)
        // A terminal assistant message is immutable. A delayed/replayed start marker
        // must not turn a completed answer back into an in-flight row.
        if (existing?.type === "assistant" && existing.time.completed !== undefined) return result([...source])
        if (existing?.type === "assistant")
          return result(
            update(completed, existing.id, (item) =>
              item.type === "assistant"
                ? {
                    ...item,
                    agent: event.data.agent,
                    model: event.data.model,
                    retry: undefined,
                    error: undefined,
                    finish: undefined,
                    snapshot: event.data.snapshot ? { ...item.snapshot, start: event.data.snapshot } : item.snapshot,
                    time: { ...item.time, completed: undefined },
                  }
                : item,
            ),
            current && current.id !== existing.id ? [current.id, existing.id] : [existing.id],
          )
        return result(
          [
            ...completed,
            {
              id: event.data.assistantMessageID,
              type: "assistant",
              metadata: "created" in event ? event.metadata : undefined,
              agent: event.data.agent,
              model: event.data.model,
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
              time: { created },
            },
          ],
          current ? [current.id, event.data.assistantMessageID] : [event.data.assistantMessageID],
        )
      }
      case "session.next.step.ended":
      case "session.step.ended":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: legacyFinish(event.data.finish),
          cost: event.data.cost,
          tokens: event.data.tokens,
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
              : item.snapshot,
          time: { ...item.time, completed: eventTime(event) },
        }))
      case "session.next.step.failed":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: "error",
          error: event.data.error,
          retry: undefined,
          time: { ...item.time, completed: event.data.timestamp },
        }))
      case "session.step.failed":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          finish: "error",
          error: event.data.error,
          retry: undefined,
          cost: event.data.cost ?? item.cost,
          tokens: event.data.tokens ?? item.tokens,
          snapshot:
            event.data.snapshot || event.data.files
              ? { ...item.snapshot, end: event.data.snapshot, files: event.data.files }
              : item.snapshot,
          time: { ...item.time, completed: event.created },
        }))
      case "session.next.text.started": {
        const ordinal = contentOrdinal(sessionID, event.data.assistantMessageID, "text", event.data.textID)
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "text", ordinal, { type: "text", text: "" }),
        }))
      }
      case "session.next.text.delta": {
        const ordinal = contentOrdinal(sessionID, event.data.assistantMessageID, "text", event.data.textID)
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "text",
          ordinal,
          (item) => ({ ...item, text: item.text + event.data.delta }),
          { type: "text", text: event.data.delta },
        )
      }
      case "session.next.text.ended": {
        const ordinal = contentOrdinal(sessionID, event.data.assistantMessageID, "text", event.data.textID)
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "text",
          ordinal,
          (item) => ({ ...item, text: event.data.text }),
          { type: "text", text: event.data.text },
        )
      }
      case "session.text.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "text", event.data.ordinal, { type: "text", text: "" }),
        }))
      case "session.text.delta":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: item.text + event.data.delta,
        }))
      case "session.text.ended":
        return updateContent(source, event.data.assistantMessageID, sessionID, "text", event.data.ordinal, (item) => ({
          ...item,
          text: event.data.text,
        }))
      case "session.next.reasoning.started": {
        const ordinal = contentOrdinal(sessionID, event.data.assistantMessageID, "reasoning", event.data.reasoningID)
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "reasoning", ordinal, {
            type: "reasoning",
            text: "",
            time: { created: event.data.timestamp },
          }),
        }))
      }
      case "session.next.reasoning.delta": {
        const ordinal = contentOrdinal(sessionID, event.data.assistantMessageID, "reasoning", event.data.reasoningID)
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          ordinal,
          (item) => ({ ...item, text: item.text + event.data.delta }),
          {
            type: "reasoning",
            text: event.data.delta,
            time: { created: event.data.timestamp },
          },
        )
      }
      case "session.next.reasoning.ended": {
        const ordinal = contentOrdinal(sessionID, event.data.assistantMessageID, "reasoning", event.data.reasoningID)
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          ordinal,
          (item) => ({
            ...item,
            text: event.data.text,
            time: { created: item.time?.created ?? event.data.timestamp, completed: event.data.timestamp },
          }),
          {
            type: "reasoning",
            text: event.data.text,
            time: { created: event.data.timestamp, completed: event.data.timestamp },
          },
        )
      }
      case "session.reasoning.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: insertOrdinal(item.content, "reasoning", event.data.ordinal, {
            type: "reasoning",
            text: "",
            state: event.data.state,
            time: { created: event.created },
          }),
        }))
      case "session.reasoning.delta":
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          event.data.ordinal,
          (item) => ({
            ...item,
            text: item.text + event.data.delta,
          }),
        )
      case "session.reasoning.ended":
        return updateContent(
          source,
          event.data.assistantMessageID,
          sessionID,
          "reasoning",
          event.data.ordinal,
          (item) => ({
            ...item,
            text: event.data.text,
            state: event.data.state ?? item.state,
            time: { created: item.time?.created ?? event.created, completed: event.created },
          }),
        )
      case "session.next.tool.input.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: item.content.some((content) => content.type === "tool" && content.id === event.data.callID)
            ? item.content
            : [
                ...item.content,
                {
                  type: "tool",
                  id: event.data.callID,
                  name: event.data.name,
                  state: { status: "streaming", input: "" },
                  time: { created: event.data.timestamp },
                },
              ],
        }))
      case "session.next.tool.input.delta":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming"
            ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
            : tool,
        )
      case "session.next.tool.input.ended":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: event.data.text } } : tool,
        )
      case "session.next.tool.called":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => ({
          ...tool,
          name: event.data.tool,
          executed: event.data.provider.executed,
          providerState: legacyJsonRecord(event.data.provider.metadata),
          state: { status: "running", input: legacyJsonRecord(event.data.input) ?? {}, structured: {}, content: [] },
          time: { ...tool.time, ran: event.data.timestamp },
        }))
      case "session.next.tool.progress":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "running"
            ? {
                ...tool,
                state: {
                  ...tool.state,
                  structured: legacyJsonRecord(event.data.structured) ?? {},
                  content: event.data.content,
                },
              }
            : tool,
        )
      case "session.next.tool.success":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.provider.executed || tool.executed === true,
            providerResultState: legacyJsonRecord(event.data.provider.metadata),
            state: {
              status: "completed",
              input: tool.state.input,
              structured: legacyJsonRecord(event.data.structured) ?? {},
              content: event.data.content,
              result: legacyJsonValue(event.data.result),
            },
            time: { ...tool.time, completed: event.data.timestamp },
          }
        })
      case "session.next.tool.failed":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.provider.executed || tool.executed === true,
            providerResultState: legacyJsonRecord(event.data.provider.metadata),
            state: {
              status: "error",
              input: typeof tool.state.input === "string" ? {} : tool.state.input,
              structured: tool.state.status === "running" ? tool.state.structured : {},
              content: tool.state.status === "running" ? tool.state.content : [],
              error: event.data.error,
              result: legacyJsonValue(event.data.result),
            },
            time: { ...tool.time, completed: event.data.timestamp },
          }
        })
      case "session.tool.input.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          content: item.content.some((content) => content.type === "tool" && content.id === event.data.callID)
            ? item.content
            : [
                ...item.content,
                {
                  type: "tool",
                  id: event.data.callID,
                  name: event.data.name,
                  state: { status: "streaming", input: "" },
                  time: { created: event.created },
                },
              ],
        }))
      case "session.tool.input.delta":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming"
            ? { ...tool, state: { ...tool.state, input: tool.state.input + event.data.delta } }
            : tool,
        )
      case "session.tool.input.ended":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "streaming" ? { ...tool, state: { ...tool.state, input: event.data.text } } : tool,
        )
      case "session.tool.called":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => ({
          ...tool,
          executed: event.data.executed,
          providerState: event.data.state,
          state: { status: "running", input: event.data.input, structured: {}, content: [] },
          time: { ...tool.time, ran: event.created },
        }))
      case "session.tool.progress":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) =>
          tool.state.status === "running"
            ? { ...tool, state: { ...tool.state, structured: event.data.structured, content: event.data.content } }
            : tool,
        )
      case "session.tool.success":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "completed",
              input: tool.state.input,
              structured: event.data.structured,
              content: event.data.content,
              result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.tool.failed":
        return updateTool(source, event.data.assistantMessageID, event.data.callID, sessionID, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return tool
          return {
            ...tool,
            executed: event.data.executed || tool.executed === true,
            providerResultState: event.data.resultState,
            state: {
              status: "error",
              input: typeof tool.state.input === "string" ? {} : tool.state.input,
              structured: tool.state.status === "running" ? tool.state.structured : {},
              content: tool.state.status === "running" ? tool.state.content : [],
              error: event.data.error,
              result: event.data.result,
            },
            time: { ...tool.time, completed: event.created },
          }
        })
      case "session.retry.scheduled":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          retry: { attempt: event.data.attempt, at: event.data.at, error: event.data.error },
        }))
      case "session.next.retried": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        if (!current) return result([...source])
        return updateAssistant(source, current.id, sessionID, (item) => ({
          ...item,
          retry: {
            attempt: event.data.attempt,
            at: event.data.next,
            error: { type: "ProviderError", message: event.data.error.message },
          },
        }))
      }
      case "session.next.provider.attempt.started":
        return updateAssistant(source, event.data.assistantMessageID, sessionID, (item) => ({
          ...item,
          retry: undefined,
        }))
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        const current = source.findLast((item): item is Assistant => item.type === "assistant" && !item.time.completed)
        if (!current?.retry) return result([...source])
        return updateAssistant(source, current.id, sessionID, (item) => ({ ...item, retry: undefined }))
      }
      case "session.next.compaction.started":
        return append({
          id: event.data.messageID,
          type: "compaction",
          status: "running",
          metadata: legacyJsonRecord(event.metadata),
          reason: event.data.reason,
          summary: "",
          recent: "",
          time: { created: event.data.timestamp },
        })
      case "session.next.compaction.delta":
        return updateMessage<Extract<Compaction, { status: "running" }>>(
          source,
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running" && item.id === event.data.messageID,
          (item) => ({ ...item, summary: item.summary + event.data.text }),
          sessionID,
        )
      case "session.next.compaction.ended": {
        const current = source.find(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running" && item.id === event.data.messageID,
        )
        if (!current)
          return append({
            id: event.data.messageID,
            type: "compaction",
            status: "completed",
            metadata: legacyJsonRecord(event.metadata),
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.data.timestamp },
          })
        return result(
          update(source, current.id, () => ({
            ...current,
            status: "completed",
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
          })),
          [current.id],
        )
      }
      case "session.next.compaction.failed": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running" && item.id === event.data.messageID,
        )
        const failed: Extract<Compaction, { status: "failed" }> = {
          id: current?.id ?? event.data.messageID,
          type: "compaction",
          status: "failed",
          metadata: current?.metadata ?? legacyJsonRecord(event.metadata),
          reason: event.data.reason,
          error: event.data.error,
          time: current?.time ?? { created: event.data.timestamp },
        }
        if (!current) return append(failed)
        return result(update(source, current.id, () => failed), [failed.id])
      }
      case "session.compaction.started":
        return append({
          id: event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "running",
          metadata: event.metadata,
          reason: event.data.reason,
          summary: "",
          recent: event.data.recent,
          time: { created: event.created },
        })
      case "session.compaction.delta":
        return updateMessage<Extract<Compaction, { status: "running" }>>(
          source,
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
          (item) => ({
            ...item,
            summary: item.summary + event.data.text,
          }),
          sessionID,
        )
      case "session.compaction.ended": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
        )
        if (!current)
          return append({
            id: messageID(event.id),
            type: "compaction",
            status: "completed",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.created },
          })
        return result(
          update(source, current.id, () => ({
            ...current,
            status: "completed",
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
          })),
          [current.id],
        )
      }
      case "session.compaction.failed": {
        const current = source.findLast(
          (item): item is Extract<Compaction, { status: "running" }> =>
            item.type === "compaction" && item.status === "running",
        )
        const failed: Extract<Compaction, { status: "failed" }> = {
          id: current?.id ?? event.data.inputID ?? messageID(event.id),
          type: "compaction",
          status: "failed",
          metadata: current?.metadata ?? event.metadata,
          reason: event.data.reason,
          error: event.data.error,
          time: current?.time ?? { created: event.created },
        }
        if (!current) return append(failed)
        return result(
          update(source, current.id, () => failed),
          [failed.id],
        )
      }
      default:
        return
    }
  }

  return {
    reduce,
    clear(sessionID: string) {
      for (const id of pending.keys()) {
        if (id.startsWith(`${sessionID}:`)) pending.delete(id)
      }
      for (const id of contentIDs.keys()) {
        if (id.startsWith(`${sessionID}:`)) contentIDs.delete(id)
      }
    },
  }
}

function key(sessionID: string, inputID: string) {
  return `${sessionID}:${inputID}`
}

function messageID(eventID: string) {
  return eventID.replace(/^evt_/, "msg_")
}

function update(
  source: readonly SessionMessageInfo[],
  id: string,
  apply: (item: SessionMessageInfo) => SessionMessageInfo,
) {
  return source.map((item) => (item.id === id ? apply(item) : item))
}

function updateMessage<T extends SessionMessageInfo>(
  source: readonly SessionMessageInfo[],
  matches: (item: SessionMessageInfo) => item is T,
  apply: (item: T) => T,
  sessionID: string,
): V2SessionReduction {
  const current = source.findLast(matches)
  if (!current) return { sessionID, messages: [...source], touched: [] }
  return {
    sessionID,
    messages: update(source, current.id, (item) => (matches(item) ? apply(item) : item)),
    touched: [current.id],
  }
}

function updateAssistant(
  source: readonly SessionMessageInfo[],
  id: string,
  sessionID: string,
  apply: (item: Assistant) => Assistant,
): V2SessionReduction {
  if (!source.some((item) => item.id === id && item.type === "assistant"))
    return { sessionID, messages: [...source], touched: [], missing: id }
  return {
    sessionID,
    messages: update(source, id, (item) => (item.type === "assistant" ? apply(item) : item)),
    touched: [id],
  }
}

function updateContent<T extends "text" | "reasoning">(
  source: readonly SessionMessageInfo[],
  messageID: string,
  sessionID: string,
  type: T,
  ordinal: number,
  apply: (
    item: Extract<Assistant["content"][number], { type: T }>,
  ) => Extract<Assistant["content"][number], { type: T }>,
  fallback?: Extract<Assistant["content"][number], { type: T }>,
) {
  return updateAssistant(source, messageID, sessionID, (assistant) => {
    let index = -1
    let found = false
    const content = assistant.content.map((item) => {
      if (item.type !== type || ++index !== ordinal) return item
      found = true
      return apply(item as Extract<Assistant["content"][number], { type: T }>)
    })
    return {
      ...assistant,
      content: found || !fallback ? content : [...content, fallback],
    }
  })
}

function eventTime(event: OpenCodeEvent | LegacyV2Event | V2Event) {
  if ("timestamp" in event.data && typeof event.data.timestamp === "number") return event.data.timestamp
  return "created" in event && typeof event.created === "number" ? event.created : Date.now()
}

function legacyFinish(value: string): Assistant["finish"] {
  if (
    value === "stop" ||
    value === "length" ||
    value === "tool-calls" ||
    value === "content-filter" ||
    value === "error"
  )
    return value
  return "unknown"
}

function legacyJsonRecord(value: Readonly<Record<string, unknown>> | undefined) {
  return value as Record<string, JsonValue> | undefined
}

function legacyJsonValue(value: unknown) {
  return value as JsonValue | undefined
}

function updateTool(
  source: readonly SessionMessageInfo[],
  messageID: string,
  callID: string,
  sessionID: string,
  apply: (
    item: Extract<Assistant["content"][number], { type: "tool" }>,
  ) => Extract<Assistant["content"][number], { type: "tool" }>,
) {
  const assistant = source.find((item): item is Assistant => item.type === "assistant" && item.id === messageID)
  if (assistant && !assistant.content.some((item) => item.type === "tool" && item.id === callID))
    return { sessionID, messages: [...source], touched: [], missing: messageID }
  return updateAssistant(source, messageID, sessionID, (assistant) => ({
    ...assistant,
    content: assistant.content.map((item) => (item.type === "tool" && item.id === callID ? apply(item) : item)),
  }))
}

function insertOrdinal<T extends Assistant["content"][number]["type"]>(
  source: Assistant["content"],
  type: T,
  ordinal: number,
  item: Extract<Assistant["content"][number], { type: T }>,
) {
  const matches = source.filter((content) => content.type === type)
  if (matches[ordinal]) return source
  return [...source, item]
}
