export function canEditConnectedProvider(_provider: object) {
  return true
}

export function providerEditTarget(provider: object, isCustom: boolean): "custom" | "oauth" | "connect" {
  if (isCustom) return "custom"
  if ("auth" in provider && provider.auth === "oauth") return "oauth"
  return "connect"
}
