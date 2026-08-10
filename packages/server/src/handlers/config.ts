import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConfigCapability } from "../config-capability"
import { response } from "../location"

export const ConfigHandler = HttpApiBuilder.group(Api, "server.config", (handlers) =>
  Effect.gen(function* () {
    const config = yield* ConfigCapability.Service
    return handlers
      .handle("config.get", () => response(config.get()))
      .handle("config.update", (ctx) => response(config.update(ctx.payload.config)))
  }),
)
