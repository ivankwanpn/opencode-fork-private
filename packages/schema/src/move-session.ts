export * as MoveSession from "./move-session"

import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema"
import { SessionID } from "./session-id"

export const Destination = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "MoveSession.Destination" })
export type Destination = typeof Destination.Type

export const Input = Schema.Struct({
  sessionID: SessionID,
  destination: Destination,
  moveChanges: optional(Schema.Boolean),
}).annotate({ identifier: "MoveSession.Input" })
export type Input = typeof Input.Type
