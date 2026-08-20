import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

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

export function normalizeIntegrationID(value: string) {
  return Integration.ID.make(value.replace(/\/+$/, ""))
}

export function fromCredential(value: Credential.StoredValue): Info {
  if (value.type === "wellknown") return new WellKnown(value)
  if (value.type === "oauth") {
    const accountId = [value.metadata?.accountID, value.metadata?.accountId].find(
      (item): item is string => typeof item === "string",
    )
    const enterpriseUrl =
      typeof value.metadata?.enterpriseUrl === "string" ? value.metadata.enterpriseUrl : undefined
    return new Oauth({
      type: "oauth",
      refresh: value.refresh,
      access: value.access,
      expires: value.expires,
      ...(accountId ? { accountId } : {}),
      ...(enterpriseUrl ? { enterpriseUrl } : {}),
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

export function toCredential(
  info: Info,
  current?: Credential.StoredValue,
  methodID = Integration.MethodID.make("legacy"),
): Credential.StoredValue {
  if (info.type === "api") {
    return Credential.Key.make({
      type: "key",
      key: info.key,
      ...(info.metadata ? { metadata: info.metadata } : {}),
    })
  }
  if (info.type === "wellknown") return Credential.WellKnown.make(info)
  const metadata = {
    ...(current?.type === "oauth" ? current.metadata : {}),
    ...(info.accountId ? { accountID: info.accountId } : {}),
    ...(info.enterpriseUrl ? { enterpriseUrl: info.enterpriseUrl } : {}),
  }
  return Credential.OAuth.make({
    type: "oauth",
    methodID: current?.type === "oauth" ? current.methodID : methodID,
    refresh: info.refresh,
    access: info.access,
    expires: info.expires,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  })
}

export function project(credentials: readonly Credential.Info[]) {
  return Object.fromEntries(credentials.map((credential) => [credential.integrationID, fromCredential(credential.value)]))
}

export * as AuthWire from "./auth-wire"
