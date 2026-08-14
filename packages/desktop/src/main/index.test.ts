import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import {
  formatStartupFailure,
  forwardInitializationFailure,
  restoreAndAwaitStartup,
} from "./initialization"

describe("desktop initialization", () => {
  const failure = new Error("sidecar startup failed")
  const expectFailure = (exit: Exit.Exit<unknown, unknown>) => {
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isSuccess(exit)) return
    expect(Cause.squash(exit.cause)).toBe(failure)
  }

  test("forwards loading task failures before renderer initialization", () => {
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const initialization = yield* Deferred.make<never, unknown>()
        yield* forwardInitializationFailure(initialization)(Effect.die(failure)).pipe(Effect.exit)
        return yield* Deferred.await(initialization).pipe(Effect.exit)
      }),
    )

    expectFailure(exit)
  })

  test("forwards loading task failures while renderer initialization waits", () => {
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const initialization = yield* Deferred.make<never, unknown>()
        const waiting = yield* Deferred.await(initialization).pipe(Effect.exit, Effect.forkChild)
        yield* forwardInitializationFailure(initialization)(Effect.die(failure)).pipe(Effect.exit)
        return yield* Fiber.join(waiting)
      }),
    )

    expectFailure(exit)
  })

  test("runs the restore callback once, before the startup fiber settles", () => {
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const blocked = yield* Deferred.make<undefined, unknown>()
        const startup = yield* Deferred.await(blocked).pipe(Effect.forkChild)
        let restores = 0
        const helper = yield* restoreAndAwaitStartup(startup, {
          restore: () => {
            restores++
          },
          onFailure: () => {},
        }).pipe(Effect.forkChild({ startImmediately: true }))
        const restoresBeforeDeferredCompletes = restores
        yield* Deferred.succeed(blocked, undefined)
        yield* Fiber.join(helper)
        return { restoresBeforeDeferredCompletes, restores }
      }),
    )

    expect(exit.restoresBeforeDeferredCompletes).toBe(1)
    expect(exit.restores).toBe(1)
  })

  test("reports a failed startup to the failure callback exactly once", () => {
    const startupFailure = new Error("sidecar startup failed")
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const blocked = yield* Deferred.make<undefined, unknown>()
        const startup = yield* Deferred.await(blocked).pipe(Effect.forkChild)
        const failures: unknown[] = []
        const helper = yield* restoreAndAwaitStartup(startup, {
          restore: () => {},
          onFailure: (error) => {
            failures.push(error)
          },
        }).pipe(Effect.forkChild)
        yield* Deferred.failSync(blocked, () => startupFailure)
        yield* Fiber.join(helper)
        return failures
      }),
    )

    expect(exit).toEqual([startupFailure])
  })

  test("does not call the failure callback when startup succeeds", () => {
    const exit = Effect.runSync(
      Effect.gen(function* () {
        const blocked = yield* Deferred.make<undefined, unknown>()
        const startup = yield* Deferred.await(blocked).pipe(Effect.forkChild)
        const failures: unknown[] = []
        const helper = yield* restoreAndAwaitStartup(startup, {
          restore: () => {},
          onFailure: (error) => {
            failures.push(error)
          },
        }).pipe(Effect.forkChild)
        yield* Deferred.succeed(blocked, undefined)
        yield* Fiber.join(helper)
        return failures
      }),
    )

    expect(exit).toEqual([])
  })
})

describe("formatStartupFailure", () => {
  test("formats the error message with one nested cause message", () => {
    const error = new Error("sidecar startup failed", { cause: new Error("port already in use") })
    expect(formatStartupFailure(error)).toBe("sidecar startup failed\nCaused by: port already in use")
  })

  test("formats an error without a cause as its message", () => {
    expect(formatStartupFailure(new Error("sidecar startup failed"))).toBe("sidecar startup failed")
  })

  test("stringifies non-error failures", () => {
    expect(formatStartupFailure("sidecar startup failed")).toBe("sidecar startup failed")
  })
})
