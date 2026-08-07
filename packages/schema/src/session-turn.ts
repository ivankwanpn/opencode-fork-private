export * as SessionTurn from "./session-turn"

import { Schema } from "effect"
import { SessionMessage } from "./session-message"

export const Status = Schema.Union([
  Schema.Struct({ type: Schema.Literal("pending"), turnID: SessionMessage.ID }),
  Schema.Struct({ type: Schema.Literal("active"), turnID: SessionMessage.ID }),
]).annotate({ identifier: "SessionTurn.Status" })
export type Status = typeof Status.Type
