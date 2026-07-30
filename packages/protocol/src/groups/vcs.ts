import { Location } from "@opencode-ai/schema/location"
import { Vcs } from "@opencode-ai/schema/vcs"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const VcsGroup = HttpApiGroup.make("server.vcs")
  .add(
    HttpApiEndpoint.get("vcs.get", "/api/vcs", {
      query: LocationQuery,
      success: Location.response(Vcs.Info),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("vcs.status", "/api/vcs/status", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Vcs.FileStatus)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("vcs.diff", "/api/vcs/diff", {
      query: Schema.Struct({
        ...LocationQuery.fields,
        mode: Vcs.DiffMode,
        context: Schema.NumberFromString.pipe(Schema.optional),
      }),
      success: Location.response(Schema.Array(Vcs.Diff)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .annotateMerge(OpenApi.annotations({ title: "vcs", description: "Host version-control status routes." }))
