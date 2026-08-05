import { ConfigCapability } from "@opencode-ai/server/config-capability"
import { Effect, Layer } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { discover } from "@/provider/custom-provider/discovery"
import { make as makeCustomProvider } from "@/provider/custom-provider/service"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Config } from "./config"

export const layer = Layer.effect(
  ConfigCapability.Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
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
    })
  }),
)

export * as NativeConfig from "./native-config"
