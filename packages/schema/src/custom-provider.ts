export * as CustomProvider from "./custom-provider"

import { Schema } from "effect"
import { optional, PositiveInt } from "./schema"

export const Protocol = Schema.Literals(["openai-responses", "openai-compatible", "anthropic-messages"]).annotate({
  identifier: "CustomProvider.Protocol",
})
export type Protocol = typeof Protocol.Type

export const allReasoningEfforts = ["none", "low", "medium", "high", "xhigh", "max"] as const
export const reasoningEfforts = {
  "openai-responses": allReasoningEfforts,
  "openai-compatible": ["none", "low", "medium", "high"],
  "anthropic-messages": ["none", "low", "medium", "high", "max"],
} as const satisfies Record<Protocol, readonly (typeof allReasoningEfforts)[number][]>

export interface Header extends Schema.Schema.Type<typeof Header> {}
export const Header = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
}).annotate({ identifier: "CustomProvider.Header" })

export interface Model extends Schema.Schema.Type<typeof Model> {}
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  reasoning: optional(Schema.Boolean),
  context: optional(PositiveInt),
  output: optional(PositiveInt),
}).annotate({ identifier: "CustomProvider.Model" })

export interface DiscoveredModel extends Schema.Schema.Type<typeof DiscoveredModel> {}
export const DiscoveredModel = Schema.Struct({
  id: Schema.String,
  name: optional(Schema.String),
  reasoning: optional(Schema.Boolean),
  context: optional(PositiveInt),
  output: optional(PositiveInt),
}).annotate({ identifier: "CustomProvider.DiscoveredModel" })

export interface DiscoverInput extends Schema.Schema.Type<typeof DiscoverInput> {}
export const DiscoverInput = Schema.Struct({
  protocol: optional(Protocol),
  baseURL: Schema.String,
  apiKey: optional(Schema.String),
  headers: Schema.Array(Header),
}).annotate({ identifier: "CustomProvider.DiscoverInput" })

export interface DiscoverResult extends Schema.Schema.Type<typeof DiscoverResult> {}
export const DiscoverResult = Schema.Struct({
  endpoint: Schema.String,
  models: Schema.Array(DiscoveredModel),
}).annotate({ identifier: "CustomProvider.DiscoverResult" })

export interface ConfigureInput extends Schema.Schema.Type<typeof ConfigureInput> {}
export const ConfigureInput = Schema.Struct({
  providerID: Schema.String,
  name: Schema.String,
  protocol: optional(Protocol),
  update: optional(Schema.Boolean),
  baseURL: Schema.String,
  apiKey: optional(Schema.String),
  headers: Schema.Array(Header),
  models: Schema.Array(Model),
}).annotate({ identifier: "CustomProvider.ConfigureInput" })

export interface ConfigureResult extends Schema.Schema.Type<typeof ConfigureResult> {}
export const ConfigureResult = Schema.Struct({
  providerID: Schema.String,
  name: Schema.String,
  protocol: Protocol,
  models: Schema.Array(Schema.String),
}).annotate({ identifier: "CustomProvider.ConfigureResult" })

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "CustomProviderValidationError",
  { message: Schema.String, field: Schema.String },
  { httpApiStatus: 400 },
) {}

export class ConflictError extends Schema.TaggedErrorClass<ConflictError>()(
  "CustomProviderConflictError",
  { message: Schema.String, providerID: Schema.String },
  { httpApiStatus: 409 },
) {}

export class DiscoveryError extends Schema.TaggedErrorClass<DiscoveryError>()(
  "CustomProviderDiscoveryError",
  {
    message: Schema.String,
    endpoint: optional(Schema.String),
    status: optional(Schema.Int),
    kind: Schema.Literals(["network", "timeout", "redirect", "status", "shape", "environment"]),
  },
  { httpApiStatus: 502 },
) {}

export class ConfigureError extends Schema.TaggedErrorClass<ConfigureError>()(
  "CustomProviderConfigureError",
  {
    message: Schema.String,
    stage: Schema.Literals(["config", "legacyCredential", "nativeCredential", "catalogRefresh", "rollback"]),
    recoveryWarning: optional(Schema.String),
  },
  { httpApiStatus: 500 },
) {}
