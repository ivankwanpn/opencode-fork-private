export * as ProviderCatalog from "./provider-catalog"

import { Schema } from "effect"
import { Model } from "./model"
import { Provider } from "./provider"

export const Source = Schema.Literals(["env", "config", "custom", "api"]).annotate({
  identifier: "ProviderCatalog.Source",
})
export type Source = typeof Source.Type

export const Auth = Schema.Literals(["env", "key", "oauth"]).annotate({
  identifier: "ProviderCatalog.Auth",
})
export type Auth = typeof Auth.Type

export const Entry = Schema.Struct({
  info: Provider.Info,
  source: Source,
  auth: Auth.pipe(Schema.optional),
  env: Schema.Array(Schema.String),
}).annotate({ identifier: "ProviderCatalog.Entry" })
export type Entry = typeof Entry.Type

export const Info = Schema.Struct({
  providers: Schema.Array(Entry),
  models: Schema.Array(Model.Info),
  connected: Schema.Array(Provider.ID),
  default: Schema.Record(Provider.ID, Model.ID),
}).annotate({ identifier: "ProviderCatalog.Info" })
export type Info = typeof Info.Type
