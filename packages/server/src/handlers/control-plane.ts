import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"

export const ControlPlaneHandler = HttpApiBuilder.group(Api, "server.controlPlane", (handlers) =>
  handlers.handle("controlPlane.moveSession", (ctx) =>
    Effect.gen(function* () {
      yield* (yield* MoveSession.Service).moveSession(ctx.payload).pipe(
        Effect.mapError((error) => new InvalidRequestError({ message: error.message, kind: "move_session" })),
      )
      return HttpApiSchema.NoContent.make()
    }),
  ),
)
