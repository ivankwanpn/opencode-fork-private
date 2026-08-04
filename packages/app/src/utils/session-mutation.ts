import type { ServerApi } from "./server"
import type { CompatibleApi } from "./server-compat"
import type { ServerProtocol } from "./server-protocol"

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
  protocol: Promise<ServerProtocol>
  api: CompatibleApi
  currentApi: ServerApi
}): Promise<ServerSessionApi> {
  return input.protocol.then((protocol) => (protocol === "v1" ? input.api.session : input.currentApi.session))
}

export function runServerSessionMutation<T>(input: {
  protocol: Promise<ServerProtocol>
  api: CompatibleApi
  currentApi: ServerApi
  sessionMutations: ReturnType<typeof createSessionMutationQueue>
  sessionID: string
  run: (api: ServerSessionApi) => Promise<T>
}) {
  return input.sessionMutations.run(input.sessionID, async () => input.run(await resolveServerSessionApi(input)))
}
