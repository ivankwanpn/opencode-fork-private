export * as ToolProgress from "./progress"

import { LLM } from "@opencode-ai/schema/llm"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { Context, DateTime, Effect, Layer } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Tool } from "./tool"

export interface Update {
  readonly structured: Readonly<Record<string, unknown>>
  readonly content: ReadonlyArray<LLM.ToolContent>
}

export interface Interface {
  readonly publish: (context: Tool.Context, update: Update) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolProgress") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const publish: Interface["publish"] = Effect.fn("ToolProgress.publish")(function* (context, update) {
      yield* events.publish(SessionEvent.Tool.Progress, {
        sessionID: context.sessionID,
        timestamp: yield* DateTime.now,
        assistantMessageID: context.assistantMessageID,
        callID: context.toolCallID,
        structured: { ...update.structured },
        content: update.content.map((part) => ({ ...part })),
      })
    })
    return Service.of({ publish })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [EventV2.node] })
