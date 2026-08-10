import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Effect } from "effect"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const ENV_REFERENCE = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/
const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
] as const
const CODING_AGENT_PATH_SEGMENTS = new Set(["coding", "claudecode"])
const CODING_AGENT_USER_AGENT = "claude-cli/2.1.161 (external, cli)"
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
])

export const PACKAGE_BY_PROTOCOL: Readonly<Record<CustomProvider.Protocol, string>> = {
  "openai-responses": "@ai-sdk/openai",
  "openai-compatible": "@ai-sdk/openai-compatible",
  "anthropic-messages": "@ai-sdk/anthropic",
}
export const PROTOCOLS = Object.keys(PACKAGE_BY_PROTOCOL) as CustomProvider.Protocol[]

export function normalizeDiscoverInput(
  input: CustomProvider.DiscoverInput,
): Effect.Effect<CustomProvider.DiscoverInput, CustomProvider.ValidationError> {
  return Effect.gen(function* () {
    const baseURL = typeof input.baseURL === "string" ? input.baseURL.trim() : ""
    if (!baseURL || !URL.canParse(baseURL)) return yield* validation("baseURL", "Base URL must be a valid URL")
    const parsed = new URL(baseURL)
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return yield* validation("baseURL", "Base URL must use HTTP or HTTPS")
    }
    if (parsed.username || parsed.password) {
      return yield* validation("baseURL", "Base URL must not contain credentials")
    }
    const selected = typeof input.protocol === "string" ? input.protocol.trim() : ""
    const protocol = selected || inferredDiscoveryProtocol(parsed)
    if (!Object.hasOwn(PACKAGE_BY_PROTOCOL, protocol)) {
      return yield* validation("protocol", "Protocol is not supported")
    }

    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined
    if (apiKey && (apiKey.startsWith("{env:") || apiKey.startsWith("{") || apiKey.endsWith("}"))) {
      if (!ENV_REFERENCE.test(apiKey)) {
        return yield* validation("apiKey", "Environment references must use {env:NAME}")
      }
    }

    const headers = yield* normalizeHeaders(input.headers)
    return {
      protocol: protocol as CustomProvider.Protocol,
      baseURL,
      ...(apiKey ? { apiKey } : {}),
      headers,
    }
  })
}

export function normalizeConfigureInput(
  input: CustomProvider.ConfigureInput,
): Effect.Effect<CustomProvider.ConfigureInput, CustomProvider.ValidationError> {
  return Effect.gen(function* () {
    const providerID = typeof input.providerID === "string" ? input.providerID.trim() : ""
    if (!PROVIDER_ID.test(providerID)) {
      return yield* validation(
        "providerID",
        "Provider ID must contain lowercase letters, numbers, hyphens, or underscores",
      )
    }

    const name = typeof input.name === "string" ? input.name.trim() : ""
    if (!name) return yield* validation("name", "Provider name is required")

    const discovered = yield* normalizeDiscoverInput(input)
    if (!input.models.length) return yield* validation("models.0.id", "At least one model is required")

    const ids = new Set<string>()
    const models: CustomProvider.Model[] = []
    for (const [index, model] of input.models.entries()) {
      const id = typeof model.id === "string" ? model.id.trim() : ""
      if (!id) return yield* validation(`models.${index}.id`, "Model ID is required")
      if (ids.has(id)) return yield* validation(`models.${index}.id`, "Model IDs must be unique")
      ids.add(id)

      const modelName = typeof model.name === "string" ? model.name.trim() : ""
      if (!modelName) return yield* validation(`models.${index}.name`, "Model name is required")

      const hasContext = model.context !== undefined
      const hasOutput = model.output !== undefined
      if (hasContext !== hasOutput) {
        return yield* validation(
          `models.${index}.${hasContext ? "output" : "context"}`,
          "Context and output limits must be provided together",
        )
      }
      if (hasContext && (!Number.isSafeInteger(model.context) || model.context! <= 0)) {
        return yield* validation(`models.${index}.context`, "Context limit must be a positive safe integer")
      }
      if (hasOutput && (!Number.isSafeInteger(model.output) || model.output! <= 0)) {
        return yield* validation(`models.${index}.output`, "Output limit must be a positive safe integer")
      }
      if (hasContext && hasOutput && model.output! > model.context!) {
        return yield* validation(`models.${index}.output`, "Output limit must not exceed context limit")
      }

      models.push({
        id,
        name: modelName,
        ...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
        ...(model.context === undefined ? {} : { context: model.context }),
        ...(model.output === undefined ? {} : { output: model.output }),
      })
    }

    return {
      providerID,
      name,
      ...(input.update === true ? { update: true } : {}),
      ...discovered,
      models,
    }
  })
}

