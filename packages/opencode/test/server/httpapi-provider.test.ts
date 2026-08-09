import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Context, Effect, Layer } from "effect"
import { HttpServer, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import Http from "node:http"
import path from "path"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { markPluginDependenciesReady } from "../fixture/plugin"
import { awaitWithTimeout, testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

const testStateLayer = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(testStateLayer, LayerNode.compile(FSUtil.node), httpApiLayer))
const projectOptions = { config: { formatter: false, lsp: false } }
const providerID = "test-oauth-parity"
const oauthURL = "https://example.com/oauth"
const oauthInstructions = "Finish OAuth"

function providerListHasFetch(list: unknown) {
  if (!Array.isArray(list)) return false
  return list.some((item: unknown) => {
    if (typeof item !== "object" || item === null || !("id" in item) || !("options" in item)) return false
    if (item.id !== "google") return false
    if (typeof item.options !== "object" || item.options === null) return false
    return "fetch" in item.options
  })
}

function hasProviderWithFetch(input: unknown, key: "all" | "providers") {
  if (typeof input !== "object" || input === null) return false
  if (key === "all") return "all" in input && providerListHasFetch(input.all)
  return "providers" in input && providerListHasFetch(input.providers)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function providerList(input: unknown, key: "all" | "providers") {
  if (!isRecord(input)) return []
  if (!Array.isArray(input[key])) return []
  return input[key]
}

function providerByID(input: unknown, key: "all" | "providers", id: string) {
  return providerList(input, key).find((provider) => isRecord(provider) && provider.id === id)
}

function hasNonZeroModelCost(input: unknown, key: "all" | "providers", id: string) {
  const provider = providerByID(input, key, id)
  if (!isRecord(provider) || !isRecord(provider.models)) return false
  return Object.values(provider.models).some((model) => {
    if (!isRecord(model) || !isRecord(model.cost) || !isRecord(model.cost.cache)) return false
    return [model.cost.input, model.cost.output, model.cost.cache.read, model.cost.cache.write].some(
      (cost) => typeof cost === "number" && cost > 0,
    )
  })
}

function hasProviderMutationMarker(input: unknown, key: "all" | "providers", id: string) {
  const provider = providerByID(input, key, id)
  if (!isRecord(provider)) return false
  if (provider.name === "mutated-provider") return true
  return isRecord(provider.options) && provider.options.mutatedByPlugin === true
}

function requestAuthorize(input: {
  providerID: string
  method: number
  headers: HeadersInit
  inputs?: Record<string, string>
}) {
  return Effect.gen(function* () {
    const response = yield* request(`/provider/${input.providerID}/oauth/authorize`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method, ...(input.inputs ? { inputs: input.inputs } : {}) }),
    })
    return {
      status: response.status,
      body: yield* response.text,
    }
  })
}

function requestCallback(input: { providerID: string; method: number; headers: HeadersInit; code?: string }) {
  return Effect.gen(function* () {
    const response = yield* request(`/provider/${input.providerID}/oauth/callback`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({ method: input.method, ...(input.code ? { code: input.code } : {}) }),
    })
    return {
      status: response.status,
      body: yield* response.text,
    }
  })
}

function writeProviderAuthPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-oauth-parity.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-parity",',
        "  server: async () => ({",
        "    auth: {",
        `      provider: "${providerID}",`,
        "      methods: [",
        '        { type: "api", label: "API key" },',
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeProviderAuthValidationPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-oauth-validation.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-validation",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "test-oauth-validation",',
        "      methods: [",
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          prompts: [",
        "            {",
        '              type: "text",',
        '              key: "token",',
        '              message: "Token",',
        "              validate: (value) => value === 'ok' ? undefined : 'Token must be ok',",
        "            },",
        "          ],",
        "          authorize: async () => ({",
        `            url: "${oauthURL}",`,
        '            method: "code",',
        `            instructions: "${oauthInstructions}",`,
        "            callback: async () => ({ type: 'success', key: 'token' }),",
        "          }),",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeFunctionOptionsPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-function-options.ts"),
      [
        "export default {",
        '  id: "test.provider-function-options",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "google",',
        "      loader: async (_getAuth, provider) => {",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return {",
        '        apiKey: "",',
        "        fetch: async (input, init) => fetch(input, init),",
        "        }",
        "      },",
        "      methods: [{ type: 'api', label: 'API key' }],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function writeProviderModelsMutationPlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => markPluginDependenciesReady(path.join(dir, ".opencode")))

    yield* fs.writeWithDirs(
      path.join(dir, ".opencode", "plugin", "provider-models-mutation.ts"),
      [
        "export default {",
        '  id: "test.provider-models-mutation",',
        "  server: async () => ({",
        "    provider: {",
        '      id: "google",',
        "      models: async (provider) => {",
        "        const models = Object.fromEntries(",
        "          Object.entries(provider.models ?? {}).map(([id, model]) => [id, { ...model }]),",
        "        )",
        '        provider.name = "mutated-provider"',
        "        provider.options = { ...provider.options, mutatedByPlugin: true }",
        "        for (const model of Object.values(provider.models ?? {})) {",
        "          model.cost = { input: 0, output: 0 }",
        "        }",
        "        return models",
        "      },",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function setEnvScoped(key: string, value: string) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env[key]
      process.env[key] = value
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[key]
        else process.env[key] = previous
      }),
  )
}

function listenProviderServer() {
  return Effect.gen(function* () {
    const context = yield* Layer.build(NodeHttpServer.layer(Http.createServer, { host: "127.0.0.1", port: 0 }))
    const server = Context.get(context, HttpServer.HttpServer)
    yield* server.serve(
      HttpServerRequest.HttpServerRequest.use((request) => {
        const pathname = new URL(request.url, "http://localhost").pathname
        if (pathname === "/v1/models") {
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe({
              data: [
                {
                  id: "gpt-5.4",
                  display_name: "GPT 5.4",
                  reasoning: true,
                  context_window: 200_000,
                  max_output: 32_000,
                },
              ],
            }),
          )
        }
        return Effect.succeed(
          HttpServerResponse.text("body-secret", {
            status: 500,
            headers: { "x-provider-secret": "response-secret" },
          }),
        )
      }),
    )
    return HttpServer.formatAddress(server.address)
  })
}

