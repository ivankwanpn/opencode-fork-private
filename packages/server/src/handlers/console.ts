import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConsoleCapability } from "../console-capability"
import { response } from "../location"

export const ConsoleHandler = HttpApiBuilder.group(Api, "server.console", (handlers) =>
  Effect.gen(function* () {
    const console = yield* ConsoleCapability.Service
    return handlers
      .handle("console.get", () => response(console.get()))
      .handle("console.org.list", () => response(console.listOrgs()))
      .handle("console.org.switch", (ctx) => response(console.switchOrg(ctx.payload)))
  }),
)
