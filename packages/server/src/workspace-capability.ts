import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { Context, Effect, Layer, Schema } from "effect"

export class OperationError extends Schema.TaggedErrorClass<OperationError>()("WorkspaceCapability.OperationError", {
  kind: Schema.Literals(["unavailable", "create", "remove", "sync", "warp", "vcs_apply"]),
  message: Schema.String,
}) {}

export interface Interface {
  readonly adapters: () => Effect.Effect<readonly Workspace.Adapter[]>
  readonly list: () => Effect.Effect<readonly Workspace.Info[]>
  readonly create: (input: Workspace.Create) => Effect.Effect<Workspace.Info, OperationError>
  readonly remove: (id: Workspace.ID) => Effect.Effect<boolean, OperationError>
  readonly status: () => Effect.Effect<readonly WorkspaceEvent.ConnectionStatus[]>
  readonly syncList: () => Effect.Effect<void, OperationError>
  readonly start: () => Effect.Effect<void, OperationError>
  readonly warp: (input: Workspace.Warp) => Effect.Effect<void, OperationError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/WorkspaceCapability") {}

const unavailable = () => Effect.fail(new OperationError({ kind: "unavailable", message: "Workspaces are unavailable" }))

export const layer = Layer.succeed(
  Service,
  Service.of({
    adapters: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    create: unavailable,
    remove: unavailable,
    status: () => Effect.succeed([]),
    syncList: unavailable,
    start: unavailable,
    warp: unavailable,
  }),
)

export * as WorkspaceCapability from "./workspace-capability"
