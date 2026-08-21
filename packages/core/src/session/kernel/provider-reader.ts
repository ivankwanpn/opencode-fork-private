export * as ProviderReader from "./provider-reader"

import { Cause, Context, Effect, Exit, Layer, Stream } from "effect"
import { LLMClient, LLMError, LLMEvent, type LLMRequest } from "@opencode-ai/llm"
import { makeGlobalNode } from "../../effect/app-node"
import { LayerNodePlatform } from "../../effect/app-node-platform"
import { SessionEvent } from "../event"
import type { PublicationActor } from "./publication-actor"

export type ProviderTurnResult =
  | { readonly kind: "completed" }
  | { readonly kind: "error"; readonly error: SessionEvent.ErrorInfo; readonly retryable: boolean }
  | { readonly kind: "interrupted" }

export interface Interface {
  readonly run: (input: {
    readonly actor: PublicationActor.Interface
    readonly request: LLMRequest
  }) => Effect.Effect<ProviderTurnResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ProviderReader") {}

const llmErrorInfo = (error: LLMError): SessionEvent.ErrorInfo => ({
  name: error.reason._tag,
  data: { message: error.reason.message },
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const client = yield* LLMClient.Service

    const run = Effect.fn("ProviderReader.run")(function* (input: {
      readonly actor: PublicationActor.Interface
      readonly request: LLMRequest
    }) {
      // The stream is interruptible; the exit interpretation and barrier must
      // run uninterruptibly so an interrupt signal is consumed exactly once.
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const exit = yield* restore(
            client.stream(input.request).pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  // Observe cancellation before and after forwarding; the
                  // actor's interrupt flag has high-priority ingress.
                  if (yield* input.actor.interrupted) return yield* Effect.interrupt
                  const accepted = yield* input.actor.offer({ type: "provider-event", event })
                  if (!accepted) return yield* Effect.die("PublicationActor mailbox overflow")
                  if (yield* input.actor.interrupted) return yield* Effect.interrupt
                }),
              ),
              Effect.exit,
            ),
          )
          if (Exit.isFailure(exit)) {
            if (Cause.hasInterrupts(exit.cause)) return { kind: "interrupted" } as const
            const failure = Cause.squash(exit.cause)
            if (failure instanceof LLMError)
              return { kind: "error", error: llmErrorInfo(failure), retryable: failure.retryable } as const
            return yield* Effect.die(failure)
          }
          // Wait until the actor processed every forwarded event (including
          // the terminal finish) before reading terminal state.
          yield* input.actor.barrier
          const finished = yield* input.actor.finished
          if (!finished) return yield* Effect.die("Provider stream ended without a terminal event")
          return { kind: "completed" } as const
        }),
      )
    })

    return Service.of({ run })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [LayerNodePlatform.llmClient],
})