export function buildProviderConfig(input: CustomProvider.ConfigureInput): ConfigProviderV1.Info {
  const headers = Object.fromEntries(input.headers.map((header) => [header.name, header.value]))
  const credential = parseCredential(input.apiKey)
  const protocol = input.protocol ?? "openai-compatible"
  return {
    npm: PACKAGE_BY_PROTOCOL[protocol],
    name: input.name,
    ...(credential.env ? { env: [credential.env] } : {}),
    options: {
      baseURL: input.baseURL,
      ...(Object.keys(headers).length ? { headers } : {}),
    },
    models: Object.fromEntries(
      input.models.map((model) => {
        const variants = reasoningVariants(model)
        return [
          model.id,
          {
            name: model.name,
            ...(model.reasoning ? { reasoning: true } : {}),
            protocols: [...PROTOCOLS],
            ...(model.context !== undefined && model.output !== undefined
              ? { limit: { context: model.context, output: model.output } }
              : {}),
            ...(Object.keys(variants).length ? { variants } : {}),
          },
        ]
      }),
    ),
  }
}

function reasoningVariants(model: CustomProvider.Model): Record<string, Record<string, never>> {
  if (!model.reasoning) return {}
  return Object.fromEntries(CustomProvider.allReasoningEfforts.map((effort) => [effort, {}]))
}

function inferredDiscoveryProtocol(url: URL): CustomProvider.Protocol {
  const segments = url.pathname.split("/").map((segment) => segment.toLowerCase())
  if (segments.some((segment) => ["anthropic", "claude", "coding", "claudecode"].includes(segment))) {
    return "anthropic-messages"
  }
  return "openai-compatible"
}

export function buildModelsURLCandidates(baseURL: string): string[] {
  const trimmed = baseURL.trim().replace(/\/+$/, "")
  if (!trimmed) return []
  const candidates = /\/v\d+$/.test(trimmed)
    ? [`${trimmed}/models`, ...(trimmed.endsWith("/v1") ? [] : [`${trimmed}/v1/models`])]
    : [`${trimmed}/v1/models`]
  const suffix = KNOWN_COMPAT_SUFFIXES.find((value) => trimmed.endsWith(value))
  if (!suffix) return [...new Set(candidates)]
  const root = trimmed.slice(0, -suffix.length).replace(/\/+$/, "")
  if (!root || !root.includes("://")) return [...new Set(candidates)]
  return [...new Set([...candidates, `${root}/v1/models`, `${root}/models`])]
}

export function buildDiscoveryHeaders(input: CustomProvider.DiscoverInput, key?: string): Headers {
  const headers = new Headers()
  const codingAgent = new URL(input.baseURL).pathname
    .split("/")
    .some((segment) => CODING_AGENT_PATH_SEGMENTS.has(segment.toLowerCase()))
  if (key && input.protocol === "anthropic-messages" && !codingAgent) {
    headers.set("x-api-key", key)
    headers.set("anthropic-version", "2023-06-01")
  }
  if (key && (input.protocol !== "anthropic-messages" || codingAgent)) {
    headers.set("authorization", `Bearer ${key}`)
  }
  if (codingAgent) headers.set("user-agent", CODING_AGENT_USER_AGENT)
  for (const header of input.headers) headers.set(header.name, header.value)
  return headers
}

