import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import type { Location } from "@opencode-ai/schema/location"
import type { ProviderCatalog } from "@opencode-ai/schema/provider-catalog"

type CustomProviderLocation = {
  readonly directory?: string
  readonly workspace?: string
}

type CustomProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface CustomProviderApi {
  readonly catalog: (input?: {
    location?: CustomProviderLocation
  }) => Promise<{ location: Location.Info; data: ProviderCatalog.Info }>
  readonly discoverCustom: (
    input: CustomProvider.DiscoverInput & { location?: CustomProviderLocation },
  ) => Promise<{ location: Location.Info; data: CustomProvider.DiscoverResult }>
  readonly configureCustom: (
    input: CustomProvider.ConfigureInput & { location?: CustomProviderLocation },
  ) => Promise<{ location: Location.Info; data: CustomProvider.ConfigureResult }>
}

export function createCustomProviderApi(options: {
  readonly baseUrl: string
  readonly fetch?: CustomProviderFetch
  readonly headers?: HeadersInit
}): CustomProviderApi {
  const request = async <T>(
    method: "GET" | "POST",
    path: string,
    location: CustomProviderLocation | undefined,
    payload?: unknown,
  ) => {
    const url = new URL(path, options.baseUrl)
    const query = new URLSearchParams()
    if (location?.directory !== undefined) query.set("location[directory]", location.directory)
    if (location?.workspace !== undefined) query.set("location[workspace]", location.workspace)
    url.search = query.toString()

    const headers = new Headers(options.headers)
    if (payload !== undefined) headers.set("content-type", "application/json")

    const response = await (options.fetch ?? globalThis.fetch)(url, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }).catch(() => {
      throw new Error(`Provider request failed: ${method} ${path}`)
    })

    const value: unknown = await response.json().catch(() => {
      throw new Error(
        `Provider response was not valid JSON: ${method} ${path} (${response.status}, ${response.headers.get("content-type") ?? "no content type"})`,
      )
    })
    if (!response.ok) {
      throw new Error(`Provider request failed: ${method} ${path} (${response.status})`, {
        cause: { status: response.status, body: value },
      })
    }
    return value as T
  }

  return {
    catalog: (input) => request("GET", "/api/provider/catalog", input?.location),
    discoverCustom: (input) =>
      request("POST", "/api/provider/custom/discover", input.location, {
        baseURL: input.baseURL,
        apiKey: input.apiKey,
        headers: input.headers,
      }),
    configureCustom: (input) =>
      request("POST", "/api/provider/custom/configure", input.location, {
        providerID: input.providerID,
        name: input.name,
        update: input.update,
        baseURL: input.baseURL,
        apiKey: input.apiKey,
        headers: input.headers,
        models: input.models,
      }),
  }
}
