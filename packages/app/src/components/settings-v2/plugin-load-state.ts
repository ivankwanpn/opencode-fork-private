export type PluginLoadState<T> =
  | { readonly state: "idle" }
  | { readonly state: "loading"; readonly request: number }
  | { readonly state: "refreshing"; readonly request: number; readonly value: T }
  | { readonly state: "ready"; readonly request: number; readonly value: T }
  | { readonly state: "stale"; readonly request: number; readonly value: T; readonly error: string }
  | { readonly state: "failed"; readonly request: number; readonly error: string }

export type PluginLoadContext = {
  readonly request: number
  readonly server: object
  readonly generation: number
  readonly directory?: string
}

export function pluginLoadContextCurrent(expected: PluginLoadContext, current: PluginLoadContext) {
  return (
    expected.request === current.request &&
    expected.server === current.server &&
    expected.generation === current.generation &&
    expected.directory === current.directory
  )
}

export function beginPluginLoad<T>(current: PluginLoadState<T>, request: number): PluginLoadState<T> {
  if (current.state === "ready" || current.state === "refreshing" || current.state === "stale") {
    return { state: "refreshing", request, value: current.value }
  }
  return { state: "loading", request }
}

export function resolvePluginLoad<T>(
  current: PluginLoadState<T>,
  request: number,
  value: T,
): PluginLoadState<T> {
  if (!("request" in current) || current.request !== request) return current
  return { state: "ready", request, value }
}

export function rejectPluginLoad<T>(
  current: PluginLoadState<T>,
  request: number,
  error: string,
): PluginLoadState<T> {
  if (!("request" in current) || current.request !== request) return current
  if (current.state === "refreshing" || current.state === "stale") {
    return { state: "stale", request, value: current.value, error }
  }
  return { state: "failed", request, error }
}
