export function createDesktopServerEnvironment(shell?: Record<string, string> | null) {
  return {
    ...(shell ?? {}),
    OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
  }
}

export function createSidecarEnvironment(
  source: Record<string, string | undefined>,
  input: { packaged: boolean; platform: NodeJS.Platform },
) {
  const environment = Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  )
  delete environment.DEBUG
  if (input.platform === "linux") delete environment.LD_PRELOAD
  if (!input.packaged) environment.OPENCODE_DISABLE_CHANNEL_DB = "1"
  environment.OPENCODE_PRINT_LOGS = "1"
  return environment
}
