import { Lsp } from "@opencode-ai/schema/lsp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Location } from "@opencode-ai/schema/location"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const LspGroup = HttpApiGroup.make("server.lsp")
  .add(
    HttpApiEndpoint.get("lsp.status", "/api/lsp", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Lsp.Status)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.lsp.status",
          summary: "Get LSP status",
          description: "Retrieve the language server connections for a location.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "lsp", description: "Language server status routes." }))
