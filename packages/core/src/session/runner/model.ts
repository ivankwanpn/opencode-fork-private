export * as SessionRunnerModel from "./model"

import { makeLocationNode } from "../../effect/app-node"
import { type Model, mergeGenerationOptions } from "@opencode-ai/llm"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/llm/route"
import { Context, Effect, Layer, Schema } from "effect"
import { produce } from "immer"
import { Catalog } from "../../catalog"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"
import { SessionRunnerRequestPolicy } from "./request-policy"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"

export class ModelNotSelectedError extends Schema.TaggedErrorClass<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  {
    sessionID: SessionSchema.ID,
  },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedErrorClass<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
  },
) {
  override get message() {
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}

export class VariantUnavailableError extends Schema.TaggedErrorClass<VariantUnavailableError>()(
  "SessionRunnerModel.VariantUnavailableError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    variant: ModelV2.VariantID,
  },
) {
  override get message() {
    return `Variant unavailable for ${this.providerID}/${this.modelID}: ${this.variant}`
  }
}

export class UnsupportedApiError extends Schema.TaggedErrorClass<UnsupportedApiError>()(
  "SessionRunnerModel.UnsupportedApiError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    api: Schema.String,
  },
) {
  override get message() {
    return `Unsupported API for ${this.providerID}/${this.modelID}: ${this.api}`
  }
}

export type Error =
  | ModelNotSelectedError
  | ModelUnavailableError
  | VariantUnavailableError
  | UnsupportedApiError
  | Integration.AuthorizationError

export interface Resolved {
  readonly llm: Model
  readonly model: ModelV2.Info
  readonly provider: ProviderV2.Info
  readonly source: "env" | "config" | "custom" | "api"
}

