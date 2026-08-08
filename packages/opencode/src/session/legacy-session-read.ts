import { SessionV2 } from "@opencode-ai/core/session"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer, Context } from "effect"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionID } from "./schema"

const make = Effect.gen(function* () {
  const legacy = yield* Session.Service
  const canonical = yield* SessionV2.Service

  const get = Effect.fn("LegacySessionRead.get")(function* (sessionID: SessionID) {
    return yield* canonical.get(SessionV2.ID.make(sessionID))
  })

  const history = Effect.fn("LegacySessionRead.history")(function* (sessionID: SessionID) {
    const current = yield* get(sessionID)
    const messages = yield* canonical
      .messages({ sessionID: current.id, order: "asc" })
      .pipe(Effect.catchTag("Session.MessageDecodeError", Effect.die))
    const retained = yield* legacy.messages({ sessionID })
    const merged = new Map<SessionV1.MessageID, SessionV1.WithParts>(
      retained.map((message) => [message.info.id, message]),
    )
    MessageV2.toLegacy(current, messages).forEach((message) => merged.set(message.info.id, message))
    return Array.from(merged.values()).toSorted(
      (left, right) => left.info.time.created - right.info.time.created || left.info.id.localeCompare(right.info.id),
    )
  })

  return { get, history }
})

export type Interface = Effect.Success<typeof make>

export class Service extends Context.Service<Service, Interface>()("@opencode/LegacySessionRead") {}

export const layer = Layer.effect(Service, make)

export * as LegacySessionRead from "./legacy-session-read"
