import { SessionV2 } from "@opencode-ai/core/session"
import { Effect, Layer, Context } from "effect"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"

const make = Effect.gen(function* () {
  const canonical = yield* SessionV2.Service

  const get = Effect.fn("LegacySessionRead.get")(function* (sessionID: SessionID) {
    return yield* canonical.get(SessionV2.ID.make(sessionID))
  })

  const history = Effect.fn("LegacySessionRead.history")(function* (sessionID: SessionID) {
    const current = yield* get(sessionID)
    const messages = yield* canonical
      .messages({ sessionID: current.id, order: "asc" })
      .pipe(Effect.catchTag("Session.MessageDecodeError", Effect.die))
    return MessageV2.toLegacy(current, messages)
  })

  return { get, history }
})

export type Interface = Effect.Success<typeof make>

export class Service extends Context.Service<Service, Interface>()("@opencode/LegacySessionRead") {}

export const layer = Layer.effect(Service, make)

export * as LegacySessionRead from "./legacy-session-read"
