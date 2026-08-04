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
