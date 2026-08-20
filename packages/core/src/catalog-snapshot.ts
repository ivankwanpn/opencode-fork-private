export * as CatalogSnapshot from "./catalog-snapshot"

import { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"
import { Context, Effect, Layer } from "effect"
import { Catalog } from "./catalog"
import { Credential } from "./credential"
import { makeLocationNode } from "./effect/app-node"
import { Integration } from "./integration"
import { ProviderV2 } from "./provider"

export interface Interface {
  readonly get: () => Effect.Effect<ProviderCatalog.Info>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CatalogSnapshot") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const integration = yield* Integration.Service
    const credential = yield* Credential.Service

    const get = Effect.fn("CatalogSnapshot.get")(function* () {
      const [providers, models, available, integrations, credentials, defaultModel] = yield* Effect.all(
        [
          catalog.provider.all(),
          catalog.model.all(),
          catalog.provider.available(),
          integration.list(),
          credential.all(),
          catalog.model.default(),
        ],
        { concurrency: "unbounded" },
      )
      const integrationByID = new Map(integrations.map((item) => [item.id, item]))
      const credentialTypes = new Map(
        credentials.flatMap((item) => (item.value.type === "wellknown" ? [] : [[item.id, item.value.type] as const])),
      )
      const defaults = Object.fromEntries(
        providers.flatMap((provider) => {
          const model =
            defaultModel?.providerID === provider.id
              ? defaultModel
              : models.find(
                  (item) => item.providerID === provider.id && item.enabled && item.status !== "deprecated",
                )
          return model ? [[provider.id, model.id]] : []
        }),
      )

      return {
        providers: providers.map((provider) => {
          const info = integrationByID.get(provider.integrationID ?? Integration.ID.make(provider.id))
          return {
            info: provider,
            source: source(provider, info),
            auth: auth(info, credentialTypes),
            env: info?.methods.flatMap((method) => (method.type === "env" ? method.names : [])) ?? [],
          }
        }),
        models,
        connected: available.map((provider) => provider.id),
        default: defaults,
      }
    })

    return Service.of({ get })
  }),
)

function source(provider: ProviderV2.Info, integration: Integration.Info | undefined): ProviderCatalog.Source {
  const connection = integration?.connections[0]
  if (connection?.type === "env") return "env"
  if (connection?.type === "credential") return "api"
  if (ProviderV2.hasConfiguredCredentials(provider)) return "config"
  return "custom"
}

function auth(
  integration: Integration.Info | undefined,
  credentials: ReadonlyMap<Credential.ID, Credential.Value["type"]>,
): ProviderCatalog.Auth | undefined {
  const connection = integration?.connections[0]
  if (connection?.type === "env") return "env"
  if (connection?.type === "credential") return credentials.get(connection.id)
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, Integration.node, Credential.node],
})
