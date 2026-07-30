import { SessionDiffCapability } from "@opencode-ai/server/session-diff"
import { Effect, Layer } from "effect"
import { SessionSummary } from "./summary"
import { MessageID, SessionID } from "./schema"

export const layer = Layer.effect(
  SessionDiffCapability.Service,
  Effect.gen(function* () {
    const summary = yield* SessionSummary.Service
    return SessionDiffCapability.Service.of({
      get: (input) =>
        summary.diff({
          sessionID: SessionID.make(input.sessionID),
          messageID: input.messageID === undefined ? undefined : MessageID.make(input.messageID),
        }),
    })
  }),
)

export * as NativeSessionDiff from "./native-session-diff"
