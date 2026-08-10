import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { Api } from "../api"
import { response } from "../location"
import { WorkspaceCapability } from "../workspace-capability"

const operation = <A>(effect: Effect.Effect<A, WorkspaceCapability.OperationError>) =>
  effect.pipe(
    Effect.mapError(
      (error) => new InvalidRequestError({ message: error.message, kind: `workspace_${error.kind}` }),
    ),
  )

export const WorkspaceHandler = HttpApiBuilder.group(Api, "server.workspace", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* WorkspaceCapability.Service
    return handlers
      .handle("workspace.adapter.list", () => response(workspace.adapters()))
      .handle("workspace.list", () => response(workspace.list()))
      .handle("workspace.create", (ctx) => response(operation(workspace.create(ctx.payload))))
      .handle("workspace.remove", (ctx) => response(operation(workspace.remove(ctx.params.workspaceID))))
      .handle("workspace.status", () => response(workspace.status()))
      .handle("workspace.syncList", () =>
        operation(workspace.syncList()).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle("workspace.start", () =>
        operation(workspace.start()).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle("workspace.warp", (ctx) =>
        operation(workspace.warp(ctx.payload)).pipe(Effect.as(HttpApiSchema.NoContent.make())),
      )
  }),
)
