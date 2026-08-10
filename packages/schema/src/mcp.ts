export * as Mcp from "./mcp"

import { Schema } from "effect"
import { optional } from "./schema"

export const Resource = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  description: Schema.String.pipe(optional),
  mimeType: Schema.String.pipe(optional),
  client: Schema.String,
}).annotate({ identifier: "McpResource" })
export type Resource = typeof Resource.Type

export const Status = Schema.Union([
  Schema.Struct({ status: Schema.Literal("connected") }),
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
  Schema.Struct({ status: Schema.Literal("needs_auth") }),
  Schema.Struct({ status: Schema.Literal("needs_client_registration"), error: Schema.String }),
]).annotate({ identifier: "McpStatus", discriminator: "status" })
export type Status = typeof Status.Type
