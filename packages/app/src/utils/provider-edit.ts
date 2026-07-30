export function canEditConnectedProvider(provider: object) {
  return !("auth" in provider && provider.auth === "oauth")
}
