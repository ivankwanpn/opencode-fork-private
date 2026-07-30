import { Path } from "@opencode-ai/schema/path"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const PathGroup = HttpApiGroup.make("server.path")
  .add(
    HttpApiEndpoint.get("path.get", "/api/path", {
      query: LocationQuery,
      success: Path.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.path.get",
          summary: "Get paths",
          description: "Retrieve global and location-scoped filesystem paths.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "paths", description: "Filesystem path routes." }))
