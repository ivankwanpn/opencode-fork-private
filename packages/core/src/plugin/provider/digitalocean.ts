import { createServer } from "node:http"
import type { IntegrationOAuthMethodRegistration } from "@opencode-ai/plugin/v2/effect/integration"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Deferred, Effect, Option, Schema, Semaphore, Stream } from "effect"
import type { Scope } from "effect"
import { Credential } from "../../credential"
import { EventV2 } from "../../event"
import { InstallationVersion } from "../../installation/version"
import { Integration } from "../../integration"
import { OauthCallbackPage } from "../../oauth/page"
import { ProviderV2 } from "../../provider"

const providerID = ProviderV2.ID.make("digitalocean")
const methodID = Integration.MethodID.make("digitalocean-browser")
const authorizeURL = "https://cloud.digitalocean.com/v1/oauth/authorize"
const routersURL = "https://api.digitalocean.com/v2/gen-ai/models/routers"
const inferenceURL = "https://inference.do-ai.run/v1"
const clientID = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82"
const callbackPort = 1456
const callbackPath = "/auth/callback"
const tokenPath = "/auth/token"
const scopes = "genai:read inference:query"
const refreshInterval = 5 * 60 * 1000

const Router = Schema.Struct({
  name: Schema.String,
  uuid: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
})
type Router = typeof Router.Type

const RouterResponse = Schema.Struct({
  model_routers: Schema.optional(Schema.Array(Router)),
})
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const decodeRouters = Schema.decodeUnknownOption(Schema.Array(Router))
const decodeCallback = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.String))

type RouterLoader = (bearer: string) => Effect.Effect<readonly Router[], unknown>

export function makeDigitalOceanPlugin(
  options: {
    readonly loadRouters?: RouterLoader
    readonly now?: () => number
  } = {},
) {
  const now = options.now ?? Date.now
  const loadRouters = options.loadRouters ?? listRouters

  return define<Integration.Service | EventV2.Service | Scope.Scope>({
    id: "digitalocean",
    effect: Effect.fn(function* (ctx) {
      const events = yield* EventV2.Service
      const integrations = yield* Integration.Service
      const loading = Semaphore.makeUnsafe(1)
      let routers: readonly Router[] = []

      const load = Effect.fn("DigitalOceanPlugin.load")(function* () {
        const connection = yield* integrations.connection.active(Integration.ID.make(providerID))
        const credential = connection
          ? yield* integrations.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined
        if (!credential) {
          routers = []
          return
        }

        const cached = routerCache(credential.metadata?.routers)
        const access = oauthAccess(credential, now())
        const fetchedAt = metadataNumber(credential.metadata?.routers_fetched_at)
        if (!access || now() - fetchedAt <= refreshInterval) {
          routers = cached
          return
        }

        routers = yield* loadRouters(access).pipe(Effect.catch(() => Effect.succeed(cached)))
      })

      yield* ctx.integration.transform((draft) => {
        draft.update(providerID, (integration) => {
          integration.name = "DigitalOcean"
        })
        draft.method.update(oauth(loadRouters, now))
        draft.method.update({
          integrationID: providerID,
          method: { type: "key", label: "Paste Model Access Key" },
        })
        draft.method.update({
          integrationID: providerID,
          method: { type: "env", names: ["DIGITALOCEAN_ACCESS_TOKEN"] },
        })
      })

      yield* load()
      yield* ctx.catalog.transform((catalog) => {
        const provider = catalog.provider.get(providerID)
        if (!provider) return
        catalog.provider.update(providerID, (draft) => {
          draft.integrationID = providerID
        })
        for (const router of routers) {
          const id = `router:${router.name}`
          catalog.model.update(providerID, id, (model) => {
            model.name = router.name
            model.family = "digitalocean-inference-routers"
            model.api = {
              id,
              type: "aisdk",
              package: "@ai-sdk/openai-compatible",
              url: inferenceURL,
            }
            model.status = "active"
            model.enabled = true
            model.capabilities = {
              tools: true,
              input: ["text"],
              output: ["text"],
              temperature: true,
              reasoning: false,
              attachment: false,
              interleaved: false,
            }
            model.cost = [{ input: 0, output: 0, cache: { read: 0, write: 0 } }]
            model.limit = { context: 128_000, output: 8_192 }
            model.variants = []
          })
        }
      })

      yield* ctx.aisdk.sdk(
        Effect.fn(function* (event) {
          if (event.model.providerID !== providerID) return
          if (event.options.apiKey !== undefined) return
          const connection = yield* integrations.connection.active(Integration.ID.make(providerID))
          if (!connection) return
          const credential = yield* integrations.connection
            .resolve(connection)
            .pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!credential) return
          event.options.apiKey = credential.type === "oauth" ? credential.access : credential.key
        }),
      )

      const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
      yield* events.subscribe(Integration.Event.ConnectionUpdated).pipe(
        Stream.filter((event) => event.data.integrationID === Integration.ID.make(providerID)),
        Stream.runForEach(refresh),
        Effect.forkScoped({ startImmediately: true }),
      )
    }),
  })
}

