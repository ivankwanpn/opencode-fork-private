import { EOL } from "os"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { PluginV1Projection } from "@opencode-ai/core/plugin/v1-projection"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { ProviderV2 } from "@opencode-ai/core/provider"

export const ModelsCommand = effectCmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.models")(function* (args) {
    const locations = yield* LocationServiceMap.Service
    if (args.refresh) {
      yield* ModelsDev.Service.use((s) => s.refresh(true))
      yield* LocationServiceMap.Service.invalidateAll
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    const ctx = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const catalog = yield* Catalog.Service.pipe(
      Effect.provide(
        locations.get(
          Location.Ref.make({
            directory: AbsolutePath.make(ctx.directory),
            ...(workspaceID === undefined ? {} : { workspaceID }),
          }),
        ),
      ),
    )
    const [providers, models] = yield* Effect.all([catalog.provider.available(), catalog.model.available()], {
      concurrency: "unbounded",
    })

    const print = (providerID: ProviderV2.ID, verbose?: boolean) => {
      const sorted = models
        .filter((model) => model.providerID === providerID)
        .toSorted((a, b) => a.id.localeCompare(b.id))
      for (const model of sorted) {
        process.stdout.write(`${providerID}/${model.id}`)
        process.stdout.write(EOL)
        if (verbose) {
          process.stdout.write(JSON.stringify(PluginV1Projection.model(model), null, 2))
          process.stdout.write(EOL)
        }
      }
    }

    if (args.provider) {
      const providerID = ProviderV2.ID.make(args.provider)
      if (!providers.some((provider) => provider.id === providerID)) {
        return yield* fail(`Provider not found: ${args.provider}`)
      }
      print(providerID, args.verbose)
      return
    }

    const ids = providers.map((provider) => provider.id).sort((a, b) => {
      const aIsOpencode = a.startsWith("opencode")
      const bIsOpencode = b.startsWith("opencode")
      if (aIsOpencode && !bIsOpencode) return -1
      if (!aIsOpencode && bIsOpencode) return 1
      return a.localeCompare(b)
    })

    for (const providerID of ids) print(ProviderV2.ID.make(providerID), args.verbose)
  }),
})
