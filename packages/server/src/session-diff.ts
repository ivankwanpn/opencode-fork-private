import { SessionV2 } from "@opencode-ai/core/session"
import { FileDiff } from "@opencode-ai/schema/file-diff"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly get: (input: {
    readonly sessionID: SessionV2.ID
    readonly messageID?: string
  }) => Effect.Effect<readonly FileDiff.Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/SessionDiff") {}

export const layer = Layer.succeed(Service, Service.of({ get: () => Effect.succeed([]) }))

export * as SessionDiffCapability from "./session-diff"
