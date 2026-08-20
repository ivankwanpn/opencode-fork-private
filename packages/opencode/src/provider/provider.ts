import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { optional } from "@opencode-ai/core/schema"
import { Schema, Types } from "effect"
import { sortBy } from "remeda"
import { ModelStatus } from "./model-status"

const ProviderApiInfo = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  npm: Schema.String,
})

const ProviderModalities = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean,
})

const ProviderInterleaved = Schema.Union([
  Schema.Boolean,
  Schema.Struct({
    field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
  }),
])

const ProviderCapabilities = Schema.Struct({
  temperature: Schema.Boolean,
  reasoning: Schema.Boolean,
  attachment: Schema.Boolean,
  toolcall: Schema.Boolean,
  input: ProviderModalities,
  output: ProviderModalities,
  interleaved: ProviderInterleaved,
})

const ProviderCacheCost = Schema.Struct({
  read: Schema.Finite,
  write: Schema.Finite,
})

const ProviderCostTier = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Finite,
  }),
})

const ProviderCost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache: ProviderCacheCost,
  tiers: optional(Schema.Array(ProviderCostTier)),
  experimentalOver200K: optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache: ProviderCacheCost,
    }),
  ),
})

const ProviderLimit = Schema.Struct({
  context: Schema.Finite,
  input: optional(Schema.Finite),
  output: Schema.Finite,
})

export const Model = Schema.Struct({
  id: ModelV2.ID,
  providerID: ProviderV2.ID,
  api: ProviderApiInfo,
  name: Schema.String,
  family: optional(Schema.String),
  capabilities: ProviderCapabilities,
  cost: ProviderCost,
  limit: ProviderLimit,
  status: ModelStatus,
  options: Schema.Record(Schema.String, Schema.Any),
  headers: Schema.Record(Schema.String, Schema.String),
  release_date: Schema.String,
  variants: optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any))),
  protocols: optional(Schema.Array(ModelV2.Protocol)),
}).annotate({ identifier: "Model" })
export type Model = Types.DeepMutable<Schema.Schema.Type<typeof Model>>

export const Info = Schema.Struct({
  id: ProviderV2.ID,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  auth: optional(Schema.Literals(["env", "key", "oauth"])),
  env: Schema.Array(Schema.String),
  key: optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Any),
  models: Schema.Record(Schema.String, Model),
}).annotate({ identifier: "Provider" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

const DefaultModelIDs = Schema.Record(Schema.String, Schema.String)

export const ListResult = Schema.Struct({
  all: Schema.Array(Info),
  default: DefaultModelIDs,
  connected: Schema.Array(Schema.String),
})
export type ListResult = Types.DeepMutable<Schema.Schema.Type<typeof ListResult>>

export const ConfigProvidersResult = Schema.Struct({
  providers: Schema.Array(Info),
  default: DefaultModelIDs,
})
export type ConfigProvidersResult = Types.DeepMutable<Schema.Schema.Type<typeof ConfigProvidersResult>>

export function toPublicInfo(provider: Info): Info {
  return JSON.parse(
    JSON.stringify(
      {
        ...provider,
        models: Object.fromEntries(Object.entries(provider.models).filter(([, model]) => Schema.is(Model)(model))),
      },
      (_, value) => {
        if (typeof value === "function" || typeof value === "symbol" || value === undefined) return undefined
        if (typeof value === "bigint") return value.toString()
        return value
      },
    ),
  )
}

export class ModelNotFoundError extends Schema.TaggedErrorClass<ModelNotFoundError>()("ProviderModelNotFoundError", {
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
  suggestions: Schema.optional(Schema.Array(Schema.String)),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    const suggestions = this.suggestions?.length ? ` Did you mean: ${this.suggestions.join(", ")}?` : ""
    return `Model not found: ${this.providerID}/${this.modelID}.${suggestions}`
  }

  static isInstance(input: unknown): input is ModelNotFoundError {
    return input instanceof ModelNotFoundError
  }
}

export class InitError extends Schema.TaggedErrorClass<InitError>()("ProviderInitError", {
  providerID: ProviderV2.ID,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    return `Failed to initialize provider: ${this.providerID}`
  }

  static isInstance(input: unknown): input is InitError {
    return input instanceof InitError
  }
}

export class NoProvidersError extends Schema.TaggedErrorClass<NoProvidersError>()("ProviderNoProvidersError", {}) {
  override get message() {
    return "No providers are available"
  }

  static isInstance(input: unknown): input is NoProvidersError {
    return input instanceof NoProvidersError
  }
}

export class NoModelsError extends Schema.TaggedErrorClass<NoModelsError>()("ProviderNoModelsError", {
  providerID: ProviderV2.ID,
}) {
  override get message() {
    return `No models are available for provider: ${this.providerID}`
  }

  static isInstance(input: unknown): input is NoModelsError {
    return input instanceof NoModelsError
  }
}

export type DefaultModelError = ModelNotFoundError | NoProvidersError | NoModelsError
export type Error = ModelNotFoundError | InitError | NoProvidersError | NoModelsError

const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]

export function sort<T extends { id: string }>(models: T[]) {
  return sortBy(
    models,
    [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  )
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderV2.ID.make(providerID),
    modelID: ModelV2.ID.make(rest.join("/")),
  }
}

export * as Provider from "./provider"
