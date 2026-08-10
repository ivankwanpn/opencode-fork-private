import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { ServiceUnavailableError } from "../errors"

export const ConfigGroup = HttpApiGroup.make("server.config")
  .add(
    HttpApiEndpoint.get("config.get", "/api/config", {
      query: LocationQuery,
      // Transitional host payload: V1 plugin consumers still require the full
      // resolved legacy config shape while native Core config remains narrower.
      success: Location.response(Schema.Json),
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.patch("config.update", "/api/config", {
      payload: Schema.Struct({ config: Schema.Json }),
      success: Location.response(Schema.Json),
      error: ServiceUnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.config.update",
        summary: "Update configuration",
        description: "Merge configuration changes into the host's global configuration.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "config", description: "Host configuration compatibility route." }))
