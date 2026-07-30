import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Location } from "@opencode-ai/schema/location"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Context, Effect, Layer, Schema } from "effect"

export type Value = typeof Schema.Json.Type

export interface Interface {
  readonly get: () => Effect.Effect<Value>
  readonly update: (value: Value) => Effect.Effect<Value, ServiceUnavailableError>
  readonly discoverCustomProvider: (
    input: CustomProvider.DiscoverInput,
  ) => Effect.Effect<
    CustomProvider.DiscoverResult,
    CustomProvider.ValidationError | CustomProvider.DiscoveryError | ServiceUnavailableError
  >
  readonly configureCustomProvider: (
    input: CustomProvider.ConfigureInput,
    location: Location.Ref,
  ) => Effect.Effect<
    CustomProvider.ConfigureResult,
    | CustomProvider.ValidationError
    | CustomProvider.ConflictError
    | CustomProvider.ConfigureError
    | ServiceUnavailableError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/ConfigCapability") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({}),
    update: () => Effect.fail(configUpdateUnavailable()),
    discoverCustomProvider: () => Effect.fail(customProviderUnavailable()),
    configureCustomProvider: () => Effect.fail(customProviderUnavailable()),
  }),
)

function customProviderUnavailable() {
  return new ServiceUnavailableError({
    message: "Custom provider configuration is unavailable on this host",
    service: "custom-provider",
  })
}

function configUpdateUnavailable() {
  return new ServiceUnavailableError({
    message: "Configuration updates are unavailable on this host",
    service: "config",
  })
}

export * as ConfigCapability from "./config-capability"
