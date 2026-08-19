export * as AISDK from "./aisdk"

import { makeLocationNode } from "./effect/app-node"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Cause, Context, Effect, Layer, Schema, Scope } from "effect"
import { Catalog } from "./catalog"
import { EventV2 } from "./event"
import { Integration } from "./integration"
import { ModelV2 } from "./model"
import { ProviderV2 } from "./provider"
import { State } from "./state"

type SDK = any

export interface SDKEvent {
  readonly model: ModelV2.Info
  readonly package: string
  readonly options: Record<string, any>
  sdk?: SDK
}

export interface OptionsEvent {
  readonly model: ModelV2.Info
  readonly package: string
  readonly options: Record<string, any>
}

export interface LanguageEvent {
  readonly model: ModelV2.Info
  readonly sdk: SDK
  readonly options: Record<string, any>
  language?: LanguageModelV3
}

export class HeaderTimeoutError extends Error {
  public override readonly name = "ProviderHeaderTimeoutError"

  constructor(public readonly ms: number) {
    super(`Provider response headers timed out after ${ms}ms`)
  }
}

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

function expandEndpoint(value: string, options: Record<string, any>) {
  const variables: Record<string, unknown> = {
    ...process.env,
    AWS_REGION: options.region ?? process.env.AWS_REGION,
    AZURE_RESOURCE_NAME: options.resourceName ?? process.env.AZURE_RESOURCE_NAME,
  }
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
    const replacement = variables[key]
    return typeof replacement === "string" ? replacement : match
  })
}

function baseOptions(model: ModelV2.Info, credential?: { readonly key: string; readonly metadata?: Record<string, unknown> }) {
  const settings = model.api.type === "aisdk" ? (model.api.settings ?? {}) : {}
  const settingsHeaders =
    typeof settings.headers === "object" && settings.headers !== null ? settings.headers : {}
  const bodyHeaders =
    typeof model.request.body.headers === "object" && model.request.body.headers !== null
      ? model.request.body.headers
      : {}
  const options: Record<string, any> = {
    name: model.providerID,
    ...(credential?.metadata ?? {}),
    ...settings,
    ...model.request.body,
  }
  if (credential && options.apiKey === undefined) options.apiKey = credential.key
  if (
    Object.keys(settingsHeaders).length > 0 ||
    Object.keys(bodyHeaders).length > 0 ||
    Object.keys(model.request.headers).length > 0
  ) {
    options.headers = {
      ...settingsHeaders,
      ...bodyHeaders,
      ...model.request.headers,
    }
  }
  if (options.apiKey === undefined) {
    const entries = Object.entries(options.headers ?? {})
    const authorization = entries.find(([name]) => name.toLowerCase() === "authorization")?.[1]
    const bearer = typeof authorization === "string" ? /^Bearer\s+(.+)$/i.exec(authorization)?.[1] : undefined
    const key = entries.find(([name]) =>
      ["x-api-key", "api-key", "x-goog-api-key"].includes(name.toLowerCase()),
    )?.[1]
    if (bearer) options.apiKey = bearer
    else if (typeof key === "string" && key) options.apiKey = key
  }
  if (model.api.type === "aisdk" && model.api.url) options.baseURL = expandEndpoint(model.api.url, options)
  if (model.providerID === ProviderV2.ID.openai && options.headerTimeout === undefined) options.headerTimeout = 300_000
  return options
}

function prepareTransport(options: Record<string, any>, pkg: string) {
  const customFetch = options.fetch
  const chunkTimeout = options.chunkTimeout
  const headerTimeout = options.headerTimeout
  delete options.chunkTimeout
  delete options.headerTimeout
  options.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const opts = { ...(init ?? {}) }
    const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
    const headerTimeoutCtl =
      typeof headerTimeout === "number" && headerTimeout > 0 ? new AbortController() : undefined
    const headerTimeoutID = headerTimeoutCtl
      ? setTimeout(() => headerTimeoutCtl.abort(new HeaderTimeoutError(headerTimeout)), headerTimeout)
      : undefined
    const signals = [
      opts.signal,
      chunkAbortCtl?.signal,
      headerTimeoutCtl?.signal,
      options.timeout !== undefined && options.timeout !== null && options.timeout !== false
        ? AbortSignal.timeout(options.timeout)
        : undefined,
    ].filter((item): item is AbortSignal => Boolean(item))
    if (signals.length === 1) opts.signal = signals[0]
    if (signals.length > 1) opts.signal = AbortSignal.any(signals)

    if (
      (pkg === "@ai-sdk/openai" || pkg === "@ai-sdk/azure" || pkg === "@ai-sdk/amazon-bedrock/mantle") &&
      opts.body &&
      opts.method === "POST"
    ) {
      const body = JSON.parse(opts.body as string)
      if (body.store !== true && Array.isArray(body.input)) {
        for (const item of body.input) {
          if ("id" in item) delete item.id
        }
        opts.body = JSON.stringify(body)
      }
    }

    const res = await (typeof customFetch === "function" ? customFetch : fetch)(input, {
      ...opts,
      timeout: false,
    }).finally(() => {
      if (headerTimeoutID !== undefined) clearTimeout(headerTimeoutID)
    })
    if (!chunkAbortCtl || typeof chunkTimeout !== "number") return res
    return wrapSSE(res, chunkTimeout, chunkAbortCtl)
  }

  return options
}

