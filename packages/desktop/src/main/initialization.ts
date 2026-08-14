import { Cause, Deferred, Effect, Exit, Fiber } from "effect"

export function forwardInitializationFailure<A>(initialization: Deferred.Deferred<A, unknown>) {
  return <B, E, R>(effect: Effect.Effect<B, E, R>) =>
    effect.pipe(Effect.tapCause((cause) => Deferred.failCause(initialization, cause)))
}

export interface InitializationCallbacks {
  restore: () => void
  onFailure: (error: unknown) => void
}

/**
 * Restores the main windows before the startup fiber settles, then reports a
 * failed startup to the failure callback exactly once.
 */
export function restoreAndAwaitStartup<A, E>(
  startup: Fiber.Fiber<A, E>,
  { restore, onFailure }: InitializationCallbacks,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    restore()
    const exit = yield* Fiber.join(startup).pipe(Effect.exit)
    if (Exit.isFailure(exit)) {
      onFailure(Cause.squash(exit.cause))
    }
  })
}

export function formatStartupFailure(error: unknown) {
  if (error instanceof Error) {
    const cause = error.cause
    if (cause instanceof Error) {
      return `${error.message}\nCaused by: ${cause.message}`
    }
    return error.message
  }
  return String(error)
}
