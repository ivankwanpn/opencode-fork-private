import { describe, expect, test } from "bun:test"
import {
  configureWith,
  disconnectWith,
  type ConfigurePorts,
  type GlobalProviderState,
} from "@/provider/custom-provider/service"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Cause, Effect, Exit } from "effect"
const it = {
  effect: <A, E>(name: string, run: () => Effect.Effect<A, E>) => test(name, () => Effect.runPromise(run())),
}

const input = {
  providerID: "custom",
  name: "Custom",
  protocol: "openai-compatible",
  baseURL: "https://custom.example/v1",
  apiKey: "new-secret",
  headers: [{ name: "x-tenant", value: "acme" }],
  models: [{ id: "model-a", name: "Model A" }],
} satisfies CustomProvider.ConfigureInput

const originalProvider = ConfigProviderV1.Info.make({
  npm: "@ai-sdk/openai-compatible",
  name: "Original",
  env: ["OLD_ENV"],
  options: { baseURL: "https://old.example/v1" },
  models: { old: { name: "Old" } },
})
const originalNative = new Credential.Info({
  id: Credential.ID.create(),
  integrationID: Integration.ID.make("custom"),
  label: "original label",
  value: { type: "key", key: "old-native-secret" },
})

type Failure = "config" | "nativeCredential" | "catalogRefresh" | "rollbackNativeCredential"

function harness(options: {
  provider?: ConfigProviderV1.Info
  disabledProviders?: string[]
  resolvedProvider?: ConfigProviderV1.Info
  builtIn?: string[]
  native?: Credential.Info
  failure?: Failure
}) {
  const state: {
    global: GlobalProviderState
    native?: Credential.Info
    refreshes: (readonly string[] | undefined)[]
    order: string[]
  } = {
    global: {
      provider: options.provider,
      disabledProviders: options.disabledProviders,
    },
    native: options.native,
    refreshes: [],
    order: [],
  }
  const initial = structuredClone(state)
  let globalWrites = 0
  let nativeWrites = 0
  let refreshes = 0
  const fail = (failure: Failure, effect: Effect.Effect<void>) =>
    options.failure === failure
      ? effect.pipe(Effect.andThen(Effect.die(new Error(`sensitive:${failure}:new-secret`))))
      : effect

  const ports: ConfigurePorts = {
    resolvedConfig: () =>
      Effect.succeed({
        provider: options.resolvedProvider ? { custom: options.resolvedProvider } : undefined,
        disabled_providers: options.disabledProviders,
      } as ConfigV1.Info),
    builtInProviderIDs: () => Effect.succeed(new Set(options.builtIn ?? [])),
    readGlobalProvider: () => Effect.succeed(structuredClone(state.global)),
    writeGlobalProvider: (_providerID, value) => {
      globalWrites++
      state.order.push(globalWrites > 1 && value.provider?.name === "Original" ? "rollbackConfig" : "config")
      return fail(
        globalWrites === 1 ? "config" : "rollbackNativeCredential",
        Effect.sync(() => {
          state.global = structuredClone(value)
        }),
      )
    },
    readNativeCredential: () => Effect.succeed(state.native),
    writeNativeCredential: (_providerID, value) => {
      nativeWrites++
      state.order.push(
        value?.value.type === "key" && value.value.key === "old-native-secret"
          ? "rollbackNativeCredential"
          : "nativeCredential",
      )
      const effect = Effect.sync(() => {
        state.native = value
          ? new Credential.Info({
              id: Credential.ID.create(),
              integrationID: Integration.ID.make("custom"),
              ...value,
            })
          : undefined
      })
      if (nativeWrites > 1) return fail("rollbackNativeCredential", effect)
      return fail("nativeCredential", effect)
    },
    refresh: (_providerID, models) => {
      refreshes++
      state.order.push(models?.[0] === "old" ? "rollbackCatalogRefresh" : "catalogRefresh")
      return fail(
        refreshes === 1 ? "catalogRefresh" : "rollbackNativeCredential",
        Effect.sync(() => {
          state.refreshes.push(models)
        }),
      )
    },
  }
  return { ports, state, initial }
}

