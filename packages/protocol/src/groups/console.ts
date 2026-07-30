import { Console } from "@opencode-ai/schema/console"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const ConsoleGroup = HttpApiGroup.make("server.console")
  .add(
    HttpApiEndpoint.get("console.get", "/api/console", {
      query: LocationQuery,
      success: Location.response(Console.State),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("console.org.list", "/api/console/org", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Console.Org)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("console.org.switch", "/api/console/org", {
      query: LocationQuery,
      payload: Schema.Struct({ accountID: Schema.String, orgID: Schema.String }),
      success: Location.response(Schema.Boolean),
    }).annotateMerge(locationQueryOpenApi),
  )
  .annotateMerge(OpenApi.annotations({ title: "console", description: "Host Console account routes." }))
