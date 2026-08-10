import { MoveSession } from "@opencode-ai/schema/move-session"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

export const ControlPlaneGroup = HttpApiGroup.make("server.controlPlane")
  .add(
    HttpApiEndpoint.post("controlPlane.moveSession", "/api/control-plane/session/move", {
      payload: MoveSession.Input,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "controlPlane", description: "Cross-location orchestration routes." }))
