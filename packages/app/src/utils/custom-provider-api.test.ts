import { describe, expect, test } from "bun:test"
import { createCustomProviderApi } from "./custom-provider-api"

const location = {
  directory: "/project",
  project: { id: "project", directory: "/project" },
}

describe("createCustomProviderApi", () => {
  test("gets the v2 catalog with deep location query and preserved authorization", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    const api = createCustomProviderApi({
      baseUrl: "https://server.example/base/",
      headers: { Authorization: "Bearer base-secret", "X-Client": "desktop" },
      fetch: async (input, init) => {
        calls.push({ url: new URL(input.toString()), init })
        return Response.json({
          location,
          data: { providers: [], models: [], connected: [], default: {} },
        })
      },
    })

    await api.catalog({ location: { directory: "/project folder", workspace: "workspace-1" } })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe("/api/provider/catalog")
    expect(calls[0]?.url.searchParams.toString()).toBe(
      "location%5Bdirectory%5D=%2Fproject+folder&location%5Bworkspace%5D=workspace-1",
    )
    expect(calls[0]?.init?.method).toBe("GET")
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer base-secret")
    expect(new Headers(calls[0]?.init?.headers).get("x-client")).toBe("desktop")
    expect(new Headers(calls[0]?.init?.headers).has("content-type")).toBe(false)
    expect(calls[0]?.init?.body).toBeUndefined()
  })

  test("posts discovery to the exact path with deep location query and preserved authorization", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    const api = createCustomProviderApi({
      baseUrl: "https://server.example/base/",
      headers: { Authorization: "Bearer base-secret", "X-Client": "desktop" },
      fetch: async (input, init) => {
        calls.push({ url: new URL(input.toString()), init })
        return Response.json({ location, data: { endpoint: "https://provider.example/v1", models: [] } })
      },
    })

    await api.discoverCustom({
      protocol: "openai-compatible",
      baseURL: "https://provider.example/v1",
      apiKey: "provider-secret",
      headers: [],
      location: { directory: "/project folder", workspace: "workspace-1" },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.pathname).toBe("/api/provider/custom/discover")
    expect(calls[0]?.url.searchParams.toString()).toBe(
      "location%5Bdirectory%5D=%2Fproject+folder&location%5Bworkspace%5D=workspace-1",
    )
    expect(calls[0]?.init?.method).toBe("POST")
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer base-secret")
    expect(new Headers(calls[0]?.init?.headers).get("x-client")).toBe("desktop")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      baseURL: "https://provider.example/v1",
      apiKey: "provider-secret",
      headers: [],
    })
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty("location")
  })

  test("posts configuration to the exact path without location in the payload", async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    const api = createCustomProviderApi({
      baseUrl: "https://server.example",
      fetch: async (input, init) => {
        calls.push({ url: new URL(input.toString()), init })
        return Response.json({
          location,
          data: {
            providerID: "custom",
            name: "Custom",
            protocol: "anthropic-messages",
            models: ["model-1"],
          },
        })
      },
    })

    await api.configureCustom({
      providerID: "custom",
      name: "Custom",
      protocol: "anthropic-messages",
      baseURL: "https://provider.example",
      headers: [{ name: "X-Tenant", value: "tenant" }],
      models: [{ id: "model-1", name: "Model 1" }],
      location: { directory: "/project" },
    })

    expect(calls[0]?.url.pathname).toBe("/api/provider/custom/configure")
    expect(calls[0]?.url.searchParams.toString()).toBe("location%5Bdirectory%5D=%2Fproject")
    expect(calls[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      providerID: "custom",
      name: "Custom",
      baseURL: "https://provider.example",
      headers: [{ name: "X-Tenant", value: "tenant" }],
      models: [{ id: "model-1", name: "Model 1" }],
    })
  })

  test("preserves typed JSON errors with their response status", async () => {
    const error = {
      _tag: "CustomProviderValidationError",
      field: "baseURL",
      message: "Invalid base URL",
    }
    const api = createCustomProviderApi({
      baseUrl: "https://server.example",
      fetch: async () => Response.json(error, { status: 400 }),
    })

    const result = await api
      .discoverCustom({
        protocol: "openai-compatible",
        baseURL: "invalid",
        headers: [],
      })
      .then(
        () => undefined,
        (cause) => cause,
      )

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).cause).toEqual({ status: 400, body: error })
  })

  test("reports transport failures without leaking request payloads or secrets", async () => {
    const api = createCustomProviderApi({
      baseUrl: "https://server.example",
      headers: { Authorization: "Bearer base-secret" },
      fetch: async () => {
        throw new Error("network failed with base-secret")
      },
    })

    const result = api.discoverCustom({
      protocol: "openai-compatible",
      baseURL: "https://provider.example",
      apiKey: "provider-secret",
      headers: [],
    })
    await expect(result).rejects.toBeInstanceOf(Error)
    await expect(result).rejects.not.toThrow("base-secret")
    await expect(result).rejects.not.toThrow("provider-secret")
    await expect(result).rejects.not.toThrow("provider.example")
  })
})
