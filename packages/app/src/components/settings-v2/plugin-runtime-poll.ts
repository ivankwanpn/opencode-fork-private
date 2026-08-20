type RuntimeSnapshot = {
  readonly data: {
    readonly plugins: readonly {
      readonly state: string
      readonly capabilities: readonly { readonly name?: string; readonly state: string }[]
    }[]
  }
}

export function pluginRuntimeNeedsRefresh(snapshot: RuntimeSnapshot) {
  return snapshot.data.plugins.some(
    (plugin) =>
      plugin.state === "initializing" || plugin.capabilities.some((capability) => capability.state === "pending"),
  )
}
