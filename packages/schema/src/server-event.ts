export * as ServerEvent from "./server-event"

import { Schema } from "effect"
import { Event } from "./event"
import { optional } from "./schema"

export const Connected = Event.define({ type: "server.connected", schema: {} })
export const Disposed = Event.define({
  type: "global.disposed",
  schema: {
    reason: optional(Schema.Literal("agent-config")),
  },
})

export const Definitions = Event.inventory(Connected, Disposed)
