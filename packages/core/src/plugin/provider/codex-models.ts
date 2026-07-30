export const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"

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
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.models)
      ? value.models
      : isRecord(value) && Array.isArray(value.data)
        ? value.data
        : []

  return items.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = typeof item.id === "string" ? item.id : typeof item.slug === "string" ? item.slug : undefined
    if (!id) return []
    const context = firstPositiveInteger(item.context_window, item.contextWindow, item.context)
    return [{ id, ...(typeof item.name === "string" ? { name: item.name } : {}), ...(context ? { context } : {}) }]
  })
}

export async function fetchCodexModels(
  auth: CodexModelsAuth,
  options: { endpoint?: string; fetch?: typeof fetch } = {},
): Promise<CodexModel[]> {
  const response = await (options.fetch ?? fetch)(options.endpoint ?? CODEX_MODELS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${auth.access}`,
      originator: "opencode",
      ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
    },
  })
  if (!response.ok) throw new Error(`Codex model discovery failed: ${response.status}`)
  return parseCodexModels(await response.json())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstPositiveInteger(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0)
}
