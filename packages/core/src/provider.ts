export * as ProviderV2 from "./provider"

import { Types } from "effect"
import { Provider } from "@opencode-ai/schema/provider"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK = Provider.AISDK

export const Native = Provider.Native

export const Api = Provider.Api
export type Api = Provider.Api
export type MutableApi<T extends Api = Api> = T extends Api
  ? Omit<Types.DeepMutable<T>, "settings"> & (undefined extends T["settings"] ? { settings?: any } : { settings: any })
  : never

export const Request = Provider.Request
export type Request = Provider.Request

export const Info = Provider.Info
export type Info = Provider.Info

const credentialHeaders = new Set(["authorization", "x-api-key", "api-key", "x-goog-api-key"])

type CredentialConfiguration = {
  readonly api: { readonly settings?: Readonly<Record<string, unknown>> }
  readonly request: {
    readonly headers: Readonly<Record<string, string>>
    readonly body: Readonly<Record<string, unknown>>
  }
}

export function hasConfiguredCredentials(info: CredentialConfiguration) {
  const apiKey = info.request.body.apiKey ?? info.api.settings?.apiKey
  if (typeof apiKey === "string" && apiKey.length > 0) return true
  return Object.entries(info.request.headers).some(
    ([name, value]) => credentialHeaders.has(name.toLowerCase()) && value.length > 0,
  )
}

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api"> & { api: MutableApi }
