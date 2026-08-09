import { ConfigCapability } from "@opencode-ai/server/config-capability"
import { Auth } from "@/auth"
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
    const auth = yield* Auth.Service
    const customProvider = yield* makeCustomProvider
    return ConfigCapability.Service.of({
      get: () => config.get().pipe(Effect.map((value) => value as ConfigCapability.Value)),
      update: (value) =>
        Effect.gen(function* () {
          const result = yield* config.updateGlobal(value as Config.Info)
          if (result.changed) {
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
        Effect.gen(function* () {
          const result = yield* customProvider.configure(input, location)
          const bridge = yield* EffectBridge.make()
          bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
          return result
        }),
      disconnectCustomProvider: (providerID, location) =>
        customProvider.disconnect(providerID, location).pipe(
          Effect.mapError(
            () =>
              new ServiceUnavailableError({
                message: "Failed to disconnect custom provider",
                service: "custom-provider",
              }),
          ),
          Effect.tap(() =>
            Effect.gen(function* () {
              const bridge = yield* EffectBridge.make()
              bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
            }),
          ),
        ),
      disconnectProvider: (providerID) =>
        auth.remove(providerID).pipe(
          Effect.mapError(
            () =>
              new ServiceUnavailableError({
                message: "Failed to disconnect provider credentials",
                service: "provider-credentials",
              }),
          ),
          Effect.tap(() =>
            Effect.gen(function* () {
              const bridge = yield* EffectBridge.make()
              bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
            }),
          ),
        ),
    })
  }),
)

export * as NativeConfig from "./native-config"
