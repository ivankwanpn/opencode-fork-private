import { SessionShareCapability } from "@opencode-ai/server/session-share"
import { Effect, Layer } from "effect"
import { SessionShare } from "./session"
import { SessionID } from "@/session/schema"

export const layer = Layer.effect(
  SessionShareCapability.Service,
  Effect.gen(function* () {
    const share = yield* SessionShare.Service
    return SessionShareCapability.Service.of({
      share: (sessionID) => share.share(SessionID.make(sessionID)),
      unshare: (sessionID) => share.unshare(SessionID.make(sessionID)),
    })
  }),
)

export * as NativeSessionShare from "./native-session-share"
