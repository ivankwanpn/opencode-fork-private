import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Catalog } from "@opencode-ai/core/catalog"
import { ConfigProviderPlugin } from "@opencode-ai/core/config/plugin/provider"
import { Credential } from "@opencode-ai/core/credential"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect, Exit } from "effect"
import { buildProviderConfig, normalizeConfigureInput, parseCredential } from "./domain"

export interface GlobalProviderState {
  readonly provider?: ConfigProviderV1.Info
  readonly disabledProviders?: readonly string[]
}

export interface ConfigurePorts {
  readonly resolvedConfig: () => Effect.Effect<ConfigV1.Info>
  readonly builtInProviderIDs: () => Effect.Effect<ReadonlySet<string>>
  readonly readGlobalProvider: (providerID: string) => Effect.Effect<GlobalProviderState>
  readonly writeGlobalProvider: (providerID: string, state: GlobalProviderState) => Effect.Effect<void, unknown>
  readonly readLegacyCredential: (providerID: string) => Effect.Effect<Auth.Info | undefined, unknown>
  readonly writeLegacyCredential: (providerID: string, value?: Auth.Info) => Effect.Effect<void, unknown>
  readonly readNativeCredential: (providerID: string) => Effect.Effect<Credential.Info | undefined>
  readonly writeNativeCredential: (
    providerID: string,
    value?: Pick<Credential.Info, "label" | "value">,
  ) => Effect.Effect<void, unknown>
  readonly refresh: (
    providerID: string,
    expectedModelIDs: readonly string[] | undefined,
    provider?: ConfigProviderV1.Info,
  ) => Effect.Effect<void, unknown>
}

type ConfigureStage = CustomProvider.ConfigureError["stage"]

export function configureWith(
  ports: ConfigurePorts,
  input: CustomProvider.ConfigureInput,
): Effect.Effect<
  CustomProvider.ConfigureResult,
  CustomProvider.ValidationError | CustomProvider.ConflictError | CustomProvider.ConfigureError
> {
  return Effect.gen(function* () {
    const normalized = yield* normalizeConfigureInput(input)
    const resolved = yield* ports.resolvedConfig()
    const builtIn = yield* ports.builtInProviderIDs()
    const beforeGlobal = yield* ports.readGlobalProvider(normalized.providerID)
    const updating = normalized.update === true

    if (builtIn.has(normalized.providerID)) return yield* conflict(normalized.providerID)
    if (updating && beforeGlobal.provider === undefined) return yield* conflict(normalized.providerID)
    const reconnectingDisabledGlobal =
      beforeGlobal.provider !== undefined && (resolved.disabled_providers ?? []).includes(normalized.providerID)
    if (resolved.provider?.[normalized.providerID] !== undefined && !reconnectingDisabledGlobal && !updating) {
      return yield* conflict(normalized.providerID)
    }

    const beforeLegacy = yield* stage("legacyCredential", ports.readLegacyCredential(normalized.providerID))
    const beforeNative = yield* stage("nativeCredential", ports.readNativeCredential(normalized.providerID))
    const configured = buildProviderConfig(normalized)
    const afterGlobal = {
      provider:
        updating && normalized.apiKey === undefined && beforeGlobal.provider?.env
          ? { ...configured, env: beforeGlobal.provider.env }
          : configured,
      disabledProviders: beforeGlobal.disabledProviders?.filter((id) => id !== normalized.providerID),
    }
    const credential = parseCredential(normalized.apiKey)
    const legacy =
      updating && normalized.apiKey === undefined
        ? beforeLegacy
        : credential.key
          ? new Auth.Api({ type: "api", key: credential.key })
          : undefined
    const native =
      updating && normalized.apiKey === undefined
        ? beforeNative
          ? { label: beforeNative.label, value: beforeNative.value }
          : undefined
        : credential.key
          ? {
              label: normalized.name,
              value: { type: "key" as const, key: credential.key },
            }
          : undefined

    const transaction = Effect.gen(function* () {
      yield* stage("config", ports.writeGlobalProvider(normalized.providerID, afterGlobal))
      yield* stage("legacyCredential", ports.writeLegacyCredential(normalized.providerID, legacy))
      yield* stage("nativeCredential", ports.writeNativeCredential(normalized.providerID, native))
      yield* stage(
        "catalogRefresh",
        ports.refresh(
          normalized.providerID,
          normalized.models.map((model) => model.id),
          afterGlobal.provider,
        ),
      )
      return {
        providerID: normalized.providerID,
        name: normalized.name,
        protocol: normalized.protocol ?? "openai-compatible",
        models: normalized.models.map((model) => model.id),
      }
    })

    return yield* transaction.pipe(
      Effect.catch((error) =>
        rollback(ports, normalized.providerID, beforeGlobal, beforeLegacy, beforeNative).pipe(
          Effect.flatMap((recovered) =>
            recovered
              ? Effect.fail(error)
              : Effect.fail(
                  new CustomProvider.ConfigureError({
                    stage: "rollback",
                    message: "Failed to configure custom provider",
                    recoveryWarning: "Previous provider settings may need to be restored manually.",
                  }),
                ),
          ),
        ),
      ),
    )
  })
}

