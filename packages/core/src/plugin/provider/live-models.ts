import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { EventV2 } from "../../event"
import { Integration } from "../../integration"
import { ModelsDev } from "../../models-dev"
import {
  applyLiveModels,
  ProviderModelDiscovery,
  resolveLiveSnapshot,
  type LiveModelsSnapshot,
} from "../../provider-discovery"

export { applyLiveModels, resolveLiveSnapshot, supportsLiveModels, type LiveModelsSnapshot } from "../../provider-discovery"

export const LiveModelsPlugin = define({
  id: "live-models",
  effect: Effect.fn(function* () {
    const events = yield* EventV2.Service
    const discovery = yield* ProviderModelDiscovery.Service
    const refresh = Effect.fn("LiveModelsPlugin.refresh")(function* () {
      yield* discovery.refreshAll()
    })

    yield* refresh()
    yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.runForEach(() => refresh().pipe(Effect.ignore)),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* events.subscribe(ModelsDev.Event.Refreshed).pipe(
      Stream.runForEach(() => refresh().pipe(Effect.ignore)),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
