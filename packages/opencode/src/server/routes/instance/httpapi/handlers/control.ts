import { AuthWire } from "@/compat/auth-wire"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Credential } from "@opencode-ai/core/credential"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const credentials = yield* Credential.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: AuthWire.Info
    }) {
      const integrationID = AuthWire.normalizeIntegrationID(ctx.params.providerID)
      const saved = (yield* credentials.list(integrationID))[0]
      yield* credentials.create({
        integrationID,
        label: saved?.label,
        value: AuthWire.toCredential(ctx.payload, saved?.value),
      })
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      yield* Effect.forEach(
        yield* credentials.list(AuthWire.normalizeIntegrationID(ctx.params.providerID)),
        (credential) => credentials.remove(credential.id),
        { discard: true },
      )
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
