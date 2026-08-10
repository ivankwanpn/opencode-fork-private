import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { VcsCapability } from "../vcs-capability"

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    const vcs = yield* VcsCapability.Service
    return handlers
      .handle("vcs.get", () => response(vcs.get()))
      .handle("vcs.status", () => response(vcs.status()))
      .handle("vcs.diff", (ctx) => response(vcs.diff(ctx.query.mode, { context: ctx.query.context })))
  }),
)
