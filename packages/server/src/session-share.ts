import { SessionV2 } from "@opencode-ai/core/session"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly share: (sessionID: SessionV2.ID) => Effect.Effect<{ readonly url: string }, unknown>
  readonly unshare: (sessionID: SessionV2.ID) => Effect.Effect<void, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/SessionShare") {}

const unavailable = () => Effect.fail(new Error("Session sharing is unavailable in this server host"))

export const layer = Layer.succeed(Service, Service.of({ share: unavailable, unshare: unavailable }))

export * as SessionShareCapability from "./session-share"
