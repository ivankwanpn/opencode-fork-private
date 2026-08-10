import { normalizeSessionInfo } from "@/utils/session"
import type { ServerApi } from "@/utils/server"
import { extractArray } from "@/utils/response-helpers"

export async function loadRootSessions(input: { api: Pick<ServerApi["session"], "list">; directory: string; limit: number }) {
  const result = await input.api.list({
    directory: input.directory,
    parentID: null,
    limit: input.limit,
    order: "desc",
  })
  return {
    data: extractArray(result).map(normalizeSessionInfo),
    limit: input.limit,
    limited: true,
  } as const
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
