export * as Console from "./console"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"

export const State = Schema.Struct({
  consoleManagedProviders: Schema.Array(Schema.String),
  activeOrgName: optional(Schema.String),
  switchableOrgCount: NonNegativeInt,
}).annotate({ identifier: "ConsoleState" })
export type State = typeof State.Type

export const Org = Schema.Struct({
  accountID: Schema.String,
  accountEmail: Schema.String,
  accountUrl: Schema.String,
  orgID: Schema.String,
  orgName: Schema.String,
  active: Schema.Boolean,
}).annotate({ identifier: "ConsoleOrg" })
export type Org = typeof Org.Type
