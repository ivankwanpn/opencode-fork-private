import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { Integration } from "@opencode-ai/core/integration"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

const providerID = ProviderV2.ID.make("runtime-provider")
const integrationID = Integration.ID.make("runtime-credential")

type CapturedLanguage = {
  readonly generation: number
  readonly modelID: string
  readonly options: Record<string, unknown>
}

function model(input: {
  readonly id?: string
  readonly package?: string
  readonly url?: string
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
  readonly settings?: Record<string, unknown>
}) {
  const id = ModelV2.ID.make(input.id ?? "test-model")
  return ModelV2.Info.make({
    ...ModelV2.Info.empty(providerID, id),
    api: {
      type: "aisdk",
      id,
      package: input.package ?? "test-provider",
      url: input.url,
      settings: input.settings ?? {},
    },
    request: {
      headers: input.headers ?? {},
      body: input.body ?? {},
    },
  })
}

function captured(value: LanguageModelV3) {
  return value as unknown as CapturedLanguage
}

function installSDK(aisdk: AISDK.Interface, create: (options: Record<string, unknown>) => CapturedLanguage) {
  return aisdk.hook.sdk((event) => {
    event.sdk = {
      languageModel(modelID: string) {
        return { ...create(event.options), modelID } as unknown as LanguageModelV3
      },
    }
  })
}

function waitForGeneration(
  aisdk: AISDK.Interface,
  input: ModelV2.Info,
  generation: number,
  attempts = 100,
): Effect.Effect<LanguageModelV3, AISDK.InitError> {
  return Effect.gen(function* () {
    yield* Effect.yieldNow
    const language = yield* aisdk.language(input)
    if (captured(language).generation === generation) return language
    if (attempts === 0) return yield* Effect.die(`AISDK cache did not advance to generation ${generation}`)
    return yield* waitForGeneration(aisdk, input, generation, attempts - 1)
  })
}

describe("AISDK runtime options", () => {
  it.effect("resolves key credentials before options hooks and SDK factories", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      const order: string[] = []
      const runtimeFetch = async () => new Response("ok")
      const previous = process.env.AISDK_TEST_HOST
      process.env.AISDK_TEST_HOST = "api.example.test"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (previous === undefined) delete process.env.AISDK_TEST_HOST
          else process.env.AISDK_TEST_HOST = previous
        }),
      )

      yield* catalog.transform((draft) => {
        draft.provider.update(providerID, (provider) => {
          provider.integrationID = integrationID
        })
      })
      yield* credentials.create({
        integrationID,
        value: Credential.Key.make({
          type: "key",
          key: "stored-key",
          metadata: { accountId: "metadata-account", shared: "metadata" },
        }),
      })
      yield* aisdk.hook.options((event) => {
        order.push("options")
        expect(event.options).toMatchObject({
          accountId: "metadata-account",
          apiKey: "explicit-key",
          baseURL: "https://api.example.test/eu-west-1/v1",
          shared: "explicit",
        })
        event.options.fetch = runtimeFetch
      })
      yield* aisdk.hook.sdk((event) => {
        order.push("sdk")
        expect(event.options.fetch).not.toBe(runtimeFetch)
        expect(event.options).not.toHaveProperty("headerTimeout")
        expect(event.options.headers).toEqual({ setting: "setting", body: "body", shared: "model", model: "model" })
        event.sdk = {
          languageModel(modelID: string) {
            return { generation: 1, modelID, options: event.options } as unknown as LanguageModelV3
          },
        }
      })

      const language = yield* aisdk.language(
        model({
          url: "https://${AISDK_TEST_HOST}/${AWS_REGION}/v1",
          settings: { headers: { setting: "setting", shared: "setting" } },
          headers: { model: "model", shared: "model" },
          body: {
            apiKey: "explicit-key",
            headers: { body: "body", shared: "body" },
            region: "eu-west-1",
            shared: "explicit",
          },
        }),
      )

      expect(order).toEqual(["options", "sdk"])
      expect(captured(language).options.apiKey).toBe("explicit-key")
    }),
  )

  it.effect("injects the active key when explicit provider options omit apiKey", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make(providerID),
        value: Credential.Key.make({ type: "key", key: "stored-key" }),
      })
      yield* installSDK(aisdk, (options) => ({ generation: 1, modelID: "", options }))

      expect(captured(yield* aisdk.language(model({ id: "credential-model" }))).options.apiKey).toBe("stored-key")
    }),
  )

  it.effect("lowers configured credential headers into SDK apiKey options without removing headers", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* installSDK(aisdk, (options) => ({ generation: 1, modelID: "", options }))

      const bearer = captured(
        yield* aisdk.language(
          model({ id: "bearer-model", headers: { aUtHoRiZaTiOn: "Bearer configured-bearer", keep: "value" } }),
        ),
      ).options
      expect(bearer.apiKey).toBe("configured-bearer")
      expect(bearer.headers).toEqual({ aUtHoRiZaTiOn: "Bearer configured-bearer", keep: "value" })

      const apiKey = captured(
        yield* aisdk.language(model({ id: "header-key-model", headers: { "X-API-KEY": "configured-key" } })),
      ).options
      expect(apiKey.apiKey).toBe("configured-key")
      expect(apiKey.headers).toEqual({ "X-API-KEY": "configured-key" })

      const explicit = captured(
        yield* aisdk.language(
          model({ id: "explicit-model", headers: { "x-goog-api-key": "header-key" }, body: { apiKey: "explicit" } }),
        ),
      ).options
      expect(explicit.apiKey).toBe("explicit")
    }),
  )

  it.live("aborts stalled response headers without turning header timeout into a body timeout", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      let transport: typeof fetch | undefined
      yield* aisdk.hook.options((event) => {
        event.options.fetch = (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
          })
      })
      yield* aisdk.hook.sdk((event) => {
        transport = event.options.fetch
        event.sdk = {
          languageModel(modelID: string) {
            return { generation: 1, modelID, options: event.options } as unknown as LanguageModelV3
          },
        }
      })
      yield* aisdk.language(model({ id: "timeout-model", body: { headerTimeout: 10 } }))
      if (!transport) return yield* Effect.die("AISDK SDK hook did not receive a transport")

      const error = yield* Effect.promise(() => transport!("https://provider.example").catch((cause) => cause))
      expect(error).toBeInstanceOf(AISDK.HeaderTimeoutError)
      expect(String(error)).toContain("response headers timed out after 10ms")
    }),
  )

  it.effect("invalidates language and SDK caches after catalog and connection updates", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const events = yield* EventV2.Service
      let generation = 0
      yield* installSDK(aisdk, (options) => ({ generation: ++generation, modelID: "", options }))
      const input = model({ id: "cached-model" })

      expect(captured(yield* aisdk.language(input)).generation).toBe(1)
      expect(captured(yield* aisdk.language(input)).generation).toBe(1)
      yield* Effect.yieldNow
      yield* events.publish(Catalog.Event.Updated, {})
      expect(captured(yield* waitForGeneration(aisdk, input, 2)).generation).toBe(2)
      yield* events.publish(Integration.Event.ConnectionUpdated, { integrationID })
      expect(captured(yield* waitForGeneration(aisdk, input, 3)).generation).toBe(3)
    }),
  )
})
