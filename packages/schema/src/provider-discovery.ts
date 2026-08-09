export * as ProviderDiscovery from "./provider-discovery"

import { Schema } from "effect"
import { Provider } from "./provider"
import { optional, PositiveInt } from "./schema"

export const Source = Schema.Literals(["oauth", "compatible", "provider"]).annotate({
  identifier: "ProviderDiscovery.Source",
})
export type Source = typeof Source.Type

export interface DiscoveredModel extends Schema.Schema.Type<typeof DiscoveredModel> {}
export const DiscoveredModel = Schema.Struct({
  id: Schema.String,
  name: optional(Schema.String),
  context: optional(PositiveInt),
  input: optional(PositiveInt),
  output: optional(PositiveInt),
}).annotate({ identifier: "ProviderDiscovery.DiscoveredModel" })

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  providerID: Provider.ID,
  source: Source,
  models: Schema.Array(DiscoveredModel),
}).annotate({ identifier: "ProviderDiscovery.Result" })
