import { legacyAllProvidersFromNative } from "@/compat/native-v1-catalog"
import { ProviderAuthCompat } from "@/compat/provider-auth"
import { InstanceState } from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { Provider } from "@/compat/provider-wire"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"

import { Cause, Effect, Schedule, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ProviderAuthApiError } from "../groups/provider"

function error(name: ConstructorParameters<typeof ProviderAuthApiError>[0]["name"], data: ProviderAuthApiError["data"]) {
  return new ProviderAuthApiError({ name, data })
}

function authorizationError(value: Integration.AuthorizationError) {
  const cause = Cause.isCause(value.cause) ? Cause.squash(value.cause) : value.cause
  if (cause instanceof Integration.InputValidationError) {
    return error("ProviderAuthValidationFailed", { field: cause.field, message: cause.message })
  }
  return error("BadRequest", {})
}

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider", (handlers) =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const locations = yield* LocationServiceMap.Service

    const ready = plugins.init()

    const location = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      return yield* effect.pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({
              directory: AbsolutePath.make(ctx.directory),
              ...(workspaceID === undefined ? {} : { workspaceID }),
            }),
          ),
        ),
      )
    })

    const list = Effect.fn("ProviderHttpApi.list")(function* () {
      yield* ready
      const catalog = yield* location(CatalogSnapshot.Service.use((snapshot) => snapshot.get()))
      const providers = legacyAllProvidersFromNative(catalog)
      return Schema.decodeUnknownSync(Provider.ListResult)({
        all: providers.providers.map((provider) => Provider.toPublicInfo(provider as unknown as Provider.Info)),
        default: providers.defaults,
        connected: [...catalog.connected],
      })
    })

    const auth = Effect.fn("ProviderHttpApi.auth")(function* () {
      yield* ready
      return yield* location(
        Integration.Service.use((integrations) => integrations.list()).pipe(Effect.map(ProviderAuthCompat.project)),
      )
    })

    const authorize = Effect.fn("ProviderHttpApi.authorize")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuthCompat.AuthorizeInput
    }) {
      yield* ready
      return yield* location(
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const integrationID = Integration.ID.make(ctx.params.providerID)
          const method = ProviderAuthCompat.method(yield* integrations.get(integrationID), ctx.payload.method)
          if (!method) return yield* error("BadRequest", {})
          if (method.type === "key") return undefined
          const attempt = yield* integrations.connection
            .oauth({
              integrationID,
              methodID: method.id,
              inputs: ctx.payload.inputs ?? {},
            })
            .pipe(Effect.mapError(authorizationError))
          return new ProviderAuthCompat.Authorization({
            url: attempt.url,
            method: attempt.mode,
            instructions: attempt.instructions,
          })
        }),
      )
    })

    const authorizeRaw = Effect.fn("ProviderHttpApi.authorizeRaw")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      const payload = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProviderAuthCompat.AuthorizeInput))(
        body,
      ).pipe(Effect.mapError(() => error("BadRequest", {})))
      const result = yield* authorize({ params: ctx.params, payload })
      return HttpServerResponse.jsonUnsafe(result ?? null)
    })

    const callback = Effect.fn("ProviderHttpApi.callback")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: ProviderAuthCompat.CallbackInput
    }) {
      yield* ready
      yield* location(
        Effect.gen(function* () {
          const integrations = yield* Integration.Service
          const integrationID = Integration.ID.make(ctx.params.providerID)
          const attemptID = yield* integrations.attempt.latest(integrationID)
          if (!attemptID) {
            return yield* error("ProviderAuthOauthMissing", { providerID: ctx.params.providerID })
          }
          yield* integrations.attempt
            .complete({ attemptID, code: ctx.payload.code })
            .pipe(
              Effect.mapError((cause) => {
                if (cause instanceof Integration.CodeRequiredError) {
                  return error("ProviderAuthOauthCodeMissing", { providerID: ctx.params.providerID })
                }
                return error("ProviderAuthOauthCallbackFailed", {})
              }),
            )
          const status = yield* integrations.attempt.status(attemptID).pipe(
            Effect.repeat({
              schedule: Schedule.spaced("100 millis"),
              while: (value) => value.status === "pending",
            }),
          )
          if (status.status === "complete") return
          return yield* error("ProviderAuthOauthCallbackFailed", {})
        }),
      )
      return true
    })

    return handlers
      .handle("list", list)
      .handle("auth", auth)
      .handleRaw("authorize", authorizeRaw)
      .handle("callback", callback)
  }),
)