export function normalizeModelCatalog(value: unknown): CustomProvider.DiscoveredModel[] {
  const root = isRecord(value) ? value : undefined
  const collection = root ? (root.data ?? root.models ?? root.items ?? root) : value
  const entries = Array.isArray(collection)
    ? collection.filter((entry) => typeof entry === "string" || isRecord(entry))
    : isRecord(collection)
      ? Object.entries(collection).flatMap<string | Record<string, unknown>>(([key, entry]) => {
          if (isRecord(entry)) return [{ ...entry, __recordKey: key }]
          if (typeof entry === "string") return [key]
          return []
        })
      : []
  const models = new Map<string, CustomProvider.DiscoveredModel>()
  for (const entry of entries) {
    if (typeof entry === "string") {
      const id = entry.trim()
      if (id) models.set(id, { id })
      continue
    }
    const id = firstString(entry, ["id", "slug", "model", "name", "__recordKey"])
    if (!id) continue
    const name = firstString(entry, ["display_name", "displayName", "label", "name"])
    const reasoning = firstBoolean(entry, ["reasoning", "supports_reasoning", "supportsReasoning"])
    const context = firstPositiveInteger(entry, [
      "context_window",
      "contextWindow",
      "max_context_length",
      "maxContextLength",
    ])
    const output = firstPositiveInteger(entry, ["max_output", "maxOutput", "max_output_tokens", "maxOutputTokens"])
    models.set(id, {
      id,
      ...(name === undefined ? {} : { name }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(context === undefined ? {} : { context }),
      ...(output === undefined ? {} : { output }),
    })
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers)
  return Object.fromEntries(
    entries.map(([name, value]) => {
      const key = name.toLowerCase()
      const redacted =
        CREDENTIAL_HEADERS.has(key) || key.includes("token") || key.includes("secret") || key.includes("key")
      return [name, redacted ? "[REDACTED]" : value]
    }),
  )
}

export function redactURL(value: string | URL): string {
  const url = new URL(value.toString())
  return `${url.protocol}//${url.host}${url.pathname}`
}

export function parseCredential(value?: string): { key?: string; env?: string } {
  const normalized = value?.trim()
  if (!normalized) return {}
  const env = ENV_REFERENCE.exec(normalized)?.[1]
  if (env) return { env }
  return { key: normalized }
}

function validation(field: string, message: string) {
  return new CustomProvider.ValidationError({ field, message })
}

function normalizeHeaders(
  input: CustomProvider.DiscoverInput["headers"],
): Effect.Effect<CustomProvider.Header[], CustomProvider.ValidationError> {
  return Effect.gen(function* () {
    const names = new Set<string>()
    const headers: CustomProvider.Header[] = []
    for (const [index, header] of input.entries()) {
      const name = typeof header.name === "string" ? header.name.trim() : ""
      const rawValue = typeof header.value === "string" ? header.value : ""
      if (/[\r\n]/.test(rawValue)) {
        return yield* validation(`headers.${index}.value`, "Header value must not contain line breaks")
      }
      const value = rawValue.trim()
      if (!name && !value) continue
      if (!name) return yield* validation(`headers.${index}.name`, "Header name is required")
      if (!HEADER_NAME.test(name)) return yield* validation(`headers.${index}.name`, "Header name is invalid")
      if (!value) return yield* validation(`headers.${index}.value`, "Header value is required")
      const lower = name.toLowerCase()
      if (names.has(lower)) {
        return yield* validation(`headers.${index}.name`, "Header names must be unique")
      }
      names.add(lower)
      headers.push({ name, value })
    }
    return headers
  })
}

function firstString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
}

function firstBoolean(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof value[key] === "boolean") return value[key]
  }
}

function firstPositiveInteger(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0) return candidate
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export * as CustomProviderDomain from "./domain"
