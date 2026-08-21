export * as PublicationActor from "./publication-actor"

import { DateTime, Deferred, Effect, Queue, Ref } from "effect"
import { LLMEvent, type Usage } from "@opencode-ai/llm"
import { EventV2 } from "../../event"
import { SessionEvent } from "../event"
import { SessionMessage } from "../message"
import { SessionSchema } from "../schema"
import type { Location } from "../../location"
import type { ModelV2 } from "../../model"
import type { InterruptReason, TurnOutcome } from "./types"

export type PublicationCommand =
  | { readonly type: "provider-event"; readonly event: LLMEvent }
  | { readonly type: "barrier"; readonly reply: Deferred.Deferred<void> }
  | { readonly type: "interrupt"; readonly reason: InterruptReason }
  | { readonly type: "close"; readonly outcome: TurnOutcome }

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
  readonly close: (outcome: TurnOutcome) => Effect.Effect<void>
  readonly outcome: Effect.Effect<TurnOutcome | undefined>
  readonly interrupted: Effect.Effect<boolean>
  readonly finished: Effect.Effect<boolean>
  readonly error: Effect.Effect<SessionEvent.ErrorInfo | undefined>
}

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

const tokens = (usage: Usage | undefined) => ({
  input: safe(usage?.nonCachedInputTokens),
  output: safe(usage?.visibleOutputTokens),
  reasoning: safe(usage?.reasoningTokens),
  cache: { read: safe(usage?.cacheReadInputTokens), write: safe(usage?.cacheWriteInputTokens) },
})

/** Creates the PublicationActor for one kernel turn; the processor runs in the caller's scope. */
export const make = Effect.fn("PublicationActor.make")(function* (events: EventV2.Interface, input: {
  readonly sessionID: SessionSchema.ID
  readonly attemptID: EventV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly agent: string
  readonly model: ModelV2.Ref
  readonly location?: Location.Ref
}) {
  const queue = yield* Queue.bounded<PublicationCommand>(256)
  interface ActorState {
    readonly interrupted: boolean
    readonly finished: boolean
    readonly outcome: TurnOutcome | undefined
    readonly error: SessionEvent.ErrorInfo | undefined
  }
  const state = yield* Ref.make<ActorState>({
    interrupted: false,
    finished: false,
    outcome: undefined,
    error: undefined,
  })
  const textChunks = new Map<string, string[]>()
  const reasoningChunks = new Map<string, string[]>()
  const openText = new Set<string>()
  const openReasoning = new Set<string>()

  const publish = <D extends EventV2.Definition>(definition: D, data: EventV2.Data<D>) =>
    events.publish(definition, data, input.location === undefined ? undefined : { location: input.location }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("PublicationActor publish failed", { sessionID: input.sessionID, cause }),
      ),
      Effect.asVoid,
    )

  const publishLLMEvent = Effect.fn("PublicationActor.publishLLMEvent")(function* (event: LLMEvent) {
    if (LLMEvent.is.stepStart(event)) {
      yield* publish(SessionEvent.Step.Started, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        agent: input.agent,
        model: input.model,
      })
      return
    }
    if (LLMEvent.is.textStart(event)) {
      openText.add(event.id)
      textChunks.set(event.id, [])
      yield* publish(SessionEvent.Text.Started, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        textID: event.id,
      })
      return
    }
    if (LLMEvent.is.textDelta(event)) {
      if (!openText.has(event.id)) return yield* Effect.die(`Text delta before start: ${event.id}`)
      textChunks.get(event.id)!.push(event.text)
      yield* publish(SessionEvent.Text.Delta, {
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
      openText.delete(event.id)
      const value = textChunks.get(event.id)!.join("")
      textChunks.delete(event.id)
      yield* publish(SessionEvent.Text.Ended, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        textID: event.id,
        text: value,
      })
      return
    }
    if (LLMEvent.is.reasoningStart(event)) {
      openReasoning.add(event.id)
      reasoningChunks.set(event.id, [])
      yield* publish(SessionEvent.Reasoning.Started, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        reasoningID: event.id,
      })
      return
    }
    if (LLMEvent.is.reasoningDelta(event)) {
      if (!openReasoning.has(event.id)) return yield* Effect.die(`Reasoning delta before start: ${event.id}`)
      reasoningChunks.get(event.id)!.push(event.text)
      yield* publish(SessionEvent.Reasoning.Delta, {
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
      openReasoning.delete(event.id)
      const value = reasoningChunks.get(event.id)!.join("")
      reasoningChunks.delete(event.id)
      yield* publish(SessionEvent.Reasoning.Ended, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        reasoningID: event.id,
        text: value,
        providerMetadata: event.providerMetadata,
      })
      return
    }
    if (LLMEvent.is.stepFinish(event)) {
      yield* publish(SessionEvent.Step.Ended, {
        sessionID: input.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: input.assistantMessageID,
        finish: event.reason,
        cost: 0,
        tokens: tokens(event.usage),
      })
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
        error: { name: "ProviderError", data: { message: event.message } },
      }))
      return
    }
    // Task 5 turns are text/reasoning only; anything else fails loudly rather
    // than silently dropping a provider capability.
    return yield* Effect.die(
      `Unsupported provider event in kernel turn: ${(event as { type?: string }).type ?? "unknown"}`,
    )
  })

  yield* Queue.take(queue).pipe(
    Effect.flatMap((command) =>
      Effect.gen(function* () {
        if (command.type === "provider-event") yield* publishLLMEvent(command.event)
        if (command.type === "barrier") yield* Deferred.succeed(command.reply, undefined)
        if (command.type === "interrupt")
          yield* Ref.update(state, (current) => ({ ...current, interrupted: true }))
        if (command.type === "close")
          yield* Ref.update(state, (current) => ({ ...current, outcome: command.outcome }))
      }),
    ),
    Effect.forever,
    Effect.forkScoped,
  )

  return {
    sessionID: input.sessionID,
    attemptID: input.attemptID,
    assistantMessageID: input.assistantMessageID,
    offer: (command) => Queue.offer(queue, command),
    barrier: Effect.gen(function* () {
      const reply = yield* Deferred.make<void>()
      yield* Queue.offer(queue, { type: "barrier", reply })
      yield* Deferred.await(reply)
    }),
    interrupt: (reason) =>
      Effect.gen(function* () {
        // High-priority ingress: the flag is observable by the provider reader
        // immediately; the ordered command still records the reason.
        yield* Ref.update(state, (current) => ({ ...current, interrupted: true }))
        yield* Queue.offer(queue, { type: "interrupt", reason })
      }),
    close: (outcome) => Queue.offer(queue, { type: "close", outcome }).pipe(Effect.asVoid),
    outcome: Ref.get(state).pipe(Effect.map((current) => current.outcome)),
    interrupted: Ref.get(state).pipe(Effect.map((current) => current.interrupted)),
    finished: Ref.get(state).pipe(Effect.map((current) => current.finished)),
    error: Ref.get(state).pipe(Effect.map((current) => current.error)),
  } satisfies Interface
})
