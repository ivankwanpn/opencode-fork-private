import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Provider } from "@opencode-ai/schema/provider"
import { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ProviderNotFoundError, ServiceUnavailableError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const ProviderGroup = HttpApiGroup.make("server.provider")
  .add(
    HttpApiEndpoint.get("provider.catalog", "/api/provider/catalog", {
      query: LocationQuery,
      success: Location.response(ProviderCatalog.Info),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.catalog",
          summary: "Get provider catalog",
          description: "Retrieve all providers and models together with current availability and defaults.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.list", "/api/provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Provider.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.list",
          summary: "List providers",
          description: "Retrieve active AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("provider.get", "/api/provider/:providerID", {
      params: { providerID: Provider.ID },
      query: LocationQuery,
      success: Location.response(Provider.Info),
      error: [ProviderNotFoundError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.get",
          summary: "Get provider",
          description: "Retrieve a single AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("provider.custom.discover", "/api/provider/custom/discover", {
      query: LocationQuery,
      payload: CustomProvider.DiscoverInput,
      success: Location.response(CustomProvider.DiscoverResult),
      error: [CustomProvider.ValidationError, CustomProvider.DiscoveryError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.custom.discover",
          summary: "Discover custom provider models",
          description: "Discover models exposed by a custom provider endpoint.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("provider.custom.configure", "/api/provider/custom/configure", {
      query: LocationQuery,
      payload: CustomProvider.ConfigureInput,
      success: Location.response(CustomProvider.ConfigureResult),
      error: [
        CustomProvider.ValidationError,
        CustomProvider.ConflictError,
        CustomProvider.ConfigureError,
        ServiceUnavailableError,
      ],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.custom.configure",
          summary: "Configure a custom provider",
          description: "Persist a custom provider and its selected models.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "providers",
      description: "Experimental provider routes.",
    }),
  )
