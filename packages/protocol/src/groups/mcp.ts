import { Mcp } from "@opencode-ai/schema/mcp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, McpNotFoundError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { Location } from "@opencode-ai/schema/location"

export const McpGroup = HttpApiGroup.make("server.mcp")
  .add(
    HttpApiEndpoint.get("mcp.status", "/api/mcp", {
      query: LocationQuery,
      success: Location.response(Schema.Record(Schema.String, Mcp.Status)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("mcp.resources", "/api/mcp/resource", {
      query: LocationQuery,
      success: Location.response(Schema.Record(Schema.String, Mcp.Resource)),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("mcp.connect", "/api/mcp/:name/connect", {
      params: { name: Schema.String },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: McpNotFoundError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("mcp.disconnect", "/api/mcp/:name/disconnect", {
      params: { name: Schema.String },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: McpNotFoundError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("mcp.authenticate", "/api/mcp/:name/authenticate", {
      params: { name: Schema.String },
      query: LocationQuery,
      success: Location.response(Mcp.Status),
      error: [McpNotFoundError, InvalidRequestError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.mcp.authenticate",
          summary: "Authenticate an MCP server",
          description: "Start the MCP OAuth flow and wait for the authorization callback.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "mcp", description: "Location-scoped Model Context Protocol runtime routes." }),
  )
