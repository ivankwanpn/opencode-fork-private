import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"
export type ServerProtocolMode = "auto" | ServerProtocol
export type ServerProtocolResolver = Promise<ServerProtocol> | (() => Promise<ServerProtocol>)
export type ServerProtocolDetails = {
  protocol: ServerProtocol
  version?: string
  pid?: number
  backgroundSubagents?: boolean
}

export function resolveServerProtocol(protocol?: ServerProtocolResolver) {
  if (!protocol) return Promise.resolve<ServerProtocol | undefined>(undefined)
  return typeof protocol === "function" ? protocol() : protocol
}

export function resolveServerProtocolMode(value: unknown): ServerProtocolMode {
  if (value === "v1" || value === "v2") return value
  return "auto"
}

export function resolveDesktopServerProtocolMode(serverType: ServerConnection.Any["type"], value: unknown) {
  if (serverType === "sidecar") return "v2" as const
  return resolveServerProtocolMode(value)
}

export type DetectServerProtocolOptions = {
  v2Only?: boolean
  mode?: ServerProtocolMode
}

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

// The readiness probe races server startup on desktop (the sidecar resolves
// the connection before its health check completes). Retry briefly so a
// transient connection-refused/401 during boot does not surface as a protocol
// detection failure; the first successful response wins.
async function probeWithRetry(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const value = await probe(server, fetch, path).catch(() => undefined)
    if (value) return value
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return undefined
}

function healthDetails(value: unknown) {
  if (value === null || typeof value !== "object" || !("healthy" in value) || value.healthy !== true) return
  return {
    version: "version" in value && typeof value.version === "string" ? value.version : undefined,
    pid: "pid" in value && typeof value.pid === "number" ? value.pid : undefined,
  }
}

function capabilityDetails(value: unknown) {
  if (
    value === null ||
    typeof value !== "object" ||
    !("backgroundSubagents" in value) ||
    typeof value.backgroundSubagents !== "boolean"
  )
    return
  return { backgroundSubagents: value.backgroundSubagents }
}

export async function detectServerProtocolDetails(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  options?: DetectServerProtocolOptions,
): Promise<ServerProtocolDetails> {
  const mode = options?.mode ?? (options?.v2Only ? "v2" : "auto")
  if (mode === "v1") return { protocol: "v1" }

  const current = await probeWithRetry(server, fetch, "/api/health")
  const currentHealth = healthDetails(current)
  if (currentHealth?.pid !== undefined) {
    if (mode !== "v2") return { protocol: "v2", ...currentHealth }
    const capability = await probe(server, fetch, "/api/capability").catch(() => undefined)
    const currentCapability = capabilityDetails(capability)
    if (currentCapability) return { protocol: "v2", ...currentHealth, ...currentCapability }
    throw new Error("V2 server capability contract unavailable")
  }

  if (mode === "v2") throw new Error("V2 server health contract unavailable")

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  const legacyHealth = healthDetails(legacy)
  if (legacyHealth) return { protocol: "v1", version: legacyHealth.version ?? currentHealth?.version }
  if (currentHealth) return { protocol: "v1", version: currentHealth.version }
  return { protocol: "v2" }
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  options?: DetectServerProtocolOptions,
): Promise<ServerProtocol> {
  return (await detectServerProtocolDetails(server, fetch, options)).protocol
}
