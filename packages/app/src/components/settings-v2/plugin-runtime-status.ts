export function pluginMcpRuntimeStatus(
  servers: readonly string[],
  runtime: Readonly<Record<string, { readonly status: string } | undefined>>,
) {
  if (servers.length === 0) return
  return servers.every((name) => runtime[name]?.status === "connected") ? "connected" : "disconnected"
}
