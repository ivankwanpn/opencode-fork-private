export type ProviderModel = {
  id: string
  name?: string
  ownedBy?: string
  context?: number
  input?: number
  output?: number
}

export type ProviderModelDiscoveryOptions = {
  baseURL: string
  packageName?: string
  apiKey?: string
  headers?: Record<string, string>
  modelsURL?: string
  timeoutMs?: number
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export type ProviderModelDiscoveryResult = {
  endpoint: string
  models: ProviderModel[]
}

export const DISCOVERABLE_PROVIDER_PACKAGES = new Set([
  "@ai-sdk/alibaba",
  "@ai-sdk/anthropic",
  "@ai-sdk/cerebras",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/google",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/perplexity",
  "@ai-sdk/togetherai",
  "@ai-sdk/xai",
  "@openrouter/ai-sdk-provider",
])

export const NATIVE_PROVIDER_IDS = new Set([
  "amazon-bedrock",
  "azure",
  "azure-cognitive-services",
  "cloudflare-ai-gateway",
  "cloudflare-workers-ai",
  "github-copilot",
  "gitlab",
  "google-vertex",
  "google-vertex-anthropic",
  "sap-ai-core",
  "snowflake-cortex",
])

export function supportsProviderModelDiscovery(input: { providerID: string; packageName?: string; baseURL?: string }) {
  if (NATIVE_PROVIDER_IDS.has(input.providerID)) return false
  return Boolean(input.baseURL && input.packageName && DISCOVERABLE_PROVIDER_PACKAGES.has(input.packageName))
}

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

export function buildModelURLCandidates(baseURL: string, modelsURL?: string) {
  const override = modelsURL?.trim()
  if (override) return [override]

  const trimmed = baseURL.trim().replace(/\/+$/, "")
  if (!trimmed) return []

  const versioned = /\/v\d+(?:[a-z]+)?$/i.test(trimmed)
  const candidates = versioned
    ? [`${trimmed}/models`, ...(trimmed.endsWith("/v1") ? [] : [`${trimmed}/v1/models`])]
    : [`${trimmed}/v1/models`]
  if (!/\/v\d+[a-z]+$/i.test(trimmed)) {
    const suffix = KNOWN_COMPAT_SUFFIXES.find((value) => trimmed.endsWith(value))
    if (!suffix) return [...new Set(candidates)]

    const root = trimmed.slice(0, -suffix.length).replace(/\/+$/, "")
    if (!root || !root.includes("://")) return [...new Set(candidates)]
    return [...new Set([...candidates, `${root}/v1/models`, `${root}/models`])]
  }
  const root = trimmed.replace(/\/v\d+[a-z]+$/i, "").replace(/\/+$/, "")
  if (!root || !root.includes("://")) return [...new Set(candidates)]
  return [...new Set([...candidates, `${root}/v1/models`, `${root}/models`])]
}

export function parseProviderModels(value: unknown): ProviderModel[] {
  const root = isRecord(value) ? value : undefined
  const collection = root ? (root.data ?? root.models ?? root.items) : value
  const entries = Array.isArray(collection)
    ? collection
    : isRecord(collection)
      ? Object.entries(collection).map(([key, item]) => (isRecord(item) ? { ...item, id: item.id ?? key } : item))
      : collection === undefined && root
        ? Object.entries(root).map(([key, item]) => (isRecord(item) ? { ...item, id: item.id ?? key } : item))
        : []

  const models = new Map<string, ProviderModel>()
  for (const entry of entries) {
    const model = parseProviderModel(entry)
    if (model && !models.has(model.id)) models.set(model.id, model)
  }
  return [...models.values()]
}

export async function fetchProviderModels(
  options: ProviderModelDiscoveryOptions,
): Promise<ProviderModelDiscoveryResult> {
  const candidates = buildModelURLCandidates(options.baseURL, options.modelsURL)
  if (!candidates.length) throw new Error("Provider model discovery requires a base URL")

  const headers = discoveryHeaders(options)
  const fetcher = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  let lastMissing: string | undefined

  for (const endpoint of candidates) {
    const response = await fetcher(endpoint, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 404 || response.status === 405) {
      lastMissing = `${response.status} ${endpoint}`
      continue
    }
    if (!response.ok) throw new Error(`Provider model discovery failed: ${response.status}`)

    const models = parseProviderModels(await response.json())
    if (!models.length) throw new Error(`Provider model discovery returned an empty catalog: ${endpoint}`)
    return { endpoint, models }
  }

  throw new Error(`Provider model discovery endpoints unavailable: ${lastMissing ?? "none"}`)
}

function discoveryHeaders(options: ProviderModelDiscoveryOptions) {
  const headers = new Headers(options.headers)
  if (!options.apiKey) return headers

  if (options.packageName === "@ai-sdk/anthropic") {
    headers.set("x-api-key", options.apiKey)
    headers.set("anthropic-version", headers.get("anthropic-version") ?? "2023-06-01")
    headers.delete("authorization")
    return headers
  }
  if (options.packageName === "@ai-sdk/google") {
    headers.set("x-goog-api-key", options.apiKey)
    headers.delete("authorization")
    return headers
  }
  headers.set("authorization", `Bearer ${options.apiKey}`)
  return headers
}

function parseProviderModel(value: unknown): ProviderModel | undefined {
  if (typeof value === "string") {
    const id = normalizeModelID(value)
    return id ? { id } : undefined
  }
  if (!isRecord(value)) return

  const rawID = firstString(value.id, value.slug, value.name)
  const id = rawID ? normalizeModelID(rawID) : undefined
  if (!id) return
  const rawName = firstString(value.display_name, value.displayName, value.name)
  const name = rawName && normalizeModelID(rawName) !== id ? rawName : undefined
  return {
    id,
    ...(name ? { name } : {}),
    ...(firstString(value.owned_by, value.ownedBy) ? { ownedBy: firstString(value.owned_by, value.ownedBy) } : {}),
    ...(firstPositiveInteger(
      value.context_length,
      value.context_window,
      value.contextWindow,
      value.input_token_limit,
      value.inputTokenLimit,
      value.context,
    )
      ? {
          context: firstPositiveInteger(
            value.context_length,
            value.context_window,
            value.contextWindow,
            value.input_token_limit,
            value.inputTokenLimit,
            value.context,
          ),
        }
      : {}),
    ...(firstPositiveInteger(value.max_output_tokens, value.maxOutputTokens, value.output_token_limit, value.output)
      ? {
          output: firstPositiveInteger(
            value.max_output_tokens,
            value.maxOutputTokens,
            value.output_token_limit,
            value.output,
          ),
        }
      : {}),
  }
}

function normalizeModelID(value: string) {
  return value.trim().replace(/^models\//, "")
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)
}

function firstPositiveInteger(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
