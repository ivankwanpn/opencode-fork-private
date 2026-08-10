import { PermissionV2 } from "@opencode-ai/core/permission"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PermissionNotFoundError } from "../errors"

export const permissionHandlers = HttpApiBuilder.group(InstanceHttpApi, "permission", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service

    const location = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      return yield* effect.pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({
              directory: AbsolutePath.make(ctx.directory),
              ...(workspaceID === undefined ? {} : { workspaceID }),
            }),
          ),
        ),
      )
    })

    const list = Effect.fn("PermissionHttpApi.list")(function* () {
      return yield* location(Effect.gen(function* () {
        const permission = yield* PermissionV2.Service
        return yield* permission.list()
      }))
    })

    const reply = Effect.fn("PermissionHttpApi.reply")(function* (ctx: {
      params: { requestID: PermissionV2.ID }
      payload: { reply: PermissionV2.Reply; message?: string }
    }) {
      yield* location(
        Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          yield* permission.reply({
            requestID: ctx.params.requestID,
            reply: ctx.payload.reply,
            message: ctx.payload.message,
          })
        }),
      ).pipe(
        Effect.catchTag("PermissionV2.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    return handlers.handle("list", list).handle("reply", reply)
  }),
)