describe("configureWith", () => {
  it.effect("persists a literal credential and reconnects a disabled custom provider", () =>
    Effect.gen(function* () {
      const test = harness({
        provider: originalProvider,
        resolvedProvider: originalProvider,
        disabledProviders: ["other", "custom"],
        native: originalNative,
      })
      const result = yield* configureWith(test.ports, input)

      expect(result).toEqual({
        providerID: "custom",
        name: "Custom",
        protocol: "openai-compatible",
        models: ["model-a"],
      })
      expect(test.state.global.disabledProviders).toEqual(["other"])
      expect(test.state.global.provider?.env).toBeUndefined()
      expect(test.state.global.provider?.options?.baseURL).toBe("https://custom.example/v1")
      expect(test.state.native?.label).toBe("Custom")
      expect(test.state.native?.value).toEqual({ type: "key", key: "new-secret" })
      expect(test.state.order).toEqual(["config", "nativeCredential", "catalogRefresh"])
    }),
  )

  it.effect("uses env references only in config and removes prior credentials", () =>
    Effect.gen(function* () {
      const test = harness({ native: originalNative })
      yield* configureWith(test.ports, { ...input, apiKey: "{env:CUSTOM_KEY}" })
      expect(test.state.global.provider?.env).toEqual(["CUSTOM_KEY"])
      expect(test.state.native).toBeUndefined()
    }),
  )

  it.effect("blank credentials remove prior literal credentials", () =>
    Effect.gen(function* () {
      const test = harness({ native: originalNative })
      yield* configureWith(test.ports, { ...input, apiKey: "   " })
      expect(test.state.global.provider?.env).toBeUndefined()
      expect(test.state.native).toBeUndefined()
    }),
  )

  it.effect("blank credentials preserve the existing credential during an explicit update", () =>
    Effect.gen(function* () {
      const test = harness({
        provider: originalProvider,
        resolvedProvider: originalProvider,
        native: originalNative,
      })
      yield* configureWith(test.ports, { ...input, update: true, apiKey: "   " })
      expect(test.state.global.provider?.env).toEqual(["OLD_ENV"])
      expect(test.state.native?.label).toBe("original label")
      expect(test.state.native?.value).toEqual(originalNative.value)
    }),
  )

  it.effect("a new update credential replaces env and credential state", () =>
    Effect.gen(function* () {
      const test = harness({
        provider: originalProvider,
        resolvedProvider: originalProvider,
        native: originalNative,
      })
      yield* configureWith(test.ports, { ...input, update: true, apiKey: "replacement-secret" })
      expect(test.state.global.provider?.env).toBeUndefined()
      expect(test.state.native?.label).toBe("Custom")
      expect(test.state.native?.value).toEqual({ type: "key", key: "replacement-secret" })
    }),
  )

  it.effect("rejects built-in and active configured provider IDs but allows disabled reconnects", () =>
    Effect.gen(function* () {
      for (const test of [harness({ builtIn: ["custom"] }), harness({ resolvedProvider: originalProvider })]) {
        const exit = yield* configureWith(test.ports, input).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(CustomProvider.ConflictError)
        }
        expect(test.state.order).toEqual([])
      }
    }),
  )

  for (const stage of ["config", "nativeCredential", "catalogRefresh"] as const) {
    it.effect(`restores every snapshot after a ${stage} defect`, () =>
      Effect.gen(function* () {
        const test = harness({
          provider: originalProvider,
          disabledProviders: ["custom", "other"],
          native: originalNative,
          failure: stage,
        })
        const exit = yield* configureWith(test.ports, input).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause) as CustomProvider.ConfigureError
          expect(error.stage).toBe(stage)
          expect(JSON.stringify(error)).not.toContain("new-secret")
        }
        expect(test.state.global).toEqual(test.initial.global)
        expect(test.state.native?.label).toBe("original label")
        expect(test.state.native?.value).toEqual(test.initial.native?.value)
        expect(test.state.order.slice(-3)).toEqual([
          "rollbackNativeCredential",
          "rollbackConfig",
          "rollbackCatalogRefresh",
        ])
      }),
    )
  }

  it.effect("returns a redacted rollback error when recovery fails", () =>
    Effect.gen(function* () {
      const test = harness({
        provider: originalProvider,
        disabledProviders: ["custom"],
        native: originalNative,
        failure: "rollbackNativeCredential",
      })
      let refreshCall = 0
      const ports = {
        ...test.ports,
        refresh: (providerID: string, models: readonly string[] | undefined) => {
          refreshCall++
          if (refreshCall === 1) return Effect.die(new Error("new-secret"))
          return test.ports.refresh(providerID, models)
        },
      }
      const exit = yield* configureWith(ports, input).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause) as CustomProvider.ConfigureError
        expect(error.stage).toBe("rollback")
        expect(error.recoveryWarning).toBeDefined()
        expect(JSON.stringify(error)).not.toContain("new-secret")
        expect(JSON.stringify(error)).not.toContain("old-native-secret")
      }
      expect(test.state.order.slice(-3)).toEqual([
        "rollbackNativeCredential",
        "rollbackConfig",
        "rollbackCatalogRefresh",
      ])
      expect(test.state.global).toEqual(test.initial.global)
      expect(test.state.refreshes.at(-1)).toEqual(["old"])
    }),
  )
})

describe("disconnectWith", () => {
  it.effect("removes inline API keys while retaining custom provider metadata", () =>
    Effect.gen(function* () {
      const test = harness({
        provider: ConfigProviderV1.Info.make({
          ...originalProvider,
          options: {
            ...originalProvider.options,
            apiKey: "expired-inline-secret",
          },
        }),
        native: originalNative,
      })

      yield* disconnectWith(test.ports, "custom")

      expect(test.state.global.provider?.options?.apiKey).toBeUndefined()
      expect(test.state.global.provider?.options?.baseURL).toBe("https://old.example/v1")
      expect(test.state.global.provider?.models).toEqual(originalProvider.models)
    }),
  )

  it.effect("disables the custom provider and removes its credential", () =>
    Effect.gen(function* () {
      const test = harness({
        provider: originalProvider,
        disabledProviders: ["custom", "other"],
        native: originalNative,
      })

      yield* disconnectWith(test.ports, "custom")

      expect(test.state.global.provider).toEqual(originalProvider)
      expect(test.state.global.disabledProviders).toEqual(["custom", "other"])
      expect(test.state.native).toBeUndefined()
      expect(test.state.order).toEqual(["nativeCredential", "config", "catalogRefresh"])
      expect(test.state.refreshes.at(-1)).toBeUndefined()
    }),
  )
})
