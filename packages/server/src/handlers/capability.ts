import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const CapabilityHandler = HttpApiBuilder.group(Api, "server.capability", (handlers) =>
  handlers.handle("capability.get", () =>
    Effect.succeed({ backgroundSubagents: true }),
  ),
)
