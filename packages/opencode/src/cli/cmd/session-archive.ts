export * as SessionArchive from "./session-archive"

import { Location } from "@opencode-ai/core/location"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Effect, Schema } from "effect"

export const Envelope = Schema.Struct({
  version: Schema.Literal(2),
  session: SessionSchema.Info,
  messages: Schema.Array(SessionMessage.Message),
}).annotate({ identifier: "SessionArchive.V2" })
export type Envelope = typeof Envelope.Type

export const encode = Schema.encodeSync(Envelope)
export const decode = Schema.decodeUnknownEffect(Envelope)

export const read = Effect.fn("SessionArchive.read")(function* (sessionID: SessionSchema.ID) {
  const sessions = yield* SessionV2.Service
  return Envelope.make({
    version: 2,
    session: yield* sessions.get(sessionID),
    messages: yield* sessions.messages({ sessionID, order: "asc" }),
  })
})

export const write = Effect.fn("SessionArchive.write")(function* (archive: Envelope, location: Location.Ref) {
  const sessions = yield* SessionV2.Service
  const session = yield* sessions.restore({ session: archive.session, location })
  yield* Effect.forEach(
    archive.messages,
    (message) => sessions.transcript.importMessage({ sessionID: session.id, message }),
    { discard: true },
  )
  return session
})