describe("provider HttpApi", () => {
  it.instance(
    "discovers and configures a custom provider with immediate runtime visibility and public errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const providerID = "http-custom-provider"
      const baseURL = yield* listenProviderServer()
      const previousConfig = Global.Path.config
      ;(Global.Path as { config: string }).config = path.join(directory, ".global")
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* request(`/auth/${providerID}`, {
            method: "DELETE",
            headers: { "x-opencode-directory": directory },
          }).pipe(Effect.ignore)
          yield* request("/global/dispose", { method: "POST" }).pipe(Effect.ignore)
          ;(Global.Path as { config: string }).config = previousConfig
        }),
      )

      const headers = {
        "content-type": "application/json",
        "x-opencode-directory": directory,
      }
      const discovered = yield* request("/api/provider/custom/discover", {
        method: "POST",
        headers,
        body: JSON.stringify({
          protocol: "openai-compatible",
          baseURL,
          apiKey: "test-key",
          headers: [],
        }),
      })

      expect(discovered.status).toBe(200)
      const discoveredBody = (yield* discovered.json) as { data: unknown }
      expect(discoveredBody.data).toEqual({
        endpoint: `${baseURL}/v1/models`,
        models: [
          {
            id: "gpt-5.4",
            name: "GPT 5.4",
            reasoning: true,
            context: 200_000,
            output: 32_000,
          },
        ],
      })

      const configured = yield* request("/api/provider/custom/configure", {
        method: "POST",
        headers,
        body: JSON.stringify({
          providerID,
          name: "HTTP Custom Provider",
          protocol: "openai-compatible",
          baseURL,
          apiKey: "test-key",
          headers: [{ name: "X-Tenant", value: "acme" }],
          models: [
            {
              id: "gpt-5.4",
              name: "GPT 5.4",
              reasoning: true,
              context: 200_000,
              output: 32_000,
            },
          ],
        }),
      })

      expect(configured.status).toBe(200)
      const configuredBody = (yield* configured.json) as { data: unknown }
      expect(configuredBody.data).toEqual({
        providerID,
        name: "HTTP Custom Provider",
        protocol: "openai-compatible",
        models: ["gpt-5.4"],
      })

      const catalogResponse = yield* request("/api/provider/catalog", { headers })
      const providerResponse = yield* request("/api/provider", { headers })
      const modelResponse = yield* request("/api/model", { headers })
      expect(catalogResponse.status).toBe(200)
      expect(providerResponse.status).toBe(200)
      expect(modelResponse.status).toBe(200)

      const catalogBody = (yield* catalogResponse.json) as {
        data: {
          providers: { info: { id: string }; source: string; auth?: "env" | "key" | "oauth"; env: string[] }[]
          models: { id: string; providerID: string }[]
          connected: string[]
          default: Record<string, string>
        }
      }
      const providerBody = (yield* providerResponse.json) as { data: { id: string }[] }
      const modelBody = (yield* modelResponse.json) as {
        data: {
          id: string
          providerID: string
          limit: { context: number; output: number }
          variants: { id: string }[]
        }[]
      }
      const providers = providerBody.data
      const models = modelBody.data as {
        id: string
        providerID: string
        limit: { context: number; output: number }
        variants: { id: string }[]
      }[]
      expect(providers.some((provider) => provider.id === providerID)).toBe(true)
      const catalogProvider = catalogBody.data.providers.find((provider) => provider.info.id === providerID)
      expect(catalogProvider).toBeDefined()
      expect(catalogProvider?.auth).toBe("key")
      expect(catalogBody.data.models.some((item) => item.providerID === providerID && item.id === "gpt-5.4")).toBe(true)
      expect(catalogBody.data.connected).toContain(providerID)
      expect(catalogBody.data.default[providerID]).toBe("gpt-5.4")
      const model = models.find((item) => item.providerID === providerID && item.id === "gpt-5.4")
      expect(model?.limit).toEqual({ context: 200_000, output: 32_000 })
      expect(model?.variants.map((variant) => variant.id)).toEqual(["none", "low", "medium", "high", "xhigh", "max"])

      const malformed = yield* request("/api/provider/custom/discover", {
        method: "POST",
        headers,
        body: JSON.stringify({
          protocol: "openai-compatible",
          baseURL: "not-a-url",
          apiKey: "malformed-secret",
          headers: [],
        }),
      })
      expect(malformed.status).toBe(400)
      expect(yield* malformed.json).toEqual({
        _tag: "CustomProviderValidationError",
        field: "baseURL",
        message: "Base URL must be a valid URL",
      })

      const conflict = yield* request("/api/provider/custom/configure", {
        method: "POST",
        headers,
        body: JSON.stringify({
          providerID,
          name: "Conflicting Provider",
          protocol: "openai-compatible",
          baseURL,
          headers: [],
          models: [{ id: "other-model", name: "Other Model" }],
        }),
      })
      expect(conflict.status).toBe(409)
      expect(yield* conflict.json).toEqual({
        _tag: "CustomProviderConflictError",
        providerID,
        message: `Provider "${providerID}" is already configured`,
      })

      const failed = yield* request("/api/provider/custom/discover", {
        method: "POST",
        headers,
        body: JSON.stringify({
          protocol: "openai-compatible",
          baseURL: `${baseURL}/failure?api_key=query-secret#fragment-secret`,
          apiKey: "request-key-secret",
          headers: [{ name: "X-Provider-Secret", value: "header-secret" }],
        }),
      })
      expect(failed.status).toBe(502)
      const failedBody = yield* failed.json
      expect(failedBody).toMatchObject({
        _tag: "CustomProviderDiscoveryError",
        endpoint: `${baseURL}/failure`,
        status: 500,
        kind: "status",
        message: "Model discovery endpoint returned an unsuccessful status",
      })
      for (const secret of [
        "query-secret",
        "fragment-secret",
        "request-key-secret",
        "header-secret",
        "response-secret",
        "body-secret",
      ]) {
        expect(JSON.stringify(failedBody)).not.toContain(secret)
      }

      const disconnected = yield* awaitWithTimeout(
        request(`/api/provider/custom/${providerID}`, {
          method: "DELETE",
          headers,
        }),
        "custom provider disconnect did not return",
      )
      expect(disconnected.status).toBe(200)
      expect(yield* disconnected.json).toMatchObject({ data: true })

      const afterDisconnect = yield* awaitWithTimeout(
        request("/api/provider/catalog", { headers }),
        "provider catalog did not refresh after disconnect",
      )
      expect(afterDisconnect.status).toBe(200)
      const afterDisconnectBody = (yield* afterDisconnect.json) as {
        data: { connected: string[]; providers: { info: { id: string } }[] }
      }
      expect(afterDisconnectBody.data.connected).not.toContain(providerID)
      expect(afterDisconnectBody.data.providers.some((item) => item.info.id === providerID)).toBe(true)
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "disconnects a standard provider by removing its persisted credentials",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "content-type": "application/json", "x-opencode-directory": directory }
      const connected = yield* request("/api/integration/openai/connect/key", {
        method: "POST",
        headers,
        body: JSON.stringify({ key: "expired-provider-key", label: "Expired" }),
      })
      expect(connected.status).toBe(204)

      const before = yield* request("/api/integration/openai", { headers })
      expect(before.status).toBe(200)
      expect(((yield* before.json) as { data: { connections: unknown[] } }).data.connections).toHaveLength(1)

      const response = yield* awaitWithTimeout(
        request("/api/provider/openai", {
          method: "DELETE",
          headers,
        }),
        "standard provider disconnect did not return",
      )

      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({ data: true })

      const after = yield* request("/api/integration/openai", { headers })
      expect(after.status).toBe(200)
      expect(((yield* after.json) as { data: { connections: unknown[] } }).data.connections).toHaveLength(0)
    }),
    projectOptions,
    30000,
  )

  it.instance.skip(
    "returns public v2 provider not found errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/api/provider/missing", {
        headers: { "x-opencode-directory": directory },
      })

      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({
        _tag: "ProviderNotFoundError",
        providerID: "missing",
        message: "Provider not found: missing",
      })
    }),
    projectOptions,
  )

  it.instance(
    "returns a sanitized discovery error for a catalog provider without a configured connection",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/api/provider/provider-without-discovery/models/discover", {
        method: "POST",
        headers: { "x-opencode-directory": directory },
      })

      expect(response.status).toBe(502)
      const body = yield* response.json
      expect(body).toMatchObject({
        _tag: "ProviderModelDiscoveryError",
        providerID: "provider-without-discovery",
        kind: "missing-credential",
      })
      expect(JSON.stringify(body)).not.toContain("token")
      expect(JSON.stringify(body)).not.toContain("endpoint")
      expect(JSON.stringify(body)).not.toContain("access")
    }),
    {
      config: {
        ...projectOptions.config,
        provider: {
          "provider-without-discovery": {
            name: "Provider without discovery connection",
            npm: "@ai-sdk/openai-compatible",
            api: "https://provider-without-discovery.example/v1",
            models: { configured: { name: "Configured" } },
          },
        },
      },
    },
  )

  it.instance(
    "returns 404 for discovery of an unknown provider",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* request("/api/provider/missing-provider/models/discover", {
        method: "POST",
        headers: { "x-opencode-directory": directory },
      })

      expect(response.status).toBe(404)
      expect(yield* response.text).not.toContain("token")
    }),
    projectOptions,
  )

  it.instance(
    "serves OAuth authorize response shapes",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const headers = { "x-opencode-directory": directory, "content-type": "application/json" }
      const api = yield* requestAuthorize({
        providerID,
        method: 0,
        headers,
      })
      // method 0 (api-key style) — authorize() resolves with no further
      // redirect; #26474 changed the wire format to JSON `null` so clients
      // can `.json()` parse uniformly instead of getting an empty body
      // that throws.
      expect(api).toEqual({ status: 200, body: "null" })

      const oauth = yield* requestAuthorize({
        providerID,
        method: 1,
        headers,
      })
      expect(JSON.parse(oauth.body)).toEqual({
        url: oauthURL,
        method: "code",
        instructions: oauthInstructions,
      })
    }),
    { ...projectOptions, init: writeProviderAuthPlugin },
    30000,
  )

  it.instance(
    "returns declared provider auth validation errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestAuthorize({
        providerID: "test-oauth-validation",
        method: 0,
        inputs: { token: "nope" },
        headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      })

      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toEqual({
        name: "ProviderAuthValidationFailed",
        data: { field: "token", message: "Token must be ok" },
      })
    }),
    { ...projectOptions, init: writeProviderAuthValidationPlugin },
    30000,
  )

  it.instance(
    "returns declared provider auth callback errors",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      const response = yield* requestCallback({
        providerID,
        method: 0,
        headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      })

      expect(response.status).toBe(400)
      expect(JSON.parse(response.body)).toEqual({
        name: "ProviderAuthOauthMissing",
        data: { providerID },
      })
    }),
    projectOptions,
    30000,
  )

  it.instance(
    "serves provider lists when auth loaders add runtime fetch options",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory
      yield* setEnvScoped(
        "OPENCODE_AUTH_CONTENT",
        JSON.stringify({
          google: { type: "oauth", refresh: "dummy", access: "dummy", expires: 9999999999999 },
        }),
      )
      const headers = { "x-opencode-directory": directory }
      const providerResponse = yield* request("/provider", { headers })
      const configResponse = yield* request("/config/providers", { headers })

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* providerResponse.json
      const configBody = yield* configResponse.json
      expect(hasProviderWithFetch(providerBody, "all")).toBe(false)
      expect(hasProviderWithFetch(configBody, "providers")).toBe(false)
      expect(hasNonZeroModelCost(providerBody, "all", "google")).toBe(true)
      expect(hasNonZeroModelCost(configBody, "providers", "google")).toBe(true)
    }),
    { ...projectOptions, init: writeFunctionOptionsPlugin },
  )

  it.instance(
    "keeps provider.models hook input mutations out of provider state",
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory

      const headers = { "x-opencode-directory": directory }
      const providerResponse = yield* request("/provider", { headers })
      const configResponse = yield* request("/config/providers", { headers })

      expect(providerResponse.status).toBe(200)
      expect(configResponse.status).toBe(200)

      const providerBody = yield* providerResponse.json
      const configBody = yield* configResponse.json
      expect(hasProviderMutationMarker(providerBody, "all", "google")).toBe(false)
      expect(hasProviderMutationMarker(configBody, "providers", "google")).toBe(false)
      expect(hasNonZeroModelCost(providerBody, "all", "google")).toBe(true)
    }),
    { ...projectOptions, init: writeProviderModelsMutationPlugin },
  )
})
