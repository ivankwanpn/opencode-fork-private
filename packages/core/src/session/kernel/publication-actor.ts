export * as PublicationActor from "./publication-actor"

import { DateTime, Deferred, Duration, Effect, Queue, Ref } from "effect"
import { LLMEvent, ToolOutput, type ToolCall, type Usage } from "@opencode-ai/llm"
import { EventV2 } from "../../event"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import type { Location } from "../../location"
import type { ModelV2 } from "../../model"
import { Checkpoint, DefaultCheckpointPolicy } from "./checkpoint"
import type { CheckpointKind, PendingCheckpoint } from "./checkpoint"
import type { InterruptReason, TurnOutcome } from "./types"
import type { ToolSettlement } from "./tool-scheduler"

export type PublicationCommand =
  | { readonly type: "provider-event"; readonly event: LLMEvent }
  | { readonly type: "checkpoint"; readonly generation: number }
  | { readonly type: "barrier"; readonly reply: Deferred.Deferred<void> }
  | { readonly type: "interrupt"; readonly reason: InterruptReason }
  | { readonly type: "close"; readonly outcome: TurnOutcome }
  | { readonly type: "tool-settlement"; readonly settlement: ToolSettlement }
  | { readonly type: "tool-started"; readonly callID: string }
  | { readonly type: "tool-interrupted"; readonly callID: string; readonly outcome: "cancelled" | "abandoned" }

/**
 * The sole owner of mutable provider-turn publication state: assistant
 * identity, text/reasoning fragments, attempt identity, step settlement, and
 * close state. Provider readers, tools, compaction, and notifications
 * communicate only through typed actor commands.
 */
export interface Interface {
  readonly sessionID: SessionSchema.ID
  readonly attemptID: EventV2.ID
  readonly assistantMessageID: SessionMessage.ID
  /** Bounded FIFO offer; false means capacity exhaustion (backpressure). */
  readonly offer: (command: PublicationCommand) => Effect.Effect<boolean>
  /** Waits until every command offered before the barrier is processed. */
  readonly barrier: Effect.Effect<void>
  /** Durable-boundary-safe interrupt signal with high-priority ingress. */
  readonly interrupt: (reason: InterruptReason) => Effect.Effect<void>
  readonly close: (outcome: TurnOutcome) => Effect.Effect<readonly EventV2.BatchItem[]>
  readonly outcome: Effect.Effect<TurnOutcome | undefined>
  readonly interrupted: Effect.Effect<boolean>
  readonly assistantStarted: Effect.Effect<boolean>
  readonly finished: Effect.Effect<boolean>
  readonly error: Effect.Effect<SessionEvent.ErrorInfo | undefined>
  /** Provider tool calls collected this turn, in model order. */
  readonly toolCalls: Effect.Effect<readonly ToolCall[]>
  /** Publishes Tool.Called + Tool.Success/Tool.Failed for settled calls, in order. */
  readonly publishSettlements: (settlements: readonly ToolSettlement[]) => Effect.Effect<void>
  readonly toolStarted: (callID: string) => Effect.Effect<void>
  readonly toolInterrupted: (callID: string, outcome: "cancelled" | "abandoned") => Effect.Effect<void>
}

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

const tokens = (usage: Usage | undefined) => ({
  input: safe(usage?.nonCachedInputTokens),
  output: safe(usage?.visibleOutputTokens),
  reasoning: safe(usage?.reasoningTokens),
  cache: { read: safe(usage?.cacheReadInputTokens), write: safe(usage?.cacheWriteInputTokens) },
})

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : { value }

