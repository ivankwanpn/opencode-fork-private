export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { optional } from "./schema"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export interface Synthetic extends Schema.Schema.Type<typeof Synthetic> {}
export const Synthetic = Schema.Struct({
  description: Schema.String,
}).annotate({ identifier: "SessionInput.Synthetic" })

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  synthetic: Synthetic.pipe(optional),
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })
