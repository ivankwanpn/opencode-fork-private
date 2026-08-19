import { ConfigCapability } from "@opencode-ai/server/config-capability"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Effect, Layer } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { discover } from "@/provider/custom-provider/discovery"
import { make as makeCustomProvider } from "@/provider/custom-provider/service"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Config } from "./config"

export const layer = Layer.effect(
  ConfigCapability.Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const credentials = yield* Credential.Service
    const locations = yield* LocationServiceMap.Service
    const customProvider = yield* makeCustomProvider
    return ConfigCapability.Service.of({
      get: () => config.get().pipe(Effect.map((value) => value as ConfigCapability.Value)),
      update: (value) =>
        Effect.gen(function* () {
          const result = yield* config.updateGlobal(value as Config.Info)
          if (result.changed) {
            if (locations.invalidateAll) yield* locations.invalidateAll()
            const bridge = yield* EffectBridge.make()
            const reason = Config.isAgentOnlyUpdate(value) ? "agent-config" : undefined
            bridge.fork(
              disposeAllInstancesAndEmitGlobalDisposed({
                swallowErrors: true,
                ...(reason ? { reason } : {}),
              }),
            )
          }
          return result.info as ConfigCapability.Value
        }),
      discoverCustomProvider: (input) => discover(input),
      configureCustomProvider: (input, location) =>
        customProvider.configure(input, location),
      disconnectCustomProvider: (providerID, location) =>
        customProvider.disconnect(providerID, location).pipe(
          Effect.mapError(
            () =>
              new ServiceUnavailableError({
                message: "Failed to disconnect custom provider",
                service: "custom-provider",
              }),
          ),
        ),
      disconnectProvider: (providerID) =>
        credentials.list(Integration.ID.make(providerID)).pipe(
          Effect.flatMap((saved) => Effect.forEach(saved, (credential) => credentials.remove(credential.id))),
          Effect.asVoid,
        ),
    })
  }),
)

export * as NativeConfig from "./native-config"
