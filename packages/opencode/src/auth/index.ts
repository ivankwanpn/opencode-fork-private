import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Credential } from "@opencode-ai/core/credential"
import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

export const Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export type Info = Schema.Schema.Type<typeof Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* FSUtil.Service
    const credentials = yield* Credential.Service
    const decode = Schema.decodeUnknownOption(Info)

    const read = Effect.fn("Auth.read")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          const data = JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, unknown>
          return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const all = Effect.fn("Auth.all")(function* () {
      const legacy = yield* read()
      if (process.env.OPENCODE_AUTH_CONTENT) return legacy
      const saved = yield* credentials.all()
      return {
        ...legacy,
        ...Object.fromEntries(saved.map((item) => [item.integrationID, projectCredential(item.value)])),
      }
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const saved = (yield* credentials.all()).find((item) => item.integrationID === norm)
      if (saved) {
        const value = updateCredential(saved.value, info)
        if (value) {
          yield* credentials.update(saved.id, { value })
          return
        }
      }
      const data = yield* read()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* fsys
        .writeJson(file, { ...data, [norm]: info }, 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* read()
      delete data[key]
      delete data[norm]
      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      yield* Effect.forEach(
        (yield* credentials.all()).filter((item) => item.integrationID === norm),
        (item) => credentials.remove(item.id),
        { discard: true },
      )
    })

    return Service.of({ get, all, set, remove })
  }),
)

function projectCredential(value: Credential.Value): Info {
  if (value.type === "oauth") {
    const accountId = [value.metadata?.accountID, value.metadata?.accountId].find(
      (item): item is string => typeof item === "string",
    )
    return new Oauth({
      type: "oauth",
      refresh: value.refresh,
      access: value.access,
      expires: value.expires,
      ...(accountId ? { accountId } : {}),
    })
  }

  const metadata = Object.fromEntries(
    Object.entries(value.metadata ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
  return new Api({
    type: "api",
    key: value.key,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  })
}

function updateCredential(current: Credential.Value, info: Info) {
  if (info.type === "api") {
    return Credential.Key.make({
      type: "key",
      key: info.key,
      ...(info.metadata ? { metadata: info.metadata } : {}),
    })
  }
  if (info.type === "wellknown") return
  if (current.type !== "oauth") return
  const metadata = {
    ...current.metadata,
    ...(info.accountId ? { accountID: info.accountId } : {}),
  }
  return Credential.OAuth.make({
    type: "oauth",
    methodID: current.methodID,
    refresh: info.refresh,
    access: info.access,
    expires: info.expires,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  })
}

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node, Credential.node] })

export * as Auth from "."
