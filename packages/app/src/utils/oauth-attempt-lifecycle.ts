export function createOAuthAttemptLifecycle<T>(cancel: (attempt: T) => Promise<unknown>) {
  let generation = 0
  let active: T | undefined

  function discard(attempt: T) {
    return cancel(attempt).then(
      () => undefined,
      () => undefined,
    )
  }

  return {
    begin() {
      generation++
      return generation
    },
    accept(attemptGeneration: number, attempt: T) {
      if (attemptGeneration !== generation) {
        void discard(attempt)
        return false
      }
      active = attempt
      return true
    },
    cancel() {
      generation++
      const attempt = active
      active = undefined
      if (attempt === undefined) return Promise.resolve()
      return discard(attempt)
    },
    complete() {
      generation++
      active = undefined
    },
  }
}
