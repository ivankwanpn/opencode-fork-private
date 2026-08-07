import type { ServerApi } from "./server"
import type { CompatibleApi, CompatibleImplementation } from "./server-compat"

export type ServerSessionApi = CompatibleApi["session"] | ServerApi["session"]

export function createSessionMutationQueue() {
  const pending = new Map<string, Promise<unknown>>()

  const run = <T>(sessionID: string, task: () => Promise<T>) => {
    const previous = pending.get(sessionID) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    const tracked = current.finally(() => {
      if (pending.get(sessionID) === tracked) pending.delete(sessionID)
    })
    pending.set(sessionID, tracked)
    return current
  }

  return { run }
}

export function resolveServerSessionApi(input: {
  api?: CompatibleApi
  apiForGeneration?: () => Promise<CompatibleImplementation>
}): Promise<ServerSessionApi> {
  return resolveServerApi(input).then((api) => api.session)
}

export function resolveServerApi(input: {
  api?: CompatibleApi
  apiForGeneration?: () => Promise<CompatibleImplementation>
}): Promise<CompatibleImplementation> {
  if (input.apiForGeneration) return input.apiForGeneration()
  if (input.api) return Promise.resolve(input.api)
  return Promise.reject(new Error("Server session API is unavailable"))
}

export function runServerMutation<T>(input: {
  api?: CompatibleApi
  sessionMutations: ReturnType<typeof createSessionMutationQueue>
  sessionID: string
  apiForGeneration?: () => Promise<CompatibleImplementation>
  run: (api: CompatibleImplementation) => Promise<T>
}) {
  return input.sessionMutations.run(input.sessionID, async () => input.run(await resolveServerApi(input)))
}

export function runServerSessionMutation<T>(input: {
  api?: CompatibleApi
  sessionMutations: ReturnType<typeof createSessionMutationQueue>
  sessionID: string
  apiForGeneration?: () => Promise<CompatibleImplementation>
  run: (api: ServerSessionApi) => Promise<T>
}) {
  return runServerMutation({
    api: input.api,
    sessionMutations: input.sessionMutations,
    sessionID: input.sessionID,
    apiForGeneration: input.apiForGeneration,
    run: (api) => input.run(api.session),
  })
}
