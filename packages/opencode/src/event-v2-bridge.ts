// Opencode publish boundary for core events. Attach routed instance location
// so direct EventV2 consumers can isolate directory/workspace streams.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Identifier } from "@/id/id"
import { PartID, SessionID } from "@/session/schema"
import { Context, DateTime, Effect, Layer } from "effect"

export class Service extends Context.Service<Service, EventV2.Interface>()("@opencode/EventV2Bridge") {}

export type LegacyEvent = {
  readonly id: string
  readonly type: string
  readonly properties: Record<string, unknown>
}

type ModelRef = {
  readonly id: string
  readonly providerID: string
  readonly variant?: string
}

type AssistantState = {
  readonly sessionID: string
  readonly messageID: string
  readonly parentID: string
  readonly agent: string
  readonly model: ModelRef
  readonly directory: string
  readonly created: number
  readonly snapshot?: string
  readonly text: Map<string, { readonly index: number; readonly started: number }>
  readonly reasoning: Map<string, { readonly index: number; readonly started: number }>
  readonly tools: Map<
    string,
    {
      readonly index: number
      readonly name: string
      readonly created: number
      input: Record<string, unknown>
      ran?: number
      structured: Record<string, unknown>
      content: ReadonlyArray<
        | { readonly type: "text"; readonly text: string }
        | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }
      >
      metadata?: Record<string, unknown>
    }
  >
  nextIndex: number
  completed?: number
  finish?: string
  cost: number
  tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cache: { readonly read: number; readonly write: number }
  }
  error?: { readonly name: string; readonly data: { readonly message: string } }
}

const epochMillis = (value: unknown) =>
  typeof value === "number" ? value : DateTime.toEpochMillis(value as DateTime.Utc)

const inputRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Projects canonical session events into the legacy live-event contract without persisting V1 events. */
export function legacyEventProjection() {
  const parents = new Map<string, string>()
  const assistants = new Map<string, AssistantState>()
  const key = (sessionID: string, assistantMessageID: string) => `${sessionID}:${assistantMessageID}`
  const messageID = (value: string) => Identifier.ascendingOr("message", value)
  const partID = (state: AssistantState, type: string, index: number) =>
    PartID.ascending(`prt_${state.messageID}_${type}_${index}`)
  const event = (type: string, properties: Record<string, unknown>): LegacyEvent => ({
    id: EventV2.ID.create(),
    type,
    properties,
  })
  const part = (state: AssistantState, value: Record<string, unknown>, time: number) =>
    event("message.part.updated", {
      sessionID: SessionID.make(state.sessionID),
      part: value,
      time,
    })
  const info = (state: AssistantState) => ({
    id: state.messageID,
    sessionID: SessionID.make(state.sessionID),
    parentID: state.parentID,
    role: "assistant" as const,
    mode: state.agent,
    agent: state.agent,
    modelID: state.model.id,
    providerID: state.model.providerID,
    ...(state.model.variant === undefined || state.model.variant === "default" ? {} : { variant: state.model.variant }),
    path: { cwd: state.directory, root: state.directory },
    time: { created: state.created, ...(state.completed === undefined ? {} : { completed: state.completed }) },
    cost: state.cost,
    tokens: state.tokens,
    ...(state.finish === undefined ? {} : { finish: state.finish }),
    ...(state.error === undefined ? {} : { error: state.error }),
  })
  const updated = (state: AssistantState) =>
    event("message.updated", {
      sessionID: SessionID.make(state.sessionID),
      info: info(state),
    })
  const allocate = (state: AssistantState) => state.nextIndex++
  const toolOutput = (content: AssistantState["tools"] extends Map<string, infer T> ? T : never) =>
    content.content.map((item) => (item.type === "text" ? item.text : item.uri)).join("\n")
  const toolPart = (
    state: AssistantState,
    tool: AssistantState["tools"] extends Map<string, infer T> ? T : never,
    status: "pending" | "running" | "completed" | "error",
    timestamp: number,
    errorMessage?: string,
  ) => {
    const base = {
      id: partID(state, "tool", tool.index),
      sessionID: SessionID.make(state.sessionID),
      messageID: state.messageID,
      type: "tool" as const,
      callID: Array.from(state.tools.entries()).find(([, value]) => value === tool)?.[0] ?? "",
      tool: tool.name,
      ...(tool.metadata === undefined ? {} : { metadata: tool.metadata }),
    }
    if (status === "pending")
      return {
        ...base,
        state: { status, input: tool.input, raw: "" },
      }
    if (status === "running")
      return {
        ...base,
        state: {
          status,
          input: tool.input,
          title: typeof tool.structured.title === "string" ? tool.structured.title : tool.name,
          metadata: tool.structured,
          time: { start: tool.ran ?? tool.created },
        },
      }
    if (status === "error")
      return {
        ...base,
        state: {
          status,
          input: tool.input,
          error: errorMessage ?? "Tool execution failed",
          metadata: tool.structured,
          time: { start: tool.ran ?? tool.created, end: timestamp },
        },
      }
    const files = tool.content.filter(
      (item): item is Extract<(typeof tool.content)[number], { type: "file" }> => item.type === "file",
    )
    return {
      ...base,
      state: {
        status,
        input: tool.input,
        output: toolOutput(tool),
        title: typeof tool.structured.title === "string" ? tool.structured.title : tool.name,
        metadata: tool.structured,
        time: { start: tool.ran ?? tool.created, end: timestamp },
        ...(files.length === 0
          ? {}
          : {
              attachments: files.map((file, index) => ({
                id: partID(state, `tool-file-${tool.index}`, index),
                sessionID: SessionID.make(state.sessionID),
                messageID: state.messageID,
                type: "file" as const,
                mime: file.mime,
                filename: file.name,
                url: file.uri,
              })),
            }),
      },
    }
  }

  return (source: EventV2.Payload): ReadonlyArray<LegacyEvent> => {
    const data = source.data as Record<string, any>
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : undefined
    if (!sessionID) return []

    if (source.type === "session.next.transcript.message.removed") {
      return [
        event("message.removed", {
          sessionID: SessionID.make(sessionID),
          messageID: Identifier.ascendingOr("message", String(data.messageID)),
        }),
      ]
    }
    if (source.type === "session.next.transcript.user-text.removed") {
      return [
        event("message.part.removed", {
          sessionID: SessionID.make(sessionID),
          messageID: Identifier.ascendingOr("message", String(data.messageID)),
          partID: Identifier.ascendingOr("part", String(data.partID)),
        }),
      ]
    }
    if (source.type === "session.next.transcript.user-text.updated") {
      return [
        event("message.part.updated", {
          sessionID: SessionID.make(sessionID),
          part: {
            id: Identifier.ascendingOr("part", String(data.partID)),
            sessionID: SessionID.make(sessionID),
            messageID: Identifier.ascendingOr("message", String(data.messageID)),
            type: "text",
            text: String(data.text),
          },
          time: epochMillis(data.timestamp),
        }),
      ]
    }
    if (source.type === "session.next.transcript.content.removed") {
      return [
        event("message.part.removed", {
          sessionID: SessionID.make(sessionID),
          messageID: Identifier.ascendingOr("message", String(data.assistantMessageID)),
          partID: Identifier.ascendingOr("part", String(data.partID)),
        }),
      ]
    }
    if (source.type === "session.next.transcript.content.updated") {
      const content = data.content as Record<string, unknown>
      if (content.type !== "text" && content.type !== "reasoning") return []
      return [
        event("message.part.updated", {
          sessionID: SessionID.make(sessionID),
          part: {
            id: Identifier.ascendingOr("part", String(data.partID)),
            sessionID: SessionID.make(sessionID),
            messageID: Identifier.ascendingOr("message", String(data.assistantMessageID)),
            type: content.type,
            text: String(content.text),
            ...(content.type === "reasoning"
              ? {
                  metadata: content.providerMetadata,
                  time: {
                    start: epochMillis((content.time as Record<string, unknown> | undefined)?.created ?? data.timestamp),
                    ...((content.time as Record<string, unknown> | undefined)?.completed === undefined
                      ? {}
                      : {
                          end: epochMillis(
                            (content.time as Record<string, unknown> | undefined)?.completed,
                          ),
                        }),
                  },
                }
              : {}),
          },
          time: epochMillis(data.timestamp),
        }),
      ]
    }

    if (source.type === "session.next.prompted") {
      parents.set(sessionID, messageID(String(data.messageID)))
      return []
    }

    if (source.type === "session.next.step.started") {
      const assistantMessageID = String(data.assistantMessageID)
      const created = epochMillis(data.timestamp)
      const state: AssistantState = {
        sessionID,
        messageID: messageID(assistantMessageID),
        parentID: parents.get(sessionID) ?? messageID(assistantMessageID),
        agent: String(data.agent),
        model: data.model as ModelRef,
        directory: String(source.location?.directory ?? ""),
        created,
        snapshot: typeof data.snapshot === "string" ? data.snapshot : undefined,
        text: new Map(),
        reasoning: new Map(),
        tools: new Map(),
        nextIndex: 0,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      assistants.set(key(sessionID, assistantMessageID), state)
      return [
        updated(state),
        part(
          state,
          {
            id: partID(state, "step-start", 0),
            sessionID: SessionID.make(sessionID),
            messageID: state.messageID,
            type: "step-start",
            ...(state.snapshot === undefined ? {} : { snapshot: state.snapshot }),
          },
          created,
        ),
      ]
    }

    const assistantMessageID = String(data.assistantMessageID ?? "")
    const state = assistants.get(key(sessionID, assistantMessageID))
    if (!state) return []
    const timestamp = epochMillis(data.timestamp)

    if (source.type === "session.next.text.started") {
      const textID = String(data.textID)
      const item = { index: allocate(state), started: timestamp }
      state.text.set(textID, item)
      return [
        part(
          state,
          {
            id: partID(state, "text", item.index),
            sessionID: SessionID.make(sessionID),
            messageID: state.messageID,
            type: "text",
            text: "",
            time: { start: timestamp },
          },
          timestamp,
        ),
      ]
    }
    if (source.type === "session.next.text.ended") {
      const textID = String(data.textID)
      const item = state.text.get(textID) ?? { index: allocate(state), started: timestamp }
      state.text.set(textID, item)
      return [
        part(
          state,
          {
            id: partID(state, "text", item.index),
            sessionID: SessionID.make(sessionID),
            messageID: state.messageID,
            type: "text",
            text: String(data.text),
            time: { start: item.started, end: timestamp },
          },
          timestamp,
        ),
      ]
    }
    if (source.type === "session.next.reasoning.started") {
      const reasoningID = String(data.reasoningID)
      const item = { index: allocate(state), started: timestamp }
      state.reasoning.set(reasoningID, item)
      return [
        part(
          state,
          {
            id: partID(state, "reasoning", item.index),
            sessionID: SessionID.make(sessionID),
            messageID: state.messageID,
            type: "reasoning",
            text: "",
            time: { start: timestamp },
            ...(data.providerMetadata === undefined ? {} : { metadata: data.providerMetadata }),
          },
          timestamp,
        ),
      ]
    }
    if (source.type === "session.next.reasoning.ended") {
      const reasoningID = String(data.reasoningID)
      const item = state.reasoning.get(reasoningID) ?? { index: allocate(state), started: timestamp }
      state.reasoning.set(reasoningID, item)
      return [
        part(
          state,
          {
            id: partID(state, "reasoning", item.index),
            sessionID: SessionID.make(sessionID),
            messageID: state.messageID,
            type: "reasoning",
            text: String(data.text),
            time: { start: item.started, end: timestamp },
            ...(data.providerMetadata === undefined ? {} : { metadata: data.providerMetadata }),
          },
          timestamp,
        ),
      ]
    }
    if (source.type === "session.next.tool.input.started") {
      const callID = String(data.callID)
      const tool = {
        index: allocate(state),
        name: String(data.name),
        created: timestamp,
        input: {},
        structured: {},
        content: [],
      }
      state.tools.set(callID, tool)
      return [part(state, toolPart(state, tool, "pending", timestamp), timestamp)]
    }
    if (source.type === "session.next.tool.input.ended") {
      const tool = state.tools.get(String(data.callID))
      if (!tool) return []
      tool.input = inputRecord(data.text)
      return [part(state, toolPart(state, tool, "pending", timestamp), timestamp)]
    }
    if (source.type === "session.next.tool.called") {
      const tool = state.tools.get(String(data.callID))
      if (!tool) return []
      tool.input = inputRecord(data.input)
      tool.ran = timestamp
      tool.metadata = data.provider?.metadata
      return [part(state, toolPart(state, tool, "running", timestamp), timestamp)]
    }
    if (source.type === "session.next.tool.progress") {
      const tool = state.tools.get(String(data.callID))
      if (!tool) return []
      tool.structured = inputRecord(data.structured)
      tool.content = data.content ?? []
      return [part(state, toolPart(state, tool, "running", timestamp), timestamp)]
    }
    if (source.type === "session.next.tool.success") {
      const tool = state.tools.get(String(data.callID))
      if (!tool) return []
      tool.structured = inputRecord(data.structured)
      tool.content = data.content ?? []
      return [part(state, toolPart(state, tool, "completed", timestamp), timestamp)]
    }
    if (source.type === "session.next.tool.failed") {
      const tool = state.tools.get(String(data.callID))
      if (!tool) return []
      return [
        part(state, toolPart(state, tool, "error", timestamp, String(data.error?.message ?? data.error)), timestamp),
      ]
    }
    if (source.type === "session.next.step.ended") {
      state.completed = timestamp
      state.finish = String(data.finish)
      state.cost = Number(data.cost)
      state.tokens = data.tokens
      assistants.delete(key(sessionID, assistantMessageID))
      return [
        part(
          state,
          {
            id: partID(state, "step-finish", state.nextIndex),
            sessionID: SessionID.make(sessionID),
            messageID: state.messageID,
            type: "step-finish",
            reason: state.finish,
            ...(data.snapshot === undefined ? {} : { snapshot: data.snapshot }),
            cost: state.cost,
            tokens: state.tokens,
          },
          timestamp,
        ),
        updated(state),
      ]
    }
    if (source.type === "session.next.step.failed") {
      const message = String(data.error?.message ?? data.error)
      state.completed = timestamp
      state.finish = "error"
      state.error = { name: "UnknownError", data: { message } }
      assistants.delete(key(sessionID, assistantMessageID))
      return [updated(state)]
    }
    return []
  }
}

export function legacyEventPayloads(
  projectLegacy: ReturnType<typeof legacyEventProjection>,
  source: EventV2.Payload,
): ReadonlyArray<LegacyEvent> {
  if (source.type === SessionEvent.ToolDiscovery.Completed.type) return []
  const projected = projectLegacy(source)
  return projected.length === 0
    ? [
        {
          id: source.id,
          type: source.type,
          properties: source.data as Record<string, unknown>,
        },
      ]
    : projected
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service

    const publish: EventV2.Interface["publish"] = (definition, data, options) =>
      Effect.gen(function* () {
        if (options?.location) return yield* events.publish(definition, data, options)
        const ctx = yield* InstanceRef
        if (!ctx) return yield* events.publish(definition, data, options)
        const workspaceID = yield* WorkspaceRef
        return yield* events.publish(definition, data, {
          ...options,
          location: new Location.Info({
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID ? { workspaceID } : {}),
            project: { id: Project.ID.make(ctx.project.id), directory: AbsolutePath.make(ctx.worktree) },
          }),
        })
      })

    const projectLegacy = legacyEventProjection()
    const unsubscribe = yield* events.listen((event) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceRef
        const workspaceID = (yield* WorkspaceRef) ?? event.location?.workspaceID
        const routing = {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
        }
        for (const payload of legacyEventPayloads(projectLegacy, event)) {
          GlobalBus.emit("event", { ...routing, payload })
        }
        if (event.durable === undefined) return
        GlobalBus.emit("event", {
          directory: event.location?.directory ?? ctx?.directory,
          project: ctx?.project.id,
          workspace: workspaceID,
          payload: {
            type: "sync",
            syncEvent: {
              id: event.id,
              type: EventV2.versionedType(event.type, event.durable.version),
              seq: event.durable.seq,
              aggregateID: event.durable.aggregateID,
              data: event.data,
            },
          },
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    return Service.of({ ...events, publish })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [EventV2.node] })

export * as EventV2Bridge from "./event-v2-bridge"
