export async function checkHealth(
  url: string,
  password?: string | null,
  options?: { v2Only?: boolean },
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  let healthUrls: URL[]
  try {
    healthUrls = options?.v2Only
      ? [new URL("/api/health", url), new URL("/api/capability", url)]
      : [new URL("/api/health", url), new URL("/global/health", url)]
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  const responses: Array<unknown | undefined> = []
  for (const healthUrl of healthUrls) {
    try {
      const res = await fetcher(healthUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) {
        responses.push(undefined)
        continue
      }
      if (!options?.v2Only) return true
      responses.push(await res.json())
    } catch {
      responses.push(undefined)
    }
  }
  if (options?.v2Only) {
    const health = responses[0]
    const capability = responses[1]
    return (
      health !== null &&
      typeof health === "object" &&
      "healthy" in health &&
      health.healthy === true &&
      "pid" in health &&
      typeof health.pid === "number" &&
      capability !== null &&
      typeof capability === "object" &&
      "backgroundSubagents" in capability &&
      typeof capability.backgroundSubagents === "boolean"
    )
  }
  return false
}