export const make = Effect.gen(function* () {
  const config = yield* Config.Service
  const auth = yield* Auth.Service
  const credentials = yield* Credential.Service
  const locations = yield* LocationServiceMap.Service
  const modelsDev = yield* ModelsDev.Service

  const configure = (input: CustomProvider.ConfigureInput, location: Location.Ref) =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      return yield* configureWith(
        {
          resolvedConfig: () => config.get(),
          builtInProviderIDs: () => modelsDev.get().pipe(Effect.map((providers) => new Set(Object.keys(providers)))),
          readGlobalProvider: (providerID) =>
            config.getGlobal().pipe(
              Effect.map((global) => ({
                provider: global.provider?.[providerID],
                disabledProviders: global.disabled_providers,
              })),
            ),
          writeGlobalProvider: (providerID, state) =>
            config
              .updateGlobalProvider({
                providerID,
                provider: state.provider,
                disabledProviders: state.disabledProviders,
              })
              .pipe(Effect.asVoid),
          readLegacyCredential: (providerID) => auth.get(providerID),
          writeLegacyCredential: (providerID, value) => (value ? auth.set(providerID, value) : auth.remove(providerID)),
          readNativeCredential: (providerID) =>
            credentials
              .list(Integration.ID.make(providerID))
              .pipe(
                Effect.flatMap((items) =>
                  items.length <= 1
                    ? Effect.succeed(items[0])
                    : Effect.die(new Error("multiple credentials found for one integration")),
                ),
              ),
          writeNativeCredential: (providerID, value) =>
            Effect.gen(function* () {
              const integrationID = Integration.ID.make(providerID)
              if (value) {
                yield* credentials.create({ integrationID, label: value.label, value: value.value })
                return
              }
              const existing = yield* credentials.list(integrationID)
              yield* Effect.forEach(existing, (item) => credentials.remove(item.id), { discard: true })
            }),
          refresh: (providerID, expectedModelIDs, provider) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* catalog.transform((draft) =>
                  Effect.sync(() => {
                    draft.provider.remove(ProviderV2.ID.make(providerID))
                    if (provider) ConfigProviderPlugin.projectV1(draft, providerID, provider)
                  }),
                )
                const refreshed = yield* catalog.provider.get(ProviderV2.ID.make(providerID))
                if (expectedModelIDs === undefined) {
                  if (refreshed) return yield* Effect.die(new Error("provider remained in catalog after rollback"))
                } else {
                  if (!refreshed) return yield* Effect.die(new Error("provider missing from refreshed catalog"))
                  yield* Effect.forEach(expectedModelIDs, (modelID) =>
                    catalog.model
                      .get(ProviderV2.ID.make(providerID), ModelV2.ID.make(modelID))
                      .pipe(
                        Effect.flatMap((model) =>
                          model
                            ? Effect.void
                            : Effect.die(new Error(`model missing from refreshed catalog: ${modelID}`)),
                        ),
                      ),
                  )
                }
                if (locations.invalidateAll) return yield* locations.invalidateAll()
                yield* locations.invalidate(location)
              }),
            ),
        },
        input,
      )
    }).pipe(Effect.provide(locations.get(location)))

  return { configure } as const
})

export const configure = (
  input: CustomProvider.ConfigureInput,
  location: Location.Ref,
): Effect.Effect<
  CustomProvider.ConfigureResult,
  CustomProvider.ValidationError | CustomProvider.ConflictError | CustomProvider.ConfigureError,
  Config.Service | Auth.Service | Credential.Service | LocationServiceMap.Service | ModelsDev.Service
> =>
  Effect.gen(function* () {
    const service = yield* make
    return yield* service.configure(input, location)
  })

function stage<A>(name: Exclude<ConfigureStage, "rollback">, effect: Effect.Effect<A, unknown>) {
  return effect.pipe(
    Effect.sandbox,
    Effect.mapError(
      () =>
        new CustomProvider.ConfigureError({
          stage: name,
          message: "Failed to configure custom provider",
        }),
    ),
  )
}

function conflict(providerID: string) {
  return new CustomProvider.ConflictError({
    providerID,
    message: `Provider "${providerID}" is already configured`,
  })
}

function rollback(
  ports: ConfigurePorts,
  providerID: string,
  beforeGlobal: GlobalProviderState,
  beforeLegacy: Auth.Info | undefined,
  beforeNative: Credential.Info | undefined,
) {
  return Effect.gen(function* () {
    const results = yield* Effect.forEach(
      [
        () => ports.writeNativeCredential(providerID, beforeNative),
        () => ports.writeLegacyCredential(providerID, beforeLegacy),
        () => ports.writeGlobalProvider(providerID, beforeGlobal),
        () =>
          ports.refresh(
            providerID,
            beforeGlobal.provider ? Object.keys(beforeGlobal.provider.models ?? {}) : undefined,
            beforeGlobal.provider,
          ),
      ],
      (action) => Effect.suspend(action).pipe(Effect.sandbox, Effect.exit),
      { concurrency: 1 },
    )
    return results.every(Exit.isSuccess)
  })
}

export * as CustomProviderService from "./service"