export const DigitalOceanPlugin = makeDigitalOceanPlugin()

function oauth(loadRouters: RouterLoader, now: () => number) {
  return {
    integrationID: Integration.ID.make(providerID),
    method: {
      id: methodID,
      type: "oauth",
      label: "Login with DigitalOcean",
    },
    authorize: () =>
      Effect.gen(function* () {
        const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("")
        const callback = yield* Deferred.make<{ access: string; expiresIn: number }, Error>()
        const redirect = `http://localhost:${callbackPort}${callbackPath}`
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? "/", `http://localhost:${callbackPort}`)
          if (request.method === "GET" && url.pathname === callbackPath) {
            response
              .writeHead(200, { "Content-Type": "text/html" })
              .end(OauthCallbackPage.bootstrap({ tokenPath, provider: "DigitalOcean" }))
            return
          }
          if (request.method !== "POST" || url.pathname !== tokenPath) {
            response.writeHead(404).end("Not found")
            return
          }

          const chunks: Buffer[] = []
          request.on("data", (chunk: Buffer) => chunks.push(chunk))
          request.on("end", () => {
            const decoded = Option.flatMap(decodeJson(Buffer.concat(chunks).toString("utf8")), decodeCallback)
            const body: Readonly<Record<string, string>> = Option.getOrElse(decoded, () => ({}))
            const error = body.error_description || body.error
            if (error) {
              Effect.runFork(Deferred.fail(callback, new Error(error)))
              response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
              return
            }
            if (!body.access_token) {
              Effect.runFork(Deferred.fail(callback, new Error("Missing access_token in callback")))
              response
                .writeHead(400, { "Content-Type": "application/json" })
                .end(JSON.stringify({ error: "missing_access_token" }))
              return
            }
            if (body.state !== state) {
              Effect.runFork(Deferred.fail(callback, new Error("Invalid state - potential CSRF attack")))
              response
                .writeHead(400, { "Content-Type": "application/json" })
                .end(JSON.stringify({ error: "invalid_state" }))
              return
            }
            const parsed = Number.parseInt(body.expires_in || "0", 10)
            Effect.runFork(
              Deferred.succeed(callback, {
                access: body.access_token,
                expiresIn: Number.isFinite(parsed) && parsed > 0 ? parsed : 60 * 60 * 24 * 30,
              }),
            )
            response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }))
          })
        })

        yield* Effect.callback<void, Error>((resume) => {
          server.once("error", (error) => resume(Effect.fail(error)))
          server.listen(callbackPort, "localhost", () => resume(Effect.void))
        })
        yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))

        return {
          mode: "auto" as const,
          url: `${authorizeURL}?${new URLSearchParams({
            response_type: "token",
            client_id: clientID,
            redirect_uri: redirect,
            scope: scopes,
            state,
          })}`,
          instructions:
            "Sign in to DigitalOcean in your browser. OpenCode will use your DigitalOcean API token directly for inference and load your Inference Routers.",
          callback: Deferred.await(callback).pipe(
            Effect.flatMap((token) =>
              loadRouters(token.access).pipe(
                Effect.catch(() => Effect.succeed([])),
                Effect.map((routers) => ({ token, routers })),
              ),
            ),
            Effect.map(({ token, routers }) => {
              const created = now()
              return Credential.OAuth.make({
                type: "oauth",
                methodID,
                access: token.access,
                refresh: "",
                expires: created + token.expiresIn * 1000,
                metadata: {
                  oauth_access: token.access,
                  oauth_expires: String(created + token.expiresIn * 1000),
                  oauth_scopes: scopes,
                  routers: JSON.stringify(routers),
                  routers_fetched_at: String(created),
                },
              })
            }),
          ),
        }
      }),
  } satisfies IntegrationOAuthMethodRegistration
}

function routerCache(value: unknown): readonly Router[] {
  const decoded = typeof value === "string" ? Option.flatMap(decodeJson(value), decodeRouters) : decodeRouters(value)
  return Option.getOrElse(decoded, () => [])
}

function metadataNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function oauthAccess(credential: Credential.Value, now: number) {
  if (credential.type === "oauth") return credential.expires > now ? credential.access : undefined
  const access = credential.metadata?.oauth_access
  if (typeof access !== "string") return
  return metadataNumber(credential.metadata?.oauth_expires) > now ? access : undefined
}

function listRouters(bearer: string): Effect.Effect<readonly Router[], Error> {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(routersURL, {
        headers: {
          Authorization: `Bearer ${bearer}`,
          Accept: "application/json",
          "User-Agent": `opencode/${InstallationVersion}`,
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      })
      if (!response.ok) throw new Error(`DigitalOcean router request failed: ${response.status}`)
      return Schema.decodeUnknownSync(RouterResponse)(await response.json()).model_routers ?? []
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}