const message = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Creates the PublicationActor for one kernel turn; the processor runs in the caller's scope. */
export const make = Effect.fn("PublicationActor.make")(function* (
  events: EventV2.Interface,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly attemptID: EventV2.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly agent: string
    readonly model: ModelV2.Ref
    readonly location?: Location.Ref
    /** Durable checkpoint sink; the caller commits the incremental batch under the active lease. */
    readonly flush?: (items: readonly EventV2.BatchItem[]) => Effect.Effect<boolean>
    /** Atomically records first response and advances the fenced execution phase. */
    readonly responseStarted?: (item: EventV2.BatchItem) => Effect.Effect<boolean>
    readonly policy?: Checkpoint.CheckpointPolicy
  },
) {
  const queue = yield* Queue.bounded<PublicationCommand>(256)
  interface ActorState {
    readonly responseStarted: boolean
    readonly assistantStarted: boolean
    readonly stepOpen: boolean
    readonly closing: boolean
    readonly interrupted: boolean
    readonly finished: boolean
    readonly outcome: TurnOutcome | undefined
    readonly error: SessionEvent.ErrorInfo | undefined
  }
  const state = yield* Ref.make<ActorState>({
    responseStarted: false,
    assistantStarted: false,
    stepOpen: false,
    closing: false,
    interrupted: false,
    finished: false,
    outcome: undefined,
    error: undefined,
  })
  const textChunks = new Map<string, string[]>()
  const reasoningChunks = new Map<string, string[]>()
  const openText = new Set<string>()
  const openReasoning = new Set<string>()
  const openToolInputs = new Set<string>()
  const toolInputs = new Map<
    string,
    {
      name: string
      ended: boolean
      called: boolean
      settled: boolean
      started: boolean
      input?: unknown
      providerMetadata?: ToolCall["providerMetadata"]
      providerExecuted: boolean
      interruption?: "cancelled" | "abandoned"
    }
  >()

  const toolInputChunks = new Map<string, string[]>()
  const toolCallsRef = yield* Ref.make<ToolCall[]>([])
  const policy = input.policy ?? DefaultCheckpointPolicy
  const buffer = yield* Checkpoint.makeBuffer()
  const closed = yield* Deferred.make<readonly EventV2.BatchItem[]>()
  const failed = yield* Deferred.make<void>()
  const checkpointTimer = yield* Ref.make({ generation: 0, armed: false })

  const publishLive = <D extends EventV2.Definition>(definition: D, data: EventV2.Data<D>) =>
    Effect.gen(function* () {
      if ((yield* Ref.get(state)).interrupted) return
      yield* events.publish(definition, data, input.location === undefined ? undefined : { location: input.location })
    })

  const markFence = (accepted: boolean) =>
    accepted ? Effect.void : Ref.update(state, (current) => ({ ...current, interrupted: true }))

  const publishDurable = <D extends EventV2.Definition>(definition: D, data: EventV2.Data<D>) =>
    (input.flush
      ? input.flush([{ definition, data }])
      : events
          .publish(definition, data, input.location === undefined ? undefined : { location: input.location })
          .pipe(Effect.as(true))
    ).pipe(Effect.tap(markFence))

  const toBatchItems = (items: readonly PendingCheckpoint[]): Effect.Effect<readonly EventV2.BatchItem[]> =>
    Effect.gen(function* () {
      const timestamp = yield* DateTime.now
      return items.map((item) => {
        if (item.kind === "text")
          return {
            definition: SessionEvent.Text.Checkpoint,
            data: {
              sessionID: input.sessionID,
              timestamp,
              assistantMessageID: input.assistantMessageID,
              textID: item.key,
              text: item.text,
            },
          }
        if (item.kind === "reasoning")
          return {
            definition: SessionEvent.Reasoning.Checkpoint,
            data: {
              sessionID: input.sessionID,
              timestamp,
              assistantMessageID: input.assistantMessageID,
              reasoningID: item.key,
              text: item.text,
            },
          }
        return {
          definition: SessionEvent.Tool.Input.Checkpoint,
          data: {
            sessionID: input.sessionID,
            timestamp,
            assistantMessageID: input.assistantMessageID,
            callID: item.key,
            text: item.text,
          },
        }
      })
    })

  const flushIfAny: Effect.Effect<boolean> = Effect.gen(function* () {
    const items = yield* buffer.drain()
    yield* Ref.update(checkpointTimer, (current) => ({ generation: current.generation + 1, armed: false }))
    if (!input.flush || items.length === 0) return true
    const batch = yield* toBatchItems(items)
    return yield* input.flush(batch).pipe(Effect.tap(markFence))
  })

  const scheduleCheckpoint = Effect.fn("PublicationActor.scheduleCheckpoint")(function* () {
    const generation = yield* Ref.modify(checkpointTimer, (current) =>
      current.armed
        ? ([undefined, current] as const)
        : ([current.generation + 1, { generation: current.generation + 1, armed: true }] as const),
    )
    if (generation === undefined) return
    yield* Effect.raceFirst(
      Deferred.await(closed),
      Effect.sleep(policy.interval).pipe(
        Effect.andThen(Queue.offer(queue, { type: "checkpoint", generation })),
        Effect.asVoid,
      ),
    ).pipe(Effect.forkScoped)
  })

  const bufferDelta = Effect.fn("PublicationActor.bufferDelta")(function* (
    kind: CheckpointKind,
    key: string,
    text: string,
  ) {
    yield* buffer.offer(kind, key, text)
    if ((yield* buffer.pendingBytes) >= policy.bytes) return yield* flushIfAny
    yield* scheduleCheckpoint()
    return true
  })

  const publishToolStarted = Effect.fn("PublicationActor.publishToolStarted")(function* (callID: string) {
    const call = (yield* Ref.get(toolCallsRef)).find((item) => item.id === callID)
    if (!call) return yield* Effect.die(`Start for unknown local tool call: ${callID}`)
    const tool = toolInputs.get(callID)
    if (!tool?.called) return yield* Effect.die(`Tool started before call: ${callID}`)
    if (tool.started) return true
    if (
      !(yield* publishDurable(SessionEvent.Tool.Called, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        callID,
        tool: call.name,
        input: record(call.input),
        provider: {
          executed: false,
          ...(call.providerMetadata === undefined ? {} : { metadata: call.providerMetadata }),
        },
      }))
    )
      return false
    tool.started = true
    return true
  })

  const publishSettlement = Effect.fn("PublicationActor.publishSettlement")(function* (settlement: ToolSettlement) {
    const call = (yield* Ref.get(toolCallsRef)).find((item) => item.id === settlement.callID)
    if (!call) return yield* Effect.die(`Settlement for unknown tool call: ${settlement.callID}`)
    const tool = toolInputs.get(call.id)
    if (!tool?.called) return yield* Effect.die(`Settlement before tool call: ${call.id}`)
    if (tool.settled) return yield* Effect.die(`Duplicate tool settlement: ${call.id}`)
    if (!(yield* publishToolStarted(call.id))) return
    const result = settlement.result?.result
    if (settlement.outcome === "success" && result && result.type !== "error") {
      const output = settlement.result?.output ?? ToolOutput.fromResultValue(result)
      if (!output) return yield* Effect.die(`Unsupported tool result for ${call.name}`)
      if (
        !(yield* publishDurable(SessionEvent.Tool.Success, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          callID: call.id,
          structured: record(output.structured),
          content: output.content,
          ...(settlement.result?.outputPaths === undefined ? {} : { outputPaths: settlement.result.outputPaths }),
          provider: { executed: false },
        }))
      )
        return
      tool.settled = true
      return
    }
    const failure =
      result?.type === "error" ? result : { type: "error" as const, value: settlement.error?.message ?? "Tool failed" }
    if (
      !(yield* publishDurable(SessionEvent.Tool.Failed, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        callID: call.id,
        error: { type: "unknown", message: message(failure.value) },
        result: failure,
        provider: { executed: false },
      }))
    )
      return
    tool.settled = true
  })

  const startToolInput = Effect.fn("PublicationActor.startToolInput")(function* (event: {
    readonly id: string
    readonly name: string
  }) {
    if (toolInputs.has(event.id)) return yield* Effect.die(`Duplicate tool input start: ${event.id}`)
    if (
      !(yield* publishDurable(SessionEvent.Tool.Input.Started, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        callID: event.id,
        name: event.name,
      }))
    )
      return false
    toolInputs.set(event.id, {
      name: event.name,
      ended: false,
      called: false,
      settled: false,
      started: false,
      providerExecuted: false,
    })
    openToolInputs.add(event.id)
    toolInputChunks.set(event.id, [])
    yield* buffer.offer("tool-input", event.id, "")
    return true
  })

  const endToolInput = Effect.fn("PublicationActor.endToolInput")(function* (event: {
    readonly id: string
    readonly name: string
  }) {
    const tool = toolInputs.get(event.id)
    if (!tool) return yield* Effect.die(`Tool input end before start: ${event.id}`)
    if (tool.name !== event.name)
      return yield* Effect.die(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`)
    if (tool.ended) return yield* Effect.die(`Duplicate tool input end: ${event.id}`)
    const value = toolInputChunks.get(event.id)?.join("") ?? ""
    if (!(yield* flushIfAny)) return false
    if (
      !(yield* publishDurable(SessionEvent.Tool.Input.Ended, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        callID: event.id,
        text: value,
      }))
    )
      return false
    openToolInputs.delete(event.id)
    toolInputChunks.delete(event.id)
    yield* buffer.close(event.id)
    tool.ended = true
    return true
  })
  const publishLLMEvent = Effect.fn("PublicationActor.publishLLMEvent")(function* (event: LLMEvent) {
    if (!LLMEvent.is.providerError(event))
      yield* Ref.update(state, (current) => ({ ...current, assistantStarted: true }))
    const firstResponse = yield* Ref.modify(state, (current) =>
      current.responseStarted ? ([false, current] as const) : ([true, { ...current, responseStarted: true }] as const),
    )
    if (firstResponse) {
      const data = {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        attemptID: input.attemptID,
      }
      const accepted = input.responseStarted
        ? yield* input.responseStarted({ definition: SessionEvent.ProviderAttempt.ResponseStarted, data })
        : yield* publishDurable(SessionEvent.ProviderAttempt.ResponseStarted, data)
      if (!accepted) {
        yield* Ref.update(state, (current) => ({ ...current, interrupted: true }))
        return
      }
    }

    if (LLMEvent.is.stepStart(event)) {
      if ((yield* Ref.get(state)).stepOpen) return yield* Effect.die("Duplicate provider step start")
      if (
        !(yield* publishDurable(SessionEvent.Step.Started, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          agent: input.agent,
          model: input.model,
        }))
      )
        return
      yield* Ref.update(state, (current) => ({ ...current, stepOpen: true }))
      return
    }
    if (LLMEvent.is.textStart(event)) {
      if (
        !(yield* publishDurable(SessionEvent.Text.Started, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          textID: event.id,
        }))
      )
        return
      openText.add(event.id)
      textChunks.set(event.id, [])
      return
    }
    if (LLMEvent.is.textDelta(event)) {
      if (!openText.has(event.id)) return yield* Effect.die(`Text delta before start: ${event.id}`)
      textChunks.get(event.id)!.push(event.text)
      if (!(yield* bufferDelta("text", event.id, event.text))) return
      yield* publishLive(SessionEvent.Text.Delta, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        textID: event.id,
        delta: event.text,
      })
      return
    }
    if (LLMEvent.is.textEnd(event)) {
      if (!openText.has(event.id)) return yield* Effect.die(`Text end before start: ${event.id}`)
      const value = textChunks.get(event.id)!.join("")
      // Capture the incremental tail before the authoritative full value.
      if (!(yield* flushIfAny)) return
      if (
        !(yield* publishDurable(SessionEvent.Text.Ended, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          textID: event.id,
          text: value,
        }))
      )
        return
      openText.delete(event.id)
      textChunks.delete(event.id)
      yield* buffer.close(event.id)
      return
    }
    if (LLMEvent.is.reasoningStart(event)) {
      if (
        !(yield* publishDurable(SessionEvent.Reasoning.Started, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          reasoningID: event.id,
        }))
      )
        return
      openReasoning.add(event.id)
      reasoningChunks.set(event.id, [])
      return
    }
    if (LLMEvent.is.reasoningDelta(event)) {
      if (!openReasoning.has(event.id)) return yield* Effect.die(`Reasoning delta before start: ${event.id}`)
      reasoningChunks.get(event.id)!.push(event.text)
      if (!(yield* bufferDelta("reasoning", event.id, event.text))) return
      yield* publishLive(SessionEvent.Reasoning.Delta, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        reasoningID: event.id,
        delta: event.text,
      })
      return
    }
    if (LLMEvent.is.reasoningEnd(event)) {
      if (!openReasoning.has(event.id)) return yield* Effect.die(`Reasoning end before start: ${event.id}`)
      const value = reasoningChunks.get(event.id)!.join("")
      if (!(yield* flushIfAny)) return
      if (
        !(yield* publishDurable(SessionEvent.Reasoning.Ended, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          reasoningID: event.id,
          text: value,
          providerMetadata: event.providerMetadata,
        }))
      )
        return
      openReasoning.delete(event.id)
      reasoningChunks.delete(event.id)
      yield* buffer.close(event.id)
      return
    }
    if (LLMEvent.is.toolInputStart(event)) {
      yield* startToolInput(event)
      return
    }
    if (LLMEvent.is.toolInputDelta(event)) {
      const tool = toolInputs.get(event.id)
      if (!tool) return yield* Effect.die(`Tool input delta before start: ${event.id}`)
      if (tool.name !== event.name)
        return yield* Effect.die(`Tool input name changed for ${event.id}: ${tool.name} -> ${event.name}`)
      if (tool.ended) return yield* Effect.die(`Tool input delta after end: ${event.id}`)
      toolInputChunks.get(event.id)!.push(event.text)
      if (!(yield* bufferDelta("tool-input", event.id, event.text))) return
      yield* publishLive(SessionEvent.Tool.Input.Delta, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        callID: event.id,
        delta: event.text,
      })
      return
    }
    if (LLMEvent.is.toolInputEnd(event)) {
      yield* endToolInput(event)
      return
    }
    if (LLMEvent.is.toolCall(event)) {
      if (!toolInputs.has(event.id) && !(yield* startToolInput(event))) return
      const tool = toolInputs.get(event.id)!
      if (!tool.ended && !(yield* endToolInput(event))) return
      if (tool.name !== event.name)
        return yield* Effect.die(`Tool call name changed for ${event.id}: ${tool.name} -> ${event.name}`)
      if (tool.called) return yield* Effect.die(`Duplicate tool call: ${event.id}`)
      tool.providerExecuted = event.providerExecuted === true
      tool.input = event.input
      tool.providerMetadata = event.providerMetadata
      if (!tool.providerExecuted) {
        tool.called = true
        yield* Ref.update(toolCallsRef, (current) => [...current, event])
        return
      }
      if (
        !(yield* publishDurable(SessionEvent.Tool.Called, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          callID: event.id,
          tool: event.name,
          input: record(event.input),
          provider: {
            executed: true,
            ...(event.providerMetadata === undefined ? {} : { metadata: event.providerMetadata }),
          },
        }))
      )
        return
      tool.called = true
      tool.started = true
      return
    }
    if (LLMEvent.is.toolResult(event)) {
      const tool = toolInputs.get(event.id)
      if (!tool?.called) return yield* Effect.die(`Tool result before call: ${event.id}`)
      if (tool.name !== event.name)
        return yield* Effect.die(`Tool result name changed for ${event.id}: ${tool.name} -> ${event.name}`)
      if (tool.settled) {
        if (event.result.type === "error") return
        return yield* Effect.die(`Duplicate tool result: ${event.id}`)
      }
      const provider = {
        executed: event.providerExecuted === true || tool.providerExecuted,
        ...(event.providerMetadata === undefined ? {} : { metadata: event.providerMetadata }),
      }
      if (event.result.type === "error") {
        if (
          !(yield* publishDurable(SessionEvent.Tool.Failed, {
            sessionID: input.sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: input.assistantMessageID,
            callID: event.id,
            error: { type: "unknown", message: message(event.result.value) },
            result: event.result,
            provider,
          }))
        )
          return
        tool.settled = true
        return
      }
      const output = event.output ?? ToolOutput.fromResultValue(event.result)
      if (!output) return yield* Effect.die(`Unsupported tool result for ${event.name}`)
      if (
        !(yield* publishDurable(SessionEvent.Tool.Success, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          callID: event.id,
          structured: record(output.structured),
          content: output.content,
          ...(provider.executed ? { result: event.result } : {}),
          provider,
        }))
      )
        return
      tool.settled = true
      return
    }
    if (LLMEvent.is.toolError(event)) {
      const tool = toolInputs.get(event.id)
      if (!tool?.called) return yield* Effect.die(`Tool error before call: ${event.id}`)
      if (tool.name !== event.name)
        return yield* Effect.die(`Tool error name changed for ${event.id}: ${tool.name} -> ${event.name}`)
      if (tool.settled) return yield* Effect.die(`Duplicate tool error: ${event.id}`)
      if (
        !(yield* publishDurable(SessionEvent.Tool.Failed, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          callID: event.id,
          error: { type: "unknown", message: event.message },
          provider: {
            executed: tool.providerExecuted,
            ...(event.providerMetadata === undefined ? {} : { metadata: event.providerMetadata }),
          },
        }))
      )
        return
      tool.settled = true
      return
    }
    if (LLMEvent.is.stepFinish(event)) {
      if (!(yield* Ref.get(state)).stepOpen) return yield* Effect.die("Provider step ended before it started")
      if (
        !(yield* publishDurable(SessionEvent.Step.Ended, {
          sessionID: input.sessionID,
          timestamp: yield* DateTime.now,
          assistantMessageID: input.assistantMessageID,
          finish: event.reason,
          cost: 0,
          tokens: tokens(event.usage),
        }))
      )
        return
      yield* Ref.update(state, (current) => ({ ...current, stepOpen: false }))
      return
    }
    if (LLMEvent.is.finish(event)) {
      // A terminal finish is exactly one durable boundary; duplicates are an
      // invariant violation.
      const current = yield* Ref.get(state)
      if (current.finished) return yield* Effect.die("Duplicate provider finish event")
      yield* Ref.update(state, (value) => ({ ...value, finished: true }))
      return
    }
    if (LLMEvent.is.providerError(event)) {
      yield* Ref.update(state, (value) => ({
        ...value,
        error: {
          name: "ProviderError",
          data: {
            message: event.message,
            ...(event.classification === undefined ? {} : { classification: event.classification }),
            ...(event.retryable === undefined ? {} : { retryable: event.retryable }),
          },
        },
      }))
      return
    }
    // Unknown provider capabilities fail loudly rather than being silently
    // discarded from the durable transcript.
    return yield* Effect.die(
      `Unsupported provider event in kernel turn: ${(event as { type?: string }).type ?? "unknown"}`,
    )
  })

  const closeOpenParts = Effect.fn("PublicationActor.closeOpenParts")(function* (outcome: TurnOutcome) {
    const timestamp = yield* DateTime.now
    const current = yield* Ref.get(state)
    const unsettledTools = Array.from(toolInputs.entries()).filter(([, tool]) => tool.called && !tool.settled)
    const items: EventV2.BatchItem[] = [
      ...(current.stepOpen
        ? [
            {
              definition: SessionEvent.Step.Failed,
              data: {
                sessionID: input.sessionID,
                timestamp,
                assistantMessageID: input.assistantMessageID,
                error: {
                  type: "unknown" as const,
                  message:
                    outcome === "cancelled"
                      ? "Provider turn interrupted"
                      : outcome === "recovery-required"
                        ? "Provider turn requires recovery"
                        : "Provider turn failed before step completion",
                },
              },
            },
          ]
        : []),
      ...Array.from(openText).map((textID) => ({
        definition: SessionEvent.Text.Ended,
        data: {
          sessionID: input.sessionID,
          timestamp,
          assistantMessageID: input.assistantMessageID,
          textID,
          text: textChunks.get(textID)?.join("") ?? "",
        },
      })),
      ...Array.from(openReasoning).map((reasoningID) => ({
        definition: SessionEvent.Reasoning.Ended,
        data: {
          sessionID: input.sessionID,
          timestamp,
          assistantMessageID: input.assistantMessageID,
          reasoningID,
          text: reasoningChunks.get(reasoningID)?.join("") ?? "",
        },
      })),
      ...Array.from(openToolInputs).map((callID) => ({
        definition: SessionEvent.Tool.Input.Ended,
        data: {
          sessionID: input.sessionID,
          timestamp,
          assistantMessageID: input.assistantMessageID,
          callID,
          text: toolInputChunks.get(callID)?.join("") ?? "",
        },
      })),
      ...unsettledTools.flatMap(([callID, tool]) => {
        const failure =
          tool.interruption === "abandoned" || outcome === "recovery-required"
            ? "Tool execution abandoned"
            : tool.interruption === "cancelled" || outcome === "cancelled"
              ? "Tool execution cancelled"
              : "Tool execution ended without a result"
        return [
          ...(tool.providerExecuted || tool.started
            ? []
            : [
                {
                  definition: SessionEvent.Tool.Called,
                  data: {
                    sessionID: input.sessionID,
                    timestamp,
                    assistantMessageID: input.assistantMessageID,
                    callID,
                    tool: tool.name,
                    input: record(tool.input),
                    provider: {
                      executed: false,
                      ...(tool.providerMetadata === undefined ? {} : { metadata: tool.providerMetadata }),
                    },
                  },
                },
              ]),
          {
            definition: SessionEvent.Tool.Failed,
            data: {
              sessionID: input.sessionID,
              timestamp,
              assistantMessageID: input.assistantMessageID,
              callID,
              error: { type: "unknown" as const, message: failure },
              result: { type: "error" as const, value: failure },
              provider: {
                executed: tool.providerExecuted,
                ...(tool.providerMetadata === undefined ? {} : { metadata: tool.providerMetadata }),
              },
            },
          },
        ]
      }),
    ]
    openText.clear()
    openReasoning.clear()
    openToolInputs.clear()
    textChunks.clear()
    reasoningChunks.clear()
    toolInputChunks.clear()
    return items
  })
  yield* Effect.gen(function* () {
    while (true) {
      const command = yield* Queue.take(queue)
      if (command.type === "provider-event") {
        if (!(yield* Ref.get(state)).interrupted) yield* publishLLMEvent(command.event)
        continue
      }
      if (command.type === "checkpoint") {
        const timer = yield* Ref.get(checkpointTimer)
        if (timer.armed && timer.generation === command.generation && !(yield* Ref.get(state)).interrupted)
          yield* flushIfAny
        continue
      }
      if (command.type === "barrier") {
        if (!(yield* Ref.get(state)).interrupted) yield* flushIfAny
        yield* Deferred.succeed(command.reply, undefined)
        continue
      }
      if (command.type === "interrupt") {
        yield* Ref.update(state, (current) => ({ ...current, interrupted: true }))
        continue
      }
      if (command.type === "close") {
        if (!(yield* Ref.get(state)).interrupted) yield* flushIfAny
        const items = yield* closeOpenParts(command.outcome)
        yield* Ref.update(state, (current) => ({ ...current, outcome: command.outcome }))
        yield* Deferred.succeed(closed, items)
        return
      }
      if (command.type === "tool-started") {
        yield* publishToolStarted(command.callID)
        continue
      }
      if (command.type === "tool-interrupted") {
        const tool = toolInputs.get(command.callID)
        if (!tool?.called) return yield* Effect.die(`Interrupt for unknown tool call: ${command.callID}`)
        tool.interruption = command.outcome
        continue
      }
      if (command.type === "tool-settlement") yield* publishSettlement(command.settlement)
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Deferred.succeed(failed, undefined).pipe(
        Effect.andThen(Effect.logError("PublicationActor processor failed", { sessionID: input.sessionID, cause })),
        Effect.andThen(Effect.failCause(cause)),
      ),
    ),
    Effect.forkScoped,
  )

  const offer = (command: PublicationCommand) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current.interrupted || current.closing || current.outcome !== undefined) return false
      return yield* Queue.offer(queue, command)
    })

  return {
    sessionID: input.sessionID,
    attemptID: input.attemptID,
    assistantMessageID: input.assistantMessageID,
    offer,
    barrier: Effect.gen(function* () {
      const current = yield* Ref.get(state)
      if (current.closing || current.outcome !== undefined)
        return yield* Effect.die("PublicationActor is already closing")
      const reply = yield* Deferred.make<void>()
      yield* Queue.offer(queue, { type: "barrier", reply })
      const processed = yield* Effect.raceFirst(
        Deferred.await(reply).pipe(Effect.as(true)),
        Deferred.await(failed).pipe(Effect.as(false)),
      )
      if (!processed) return yield* Effect.die("PublicationActor failed before processing barrier")
      // A barrier is a durable boundary: everything before it is published
      // durably, including the incremental checkpoint tail.
    }),
    interrupt: (reason) =>
      Effect.gen(function* () {
        // High-priority ingress: the flag is observable by the provider reader
        // immediately; the ordered command still records the reason.
        const current = yield* Ref.get(state)
        if (current.outcome !== undefined) return
        yield* Ref.update(state, (current) => ({ ...current, interrupted: true }))
        if (!current.closing) yield* Queue.offer(queue, { type: "interrupt", reason })
      }),
    close: (outcome) =>
      Effect.gen(function* () {
        const enqueue = yield* Ref.modify(state, (current) =>
          current.closing || current.outcome !== undefined
            ? ([false, current] as const)
            : ([true, { ...current, closing: true }] as const),
        )
        if (enqueue) yield* Queue.offer(queue, { type: "close", outcome })
        return yield* Effect.raceFirst(
          Deferred.await(closed),
          Deferred.await(failed).pipe(Effect.andThen(Effect.die("PublicationActor failed before processing close"))),
        )
      }),
    outcome: Ref.get(state).pipe(Effect.map((current) => current.outcome)),
    interrupted: Ref.get(state).pipe(Effect.map((current) => current.interrupted)),
    assistantStarted: Ref.get(state).pipe(Effect.map((current) => current.assistantStarted)),
    finished: Ref.get(state).pipe(Effect.map((current) => current.finished)),
    error: Ref.get(state).pipe(Effect.map((current) => current.error)),
    toolCalls: Ref.get(toolCallsRef),
    toolStarted: (callID) =>
      Effect.gen(function* () {
        if (!(yield* offer({ type: "tool-started", callID })))
          return yield* Effect.die("PublicationActor rejected tool start")
        const reply = yield* Deferred.make<void>()
        yield* Queue.offer(queue, { type: "barrier", reply })
        yield* Deferred.await(reply)
      }),
    toolInterrupted: (callID, outcome) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current.closing || current.outcome !== undefined)
          return yield* Effect.die("PublicationActor rejected tool interruption")
        if (!(yield* Queue.offer(queue, { type: "tool-interrupted", callID, outcome })))
          return yield* Effect.die("PublicationActor rejected tool interruption")
        const reply = yield* Deferred.make<void>()
        yield* Queue.offer(queue, { type: "barrier", reply })
        yield* Deferred.await(reply)
      }),
    publishSettlements: (settlements) =>
      Effect.forEach(
        settlements,
        (settlement) =>
          Effect.gen(function* () {
            if (!(yield* offer({ type: "tool-settlement", settlement })))
              return yield* Effect.die("PublicationActor rejected tool settlement")
          }),
        { discard: true },
      ),
  } satisfies Interface
})
