export * as Revert from "./revert"

import { Schema } from "effect"
import { optional } from "./schema"
import { NonNegativeInt } from "./schema"
import { SessionMessage } from "./session-message"
import { FileDiff } from "./file-diff"

export const State = Schema.Struct({
  messageID: SessionMessage.ID,
  partID: Schema.String.pipe(optional),
  contentIndex: NonNegativeInt.pipe(optional),
  removedMessageIDs: Schema.Array(SessionMessage.ID).pipe(optional),
  snapshot: Schema.String.pipe(optional),
  diff: Schema.String.pipe(optional),
  files: Schema.Array(FileDiff.Core).pipe(optional),
}).annotate({ identifier: "Revert.State" })
export interface State extends Schema.Schema.Type<typeof State> {}
