import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { FormatterCapability } from "../formatter-capability"
import { response } from "../location"

export const FormatterHandler = HttpApiBuilder.group(Api, "server.formatter", (handlers) =>
  Effect.gen(function* () {
    const formatter = yield* FormatterCapability.Service
    return handlers.handle("formatter.status", () => response(formatter.status()))
  }),
)
