import { SessionV2 } from "@opencode-ai/core/session"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly remove: (sessionID: SessionV2.ID) => Effect.Effect<void, SessionV2.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/SessionRemovalCapability") {}

export const layer = Layer.effect(
  Service,
  SessionV2.Service.pipe(Effect.map((session) => Service.of({ remove: session.remove }))),
)

export * as SessionRemovalCapability from "./session-removal"
