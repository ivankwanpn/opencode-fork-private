import { Location } from "@opencode-ai/schema/location"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEvent } from "@opencode-ai/schema/workspace-event"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const WorkspaceGroup = HttpApiGroup.make("server.workspace")
  .add(
    HttpApiEndpoint.get("workspace.adapter.list", "/api/workspace/adapter", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Workspace.Adapter)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("workspace.list", "/api/workspace", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Workspace.Info)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("workspace.create", "/api/workspace", {
      query: LocationQuery,
      payload: Workspace.Create,
      success: Location.response(Workspace.Info),
      error: InvalidRequestError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.delete("workspace.remove", "/api/workspace/:workspaceID", {
      params: { workspaceID: Workspace.ID },
      query: LocationQuery,
      success: Location.response(Schema.Boolean),
      error: InvalidRequestError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("workspace.status", "/api/workspace/status", {
      query: LocationQuery,
      success: Location.response(Schema.Array(WorkspaceEvent.ConnectionStatus)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("workspace.syncList", "/api/workspace/sync", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("workspace.start", "/api/workspace/start", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("workspace.warp", "/api/workspace/warp", {
      query: LocationQuery,
      payload: Workspace.Warp,
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .annotateMerge(OpenApi.annotations({ title: "workspaces", description: "Host workspace lifecycle routes." }))
