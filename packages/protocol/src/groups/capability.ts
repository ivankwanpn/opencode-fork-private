import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const CapabilityGroup = HttpApiGroup.make("server.capability")
  .add(
    HttpApiEndpoint.get("capability.get", "/api/capability", {
      success: Schema.Struct({ backgroundSubagents: Schema.Boolean }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.capability.get",
        summary: "Get server capabilities",
        description: "Retrieve optional runtime capabilities available to clients.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "capabilities", description: "Runtime capability discovery." }))
