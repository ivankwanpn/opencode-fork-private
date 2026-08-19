export * as ProviderAuthCompat from "./provider-auth"

import { Integration } from "@opencode-ai/core/integration"
import { optional } from "@opencode-ai/core/schema"
import { Schema } from "effect"

const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
})

const TextPrompt = Schema.Struct({
  type: Schema.Literal("text"),
  key: Schema.String,
  message: Schema.String,
  placeholder: optional(Schema.String),
  when: optional(When),
})

const SelectPrompt = Schema.Struct({
  type: Schema.Literal("select"),
  key: Schema.String,
  message: Schema.String,
  options: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      value: Schema.String,
      hint: optional(Schema.String),
    }),
  ),
  when: optional(When),
})

const Prompt = Schema.Union([TextPrompt, SelectPrompt])

export class Method extends Schema.Class<Method>("ProviderAuthMethod")({
  type: Schema.Literals(["oauth", "api"]),
  label: Schema.String,
  prompts: optional(Schema.Array(Prompt)),
}) {}

export const Methods = Schema.Record(Schema.String, Schema.Array(Method))
export type Methods = typeof Methods.Type

export class Authorization extends Schema.Class<Authorization>("ProviderAuthAuthorization")({
  url: Schema.String,
  method: Schema.Literals(["auto", "code"]),
  instructions: Schema.String,
}) {}

export const AuthorizeInput = Schema.Struct({
  method: Schema.Finite.annotate({ description: "Auth method index" }),
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: "Prompt inputs" }),
})
export type AuthorizeInput = Schema.Schema.Type<typeof AuthorizeInput>

export const CallbackInput = Schema.Struct({
  method: Schema.Finite.annotate({ description: "Auth method index" }),
  code: Schema.optional(Schema.String).annotate({ description: "OAuth authorization code" }),
})
export type CallbackInput = Schema.Schema.Type<typeof CallbackInput>

export function project(integrations: readonly Integration.Info[]): Methods {
  return Schema.decodeUnknownSync(Methods)(
    Object.fromEntries(
      integrations.flatMap((integration) => {
        const methods = connectable(integration)
        if (methods.length === 0) return []
        return [
          [
            integration.id,
            methods.map((method) => ({
              type: method.type === "key" ? ("api" as const) : ("oauth" as const),
              label: method.type === "key" ? (method.label ?? "API key") : method.label,
              ...(method.prompts ? { prompts: method.prompts } : {}),
            })),
          ],
        ]
      }),
    ),
  )
}

export function method(integration: Integration.Info | undefined, index: number) {
  return integration ? connectable(integration)[index] : undefined
}

function connectable(integration: Integration.Info) {
  return integration.methods.filter(
    (method): method is Integration.KeyMethod | Integration.OAuthMethod => method.type !== "env",
  )
}
