import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export type ServerProtocol = "v1" | "v2"
export type ServerProtocolResolver = Promise<ServerProtocol> | (() => Promise<ServerProtocol>)

export function resolveServerProtocol(protocol?: ServerProtocolResolver) {
  if (!protocol) return Promise.resolve<ServerProtocol | undefined>(undefined)
  return typeof protocol === "function" ? protocol() : protocol
}

export type DetectServerProtocolOptions = {
  v2Only?: boolean
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

function isV2Health(value: unknown) {
  return (
    value !== null &&
    typeof value === "object" &&
    "healthy" in value &&
    value.healthy === true &&
    "pid" in value &&
    typeof value.pid === "number"
  )
}

function isV2Capability(value: unknown) {
  return (
    value !== null &&
    typeof value === "object" &&
    "backgroundSubagents" in value &&
    typeof value.backgroundSubagents === "boolean"
  )
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  options?: DetectServerProtocolOptions,
): Promise<ServerProtocol> {
  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (isV2Health(current)) {
    if (!options?.v2Only) return "v2"
    const capability = await probe(server, fetch, "/api/capability").catch(() => undefined)
    if (isV2Capability(capability)) return "v2"
    throw new Error("V2 server capability contract unavailable")
  }

  if (options?.v2Only) throw new Error("V2 server health contract unavailable")

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "v2"
}
