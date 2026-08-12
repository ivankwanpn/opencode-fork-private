import { Schema } from "effect"
import { MessageID, PartID, SessionID } from "./schema"

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
})
export type RevertInput = typeof RevertInput.Type

export * as SessionRevert from "./revert"
