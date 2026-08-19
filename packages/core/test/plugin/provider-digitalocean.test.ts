import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import {
  DigitalOceanPlugin,
  makeDigitalOceanPlugin,
} from "@opencode-ai/core/plugin/provider/digitalocean"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const providerID = ProviderV2.ID.make("digitalocean")
const now = 1_000_000

const addPlugin = Effect.fn(function* (item: ReturnType<typeof makeDigitalOceanPlugin> = DigitalOceanPlugin) {
  const plugin = yield* PluginV2.Service
  const host = yield* PluginHost.make(plugin)
  const events = yield* EventV2.Service
  const integrations = yield* Integration.Service
  yield* item.effect(host).pipe(
    Effect.provideService(EventV2.Service, events),
    Effect.provideService(Integration.Service, integrations),
  )
})

const seedProvider = Effect.fn(function* () {
  const catalog = yield* Catalog.Service
  yield* catalog.transform((draft) => {
    draft.provider.update(providerID, (provider) => {
      provider.name = "DigitalOcean"
      provider.api = {
        type: "aisdk",
        package: "@ai-sdk/openai-compatible",
        url: "https://inference.do-ai.run/v1",
      }
    })
    draft.model.update(providerID, ModelV2.ID.make("base-model"), (model) => {
      model.name = "Base Model"
      model.enabled = true
    })
  })
})

function metadata(input: {
  routers: readonly { readonly name: string; readonly uuid?: string; readonly description?: string }[]
  fetchedAt: number
  access?: string
  expires?: number
}) {
  return {
    routers: JSON.stringify(input.routers),
    routers_fetched_at: String(input.fetchedAt),
    ...(input.access === undefined ? {} : { oauth_access: input.access }),
    ...(input.expires === undefined ? {} : { oauth_expires: String(input.expires) }),
  }
}

function withEnv<A, E, R>(name: string, value: string | undefined, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[name]
        else process.env[name] = previous
      }),
  )
}

describe("DigitalOceanPlugin", () => {
  it.effect("registers OAuth, key, and environment connection methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make(providerID)))?.methods).toEqual([
        {
          id: Integration.MethodID.make("digitalocean-browser"),
          type: "oauth",
          label: "Login with DigitalOcean",
        },
        { type: "key", label: "Paste Model Access Key" },
        { type: "env", names: ["DIGITALOCEAN_ACCESS_TOKEN"] },
      ])
    }),
  )

  it.effect("projects cached routers without replacing the base model catalog", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      yield* seedProvider()
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.Key.make({
          type: "key",
          key: "inference-key",
          metadata: metadata({
            routers: [{ name: "team-router", uuid: "router-1", description: "Team router" }],
            fetchedAt: now,
            access: "oauth-access",
            expires: now + 60_000,
          }),
        }),
      })
      yield* addPlugin(
        makeDigitalOceanPlugin({
          now: () => now,
          loadRouters: () => Effect.die("fresh router request not expected"),
        }),
      )

      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("base-model"))).toBeDefined()
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("router:team-router"))).toMatchObject({
        id: "router:team-router",
        providerID: "digitalocean",
        name: "team-router",
        family: "digitalocean-inference-routers",
        api: {
          id: "router:team-router",
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://inference.do-ai.run/v1",
        },
        capabilities: {
          tools: true,
          input: ["text"],
          output: ["text"],
          temperature: true,
          reasoning: false,
          attachment: false,
          interleaved: false,
        },
        cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
        limit: { context: 128_000, output: 8_192 },
        enabled: true,
      })
      expect((yield* catalog.provider.get(providerID))?.integrationID).toBe(Integration.ID.make(providerID))
    }),
  )

  it.effect("refreshes stale router metadata with the OAuth bearer", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      const seen: string[] = []
      yield* seedProvider()
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.Key.make({
          type: "key",
          key: "inference-key",
          metadata: metadata({
            routers: [{ name: "stale-router" }],
            fetchedAt: 0,
            access: "oauth-access",
            expires: now + 60_000,
          }),
        }),
      })
      yield* addPlugin(
        makeDigitalOceanPlugin({
          now: () => now,
          loadRouters: (bearer) => {
            seen.push(bearer)
            return Effect.succeed([{ name: "fresh-router", uuid: "router-2" }])
          },
        }),
      )

      expect(seen).toEqual(["oauth-access"])
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("router:fresh-router"))).toBeDefined()
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("router:stale-router"))).toBeUndefined()
    }),
  )

  it.effect("keeps cached routers when the OAuth bearer is expired", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const catalog = yield* Catalog.Service
      let requests = 0
      yield* seedProvider()
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.Key.make({
          type: "key",
          key: "inference-key",
          metadata: metadata({
            routers: [{ name: "cached-router" }],
            fetchedAt: 0,
            access: "expired-access",
            expires: now - 1,
          }),
        }),
      })
      yield* addPlugin(
        makeDigitalOceanPlugin({
          now: () => now,
          loadRouters: () => {
            requests++
            return Effect.succeed([])
          },
        }),
      )

      expect(requests).toBe(0)
      expect(yield* catalog.model.get(providerID, ModelV2.ID.make("router:cached-router"))).toBeDefined()
    }),
  )

  it.effect("injects key credentials into runtime options without overriding configuration", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const aisdk = yield* AISDK.Service
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.Key.make({ type: "key", key: "stored-key" }),
      })
      yield* addPlugin(makeDigitalOceanPlugin({ now: () => now }))
      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(providerID, ModelV2.ID.make("model")),
        api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
      })

      expect((yield* aisdk.runSDK({ model, package: "test-provider", options: {} })).options.apiKey).toBe("stored-key")
      expect(
        (yield* aisdk.runSDK({ model, package: "test-provider", options: { apiKey: "configured-key" } })).options
          .apiKey,
      ).toBe("configured-key")
    }),
  )

  it.effect("injects OAuth access and environment credentials into runtime options", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const aisdk = yield* AISDK.Service
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("digitalocean-browser"),
          access: "oauth-runtime-access",
          refresh: "",
          expires: now + 60_000,
          metadata: metadata({ routers: [], fetchedAt: now }),
        }),
      })
      yield* addPlugin(makeDigitalOceanPlugin({ now: () => now }))
      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(providerID, ModelV2.ID.make("model")),
        api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
      })
      expect((yield* aisdk.runSDK({ model, package: "test-provider", options: {} })).options.apiKey).toBe(
        "oauth-runtime-access",
      )

      yield* credentials.remove((yield* credentials.list(Integration.ID.make(providerID)))[0].id)
      yield* withEnv(
        "DIGITALOCEAN_ACCESS_TOKEN",
        "environment-access",
        Effect.gen(function* () {
          expect((yield* aisdk.runSDK({ model, package: "test-provider", options: {} })).options.apiKey).toBe(
            "environment-access",
          )
        }),
      )
    }),
  )
})
