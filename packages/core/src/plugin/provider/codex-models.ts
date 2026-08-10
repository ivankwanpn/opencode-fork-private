import packageJSON from "../../../package.json" with { type: "json" }

export const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
export const CODEX_CLIENT_VERSION = packageJSON.version

const CODEX_MODELS_TIMEOUT_MS = 15_000
const CODEX_MODELS_ORIGINATOR = "opencode"
const CODEX_MODELS_USER_AGENT = `opencode/${CODEX_CLIENT_VERSION}`

export type CodexModel = {
  id: string
  name?: string
  context?: number
}

export type CodexModelsAuth = {
  access: string
  accountId?: string
}

export function parseCodexModels(value: unknown): CodexModel[] {
  const entries = modelEntries(value)
  const mapped = entries.flatMap((entry) => parseCodexModelEntry(entry.value, entry.fallbackID))
  const unique = new Map<string, CodexModel>()
  for (const model of mapped.toSorted((a, b) => a.id.localeCompare(b.id))) {
    if (!unique.has(model.id)) unique.set(model.id, model)
  }
  return [...unique.values()]
}

export async function fetchCodexModels(
  auth: CodexModelsAuth,
  options: { endpoint?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<CodexModel[]> {
  const endpoint = new URL(options.endpoint ?? CODEX_MODELS_ENDPOINT)
  endpoint.searchParams.set("client_version", CODEX_CLIENT_VERSION)
  const accountId = auth.accountId ?? accountIDFromAccess(auth.access)
  const response = await (options.fetch ?? fetch)(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.access}`,
      originator: CODEX_MODELS_ORIGINATOR,
      "User-Agent": CODEX_MODELS_USER_AGENT,
      ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(options.timeoutMs ?? CODEX_MODELS_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Codex model discovery failed: ${response.status}`)
  return parseCodexModels(await response.json())
}

function modelEntries(value: unknown): Array<{ value: unknown; fallbackID?: string }> {
  if (Array.isArray(value)) return value.map((item) => ({ value: item }))
  if (!isRecord(value)) return []

  const entries: Array<{ value: unknown; fallbackID?: string }> = []
  for (const key of ["data", "models", "items"]) {
    if (Array.isArray(value[key])) {
      entries.push(...value[key].map((item) => ({ value: item })))
      break
    }
  }

  if (isRecord(value.models)) {
    entries.push(...Object.entries(value.models).map(([fallbackID, item]) => ({ value: item, fallbackID })))
  }

  return entries
}

function parseCodexModelEntry(value: unknown, fallbackID?: string): CodexModel[] {
  if (typeof value === "string") {
    const id = value.trim()
    return id ? [{ id }] : []
  }
  if (!isRecord(value)) {
    return fallbackID ? [{ id: fallbackID }] : []
  }

  const id = stringField(value, ["slug", "id", "model", "name"]) ?? fallbackID
  if (!id) return []
  const name = stringField(value, ["display_name", "displayName", "name"])
  const context = firstPositiveInteger(value.context_window, value.contextWindow, value.context)
  return [
    {
      id,
      ...(name ? { name } : {}),
      ...(context ? { context } : {}),
    },
  ]
}

function stringField(value: Record<string, unknown>, keys: readonly string[]) {
  return keys
    .map((key) => value[key])
    .find((item): item is string => typeof item === "string" && item.trim().length > 0)
    ?.trim()
}

function accountIDFromAccess(access: string) {
  const part = access.split(".")[1]
  if (!part) return
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString())
    if (!isRecord(payload)) return
    const nested = payload["https://api.openai.com/auth"]
    const nestedAccountID = isRecord(nested) ? stringField(nested, ["chatgpt_account_id", "account_id", "accountId"]) : undefined
    const organizations = Array.isArray(payload.organizations) ? payload.organizations : []
    const organizationID = organizations
      .map((organization) => (isRecord(organization) ? organization.id : undefined))
      .find((id): id is string => typeof id === "string" && id.trim().length > 0)
    return stringField(payload, ["chatgpt_account_id", "account_id", "accountId"]) ?? nestedAccountID ?? organizationID
  } catch {
    return
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstPositiveInteger(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0)
}
