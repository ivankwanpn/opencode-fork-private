export * as Command from "./command"

import { Schema } from "effect"
import { define, inventory } from "./event"
import { optional } from "./schema"
import { Model } from "./model"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  template: Schema.String,
  description: Schema.String.pipe(optional),
  agent: Schema.String.pipe(optional),
  model: Model.Ref.pipe(optional),
  subtask: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "CommandV2.Info" })

const Executed = define({
  type: "command.executed",
  schema: {
    name: Schema.String,
    sessionID: SessionID,
    arguments: Schema.String,
    messageID: SessionMessage.ID,
  },
})
export const Event = { Executed, Definitions: inventory(Executed) }