export class InitError extends Schema.TaggedErrorClass<InitError>()("AISDK.InitError", {
  providerID: ProviderV2.ID,
  cause: Schema.Defect(),
}) {}

function initError(providerID: ProviderV2.ID) {
  return Effect.catchCause((cause) => Effect.fail(new InitError({ providerID, cause: Cause.squash(cause) })))
}

export interface Interface {
  readonly hook: {
    readonly options: (
      callback: (event: OptionsEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly sdk: (
      callback: (event: SDKEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly language: (
      callback: (event: LanguageEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
  }
  readonly runOptions: (event: OptionsEvent) => Effect.Effect<OptionsEvent>
  readonly runSDK: (event: SDKEvent) => Effect.Effect<SDKEvent>
  readonly runLanguage: (event: LanguageEvent) => Effect.Effect<LanguageEvent>
  readonly language: (model: ModelV2.Info) => Effect.Effect<LanguageModelV3, InitError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AISDK") {}

export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const events = yield* EventV2.Service
    const integrations = yield* Integration.Service
    let sdkHooks: ((event: SDKEvent) => Effect.Effect<void> | void)[] = []
    let optionsHooks: ((event: OptionsEvent) => Effect.Effect<void> | void)[] = []
    let languageHooks: ((event: LanguageEvent) => Effect.Effect<void> | void)[] = []
    const languages = new Map<string, LanguageModelV3>()
    const sdks = new Map<string, SDK>()
    const invalidate = Effect.sync(() => {
      languages.clear()
      sdks.clear()
    })

    const unsubscribe = yield* events.listen((event) =>
      event.type === Catalog.Event.Updated.type || event.type === Integration.Event.ConnectionUpdated.type
        ? invalidate
        : Effect.void,
    )
    yield* Effect.addFinalizer(() => unsubscribe)

    const register = <Event>(
      hooks: () => ((event: Event) => Effect.Effect<void> | void)[],
      update: (hooks: ((event: Event) => Effect.Effect<void> | void)[]) => void,
    ) =>
      Effect.fn("AISDK.hook")(function* (callback: (event: Event) => Effect.Effect<void> | void) {
        const scope = yield* Scope.Scope
        let active = true
        update([...hooks(), callback])
        yield* invalidate
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          update(hooks().filter((item) => item !== callback))
          languages.clear()
          sdks.clear()
        })
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      })

    const run = Effect.fnUntraced(function* <Event>(
      hooks: readonly ((event: Event) => Effect.Effect<void> | void)[],
      event: Event,
    ) {
      for (const hook of hooks) {
        const result = hook(event)
        if (Effect.isEffect(result)) yield* result
      }
      return event
    })

    const service = Service.of({
      hook: {
        options: register(
          () => optionsHooks,
          (next) => (optionsHooks = next),
        ),
        sdk: register(
          () => sdkHooks,
          (next) => (sdkHooks = next),
        ),
        language: register(
          () => languageHooks,
          (next) => (languageHooks = next),
        ),
      },
      runOptions: (event) => run(optionsHooks, event),
      runSDK: (event) => run(sdkHooks, event),
      runLanguage: (event) => run(languageHooks, event),
      language: Effect.fn("AISDK.language")(function* (model) {
        if (model.api.type !== "aisdk")
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error(`Unsupported api ${model.api.type}`),
          })

        const provider = yield* catalog.provider.get(model.providerID)
        const connection = yield* integrations.connection.active(
          provider?.integrationID ?? Integration.ID.make(model.providerID),
        )
        const credential = connection
          ? yield* integrations.connection.resolve(connection).pipe(initError(model.providerID))
          : undefined
        const keyCredential = credential?.type === "key" ? credential : undefined
        const prepared = baseOptions(model, keyCredential)
        const options = (
          yield* service
            .runOptions({ model, package: model.api.package, options: prepared })
            .pipe(initError(model.providerID))
        ).options
        const sdkKey = JSON.stringify({
          providerID: model.providerID,
          api: model.api,
          options,
        })
        const key = `${sdkKey}/${model.api.id}/${model.request.variant ?? "default"}`
        const existing = languages.get(key)
        if (existing) return existing
        prepareTransport(options, model.api.package)
        const sdk =
          sdks.get(sdkKey) ??
          (yield* service.runSDK({ model, package: model.api.package, options }).pipe(initError(model.providerID))).sdk
        if (!sdk)
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error("No AISDK provider plugin returned an SDK"),
          })
        sdks.set(sdkKey, sdk)
        const result = yield* service.runLanguage({ model, sdk, options }).pipe(initError(model.providerID))
        const language = yield* Effect.sync(() => result.language ?? sdk.languageModel(model.api.id)).pipe(
          initError(model.providerID),
        )
        languages.set(key, language)
        return language
      }),
    })
    return service
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [Catalog.node, EventV2.node, Integration.node],
})