export interface Interface {
  readonly resolve: (session: SessionSchema.Info, model?: ModelV2.Ref) => Effect.Effect<Model, Error>
  readonly resolveWithInfo?: (session: SessionSchema.Info, model?: ModelV2.Ref) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunnerModel") {}

/** Test or embedding seam for supplying a model resolver directly. */
export const layerWith = (resolve: Interface["resolve"]) => Layer.succeed(Service, Service.of({ resolve }))

const apiKey = (model: ModelV2.Info, credential?: Credential.Value) => {
  if (credential?.type === "key") return Auth.value(credential.key)
  if (credential?.type === "oauth") return Auth.value(credential.access)
  const value = model.request.body.apiKey ?? model.api.settings?.apiKey
  if (typeof value === "string") return Auth.value(value)
}

const endpointBaseURL = (model: ModelV2.Info) => {
  if (model.api.url === undefined || model.protocols === undefined) return model.api.url
  const url = new URL(model.api.url)
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.some((segment) => /^v\d+(?:beta\d*)?$/i.test(segment))) return model.api.url.replace(/\/+$/, "")
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1`
  return url.toString().replace(/\/+$/, "")
}

const withDefaults = (model: ModelV2.Info, route: AnyRoute) => {
  const body = model.request.body
  const httpBody = Object.hasOwn(body, "apiKey")
    ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "apiKey"))
    : body
  const optionKey = SessionRunnerRequestPolicy.optionKey({ route })
  const policy = SessionRunnerRequestPolicy.apply(httpBody, optionKey)
  return route.with({
    provider: model.providerID,
    endpoint: model.api.url === undefined ? undefined : { baseURL: endpointBaseURL(model) },
    headers: model.request.headers,
    generation: mergeGenerationOptions(route.defaults.generation, policy.generation),
    providerOptions: Object.keys(policy.options).length === 0 ? undefined : { [optionKey]: policy.options },
    http: { body: policy.body },
    limits: { context: model.limit.context, output: model.limit.output },
  })
}

const withVariant = (
  model: ModelV2.Info,
  variantID: ModelV2.VariantID | undefined,
): Effect.Effect<ModelV2.Info, VariantUnavailableError> => {
  const id = variantID === "default" || variantID === undefined ? model.request.variant : variantID
  const variant = model.variants.find((item) => item.id === id)
  if (!variant && variantID !== undefined && variantID !== "default")
    return Effect.fail(
      new VariantUnavailableError({
        providerID: model.providerID,
        modelID: model.id,
        variant: variantID,
      }),
    )
  return Effect.succeed(
    variant
      ? produce(model, (draft) => {
          Object.assign(draft.request.headers, variant.headers)
          Object.assign(draft.request.body, variant.body)
        })
      : model,
  )
}

const packageByProtocol: Readonly<Record<ModelV2.Protocol, string>> = {
  "openai-responses": "@ai-sdk/openai",
  "openai-compatible": "@ai-sdk/openai-compatible",
  "anthropic-messages": "@ai-sdk/anthropic",
}

const protocolByPackage: Readonly<Partial<Record<string, ModelV2.Protocol>>> = {
  "@ai-sdk/openai": "openai-responses",
  "@ai-sdk/openai-compatible": "openai-compatible",
  "@ai-sdk/anthropic": "anthropic-messages",
}

const protocolsForModel = (model: ModelV2.Info): readonly ModelV2.Protocol[] => {
  if (model.protocols !== undefined) return model.protocols
  if (model.api.type !== "aisdk") return []
  const protocol = protocolByPackage[model.api.package]
  return protocol ? [protocol] : []
}

const withProtocol = (
  model: ModelV2.Info,
  protocol: ModelV2.Protocol | undefined,
): Effect.Effect<ModelV2.Info, UnsupportedApiError> => {
  if (protocol === undefined) return Effect.succeed(model)
  if (!protocolsForModel(model).includes(protocol)) {
    return Effect.fail(
      new UnsupportedApiError({
        providerID: model.providerID,
        modelID: model.id,
        api: protocol,
      }),
    )
  }
  return Effect.succeed(
    produce(model, (draft) => {
      draft.api = {
        type: "aisdk",
        id: model.api.id,
        package: packageByProtocol[protocol],
        url: model.api.url,
        settings: model.api.settings ?? {},
      }
    }),
  )
}

const withProtocolVariant = (
  model: ModelV2.Info,
  protocol: ModelV2.Protocol | undefined,
  variant: ModelV2.VariantID | undefined,
) => {
  if (protocol === undefined || variant === undefined || variant === "default" || !model.capabilities.reasoning) {
    return model
  }
  if (!CustomProvider.reasoningEfforts[protocol].some((effort) => effort === variant)) return model
  return produce(model, (draft) => {
    if (protocol === "openai-responses") {
      draft.request.body.reasoningEffort = variant
      draft.request.body.reasoningSummary = "auto"
      draft.request.body.include = ["reasoning.encrypted_content"]
      return
    }
    if (protocol === "openai-compatible") {
      draft.request.body.reasoningEffort = variant
      return
    }
    if (variant === "none") {
      draft.request.body.thinking = { type: "disabled" }
      return
    }
    const desired = variant === "low" ? 1_024 : variant === "medium" ? 4_096 : variant === "high" ? 16_000 : 32_000
    const budget = model.limit.output > 1 ? Math.min(desired, model.limit.output - 1) : desired
    draft.request.body.thinking = { type: "enabled", budgetTokens: budget }
  })
}

const apiName = (model: ModelV2.Info) =>
  model.api.type === "aisdk" ? `${model.api.type}:${model.api.package}` : model.api.type

export const fromCatalogModel = (
  model: ModelV2.Info,
  credential?: Credential.Value,
): Effect.Effect<Model, UnsupportedApiError> => {
  const resolved =
    credential?.type !== "key" || credential.metadata === undefined
      ? model
      : produce(model, (draft) => {
          Object.assign(draft.request.body, credential.metadata)
        })
  const key = apiKey(resolved, credential)
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/openai") {
    const oauth = resolved.providerID === "openai" && credential?.type === "oauth"
    const accountID = credential?.type === "oauth" ? credential.metadata?.accountID : undefined
    return Effect.succeed(
      withDefaults(resolved, OpenAIResponses.route)
        .with({
          auth: key === undefined ? Auth.none : Auth.bearer(key),
          endpoint: oauth ? { baseURL: "https://chatgpt.com/backend-api/codex" } : undefined,
          headers: oauth && typeof accountID === "string" ? { "ChatGPT-Account-Id": accountID } : undefined,
        })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/anthropic") {
    return Effect.succeed(
      withDefaults(resolved, AnthropicMessages.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/openai-compatible" && resolved.api.url) {
    return Effect.succeed(
      withDefaults(resolved, OpenAICompatibleChat.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.api.id }),
    )
  }
  return Effect.fail(
    new UnsupportedApiError({
      providerID: resolved.providerID,
      modelID: resolved.id,
      api: apiName(resolved),
    }),
  )
}

export const resolve = (
  session: SessionSchema.Info,
  model: ModelV2.Info,
  credential?: Credential.Value,
  selected: ModelV2.Ref | undefined = session.model,
) =>
  withProtocol(model, selected?.protocol).pipe(
    Effect.flatMap((model) =>
      withVariant(
        model,
        selected?.protocol &&
          selected.variant !== undefined &&
          CustomProvider.reasoningEfforts[selected.protocol].some((effort) => effort === selected.variant)
          ? undefined
          : selected?.variant,
      ),
    ),
    Effect.map((model) => withProtocolVariant(model, selected?.protocol, selected?.variant)),
    Effect.flatMap((model) => fromCatalogModel(model, credential)),
  )

export const supported = (model: ModelV2.Info) =>
  model.api.type === "aisdk" &&
  (model.api.package === "@ai-sdk/openai" ||
    model.api.package === "@ai-sdk/anthropic" ||
    (model.api.package === "@ai-sdk/openai-compatible" && model.api.url !== undefined))

/** Resolves models from the catalog belonging to the current Location runtime. */
export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integrations = yield* Integration.Service

    const resolveWithInfo = Effect.fn("SessionRunnerModel.resolveWithInfo")(function* (
      session: SessionSchema.Info,
      requested?: ModelV2.Ref,
    ) {
      const target = requested ?? session.model
      const defaultModel = target ? undefined : yield* catalog.model.default()
      const selected = target
        ? (yield* catalog.model.available()).find(
            (model) => model.providerID === target.providerID && model.id === target.id,
          )
        : defaultModel && supported(defaultModel)
          ? defaultModel
          : (yield* catalog.model.available()).find(supported)
      if (!selected && target)
        return yield* new ModelUnavailableError({
          providerID: target.providerID,
          modelID: target.id,
        })
      if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
      const provider = yield* catalog.provider.get(selected.providerID)
      if (!provider) return yield* Effect.die(`Provider unavailable: ${selected.providerID}`)
      const connection = yield* integrations.connection.active(
        provider.integrationID ?? Integration.ID.make(selected.providerID),
      )
      const llm = yield* resolve(
        session,
        selected,
        connection ? yield* integrations.connection.resolve(connection) : undefined,
        target,
      )
      const source: Resolved["source"] = connection
        ? connection.type === "env"
          ? "env"
          : "api"
        : ProviderV2.hasConfiguredCredentials(provider)
          ? "config"
          : "custom"
      return { llm, model: selected, provider, source }
    })

    return Service.of({
      resolveWithInfo,
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, model) {
        return (yield* resolveWithInfo(session, model)).llm
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer: locationLayer, deps: [Catalog.node, Integration.node] })
