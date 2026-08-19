import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { CommandV2 } from "@opencode-ai/core/command"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { legacyProvidersFromNative } from "@/compat/native-v1-catalog"
import { Context, Effect, Layer, SynchronizedRef } from "effect"
import type * as ACPError from "./error"

export type ModelOption = {
  readonly providerID: ProviderV2.ID
  readonly providerName: string
  readonly modelID: ModelV2.ID
  readonly modelName: string
}

export type ModeOption = {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export type ModelVariants = NonNullable<Provider.Model["variants"]>

export type DefaultModel = {
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

export type Snapshot = {
  readonly directory: string
  readonly providers: Record<ProviderV2.ID, Provider.Info>
  readonly modelOptions: readonly ModelOption[]
  readonly variantsByModel: Readonly<Record<string, ModelVariants>>
  readonly availableModes: readonly ModeOption[]
  readonly defaultModeID: string
  readonly availableCommands: readonly CommandV2.Info[]
  readonly defaultModel?: DefaultModel
}

export interface LoaderInterface {
  readonly load: (directory: string) => Effect.Effect<Snapshot, ACPError.Error>
}

export interface Interface {
  readonly get: (directory: string) => Effect.Effect<Snapshot, ACPError.Error>
  readonly refresh: (directory: string) => Effect.Effect<Snapshot, ACPError.Error>
  readonly variants: (snapshot: Snapshot, model: DefaultModel) => ModelVariants | undefined
}

export class Loader extends Context.Service<Loader, LoaderInterface>()("@opencode/ACPDirectoryLoader") {}

export class Service extends Context.Service<Service, Interface>()("@opencode/ACPDirectory") {}

export const modelKey = (model: DefaultModel) => `${model.providerID}/${model.modelID}`

export const variants = (snapshot: Snapshot, model: DefaultModel) => snapshot.variantsByModel[modelKey(model)]

export const build = (input: {
  readonly directory: string
  readonly providers: Record<ProviderV2.ID, Provider.Info>
  readonly modes: readonly ModeOption[]
  readonly defaultModeID: string
  readonly commands: readonly CommandV2.Info[]
  readonly defaultModel?: DefaultModel
}): Snapshot => {
  const modelOptions = Provider.sort(
    Object.values(input.providers).flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        id: model.id,
        providerID: provider.id,
        providerName: provider.name,
        modelID: model.id,
        modelName: model.name,
      })),
    ),
  ).map((model) => ({
    providerID: model.providerID,
    providerName: model.providerName,
    modelID: model.modelID,
    modelName: model.modelName,
  }))

  return {
    directory: input.directory,
    providers: input.providers,
    modelOptions,
    variantsByModel: Object.fromEntries(
      Object.values(input.providers).flatMap((provider) =>
        Object.values(provider.models).flatMap((model) =>
          model.variants ? [[modelKey({ providerID: provider.id, modelID: model.id }), model.variants]] : [],
        ),
      ),
    ),
    availableModes: input.modes,
    defaultModeID: input.modes.some((mode) => mode.id === input.defaultModeID)
      ? input.defaultModeID
      : (input.modes[0]?.id ?? input.defaultModeID),
    availableCommands: input.commands,
    ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
  }
}

export const loaderLayer = Layer.effect(
  Loader,
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const locations = yield* LocationServiceMap.Service

    return Loader.of({
      load: Effect.fn("ACPDirectoryLoader.load")(function* (directory) {
        const ctx = yield* store.load({ directory })
        const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) }))
        const agent = yield* AgentV2.Service.pipe(Effect.provide(services))
        const command = yield* CommandV2.Service.pipe(Effect.provide(services))
        const catalog = yield* Catalog.Service.pipe(Effect.provide(services))
        const snapshot = yield* CatalogSnapshot.Service.pipe(Effect.provide(services))
        const [agents, defaultAgent, commands, providerCatalog, defaultModel] = yield* Effect.all(
          [agent.all(), agent.default(), command.list(), snapshot.get(), catalog.model.default()],
          { concurrency: "unbounded" },
        )
        if (!defaultAgent) return yield* Effect.die("no primary visible agent found")
        const providers = legacyProvidersFromNative(providerCatalog).providers
        return build({
          directory,
          providers: Object.fromEntries(providers.map((provider) => [provider.id, provider])) as Record<
            ProviderV2.ID,
            Provider.Info
          >,
          modes: agents
            .filter((item) => item.mode !== "subagent" && item.hidden !== true)
            .map((item) => ({
              id: item.id,
              name: item.id,
              ...(item.description ? { description: item.description } : {}),
            })),
          defaultModeID: defaultAgent.id,
          commands: commands.toSorted((a, b) => a.name.localeCompare(b.name)),
          ...(defaultModel
            ? { defaultModel: { providerID: defaultModel.providerID, modelID: defaultModel.id } }
            : {}),
        })
      }),
    })
  }),
)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const loader = yield* Loader
    const snapshots = yield* SynchronizedRef.make(new Map<string, Effect.Effect<Snapshot, ACPError.Error>>())

    const cached = Effect.fnUntraced(function* (directory: string) {
      return yield* SynchronizedRef.modifyEffect(
        snapshots,
        Effect.fnUntraced(function* (items) {
          const current = items.get(directory)
          if (current) return [current, items] as const
          const next = yield* Effect.cached(
            loader.load(directory).pipe(
              Effect.tapError(() =>
                SynchronizedRef.update(snapshots, (state) => {
                  const next = new Map(state)
                  next.delete(directory)
                  return next
                }),
              ),
            ),
          )
          return [next, new Map(items).set(directory, next)] as const
        }),
      )
    })

    const get = Effect.fn("ACPDirectory.get")(function* (directory: string) {
      return yield* yield* cached(directory)
    })

    const refresh = Effect.fn("ACPDirectory.refresh")(function* (directory: string) {
      return yield* SynchronizedRef.modifyEffect(
        snapshots,
        Effect.fnUntraced(function* (items) {
          const next = yield* Effect.cached(
            loader.load(directory).pipe(
              Effect.tapError(() =>
                SynchronizedRef.update(snapshots, (state) => {
                  const next = new Map(state)
                  next.delete(directory)
                  return next
                }),
              ),
            ),
          )
          return [next, new Map(items).set(directory, next)] as const
        }),
      ).pipe(Effect.flatten)
    })

    return Service.of({
      get,
      refresh,
      variants,
    })
  }),
)

export const loaderNode = LayerNode.make({
  service: Loader,
  layer: loaderLayer,
  deps: [LocationServiceMap.node, InstanceStore.node],
})

export const node = LayerNode.make({ service: Service, layer, deps: [loaderNode] })

export * as Directory from "./directory"
