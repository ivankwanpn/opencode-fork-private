export * as SessionRead from "./session-read"

import { SessionV2 } from "@opencode-ai/core/session"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly messages: SessionV2.Interface["messages"]
  readonly message: SessionV2.Interface["message"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ServerSessionRead") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    return Service.of({ messages: session.messages, message: session.message })
  }),
)
