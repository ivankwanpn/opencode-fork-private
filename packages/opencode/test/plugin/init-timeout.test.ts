import { expect, test } from "bun:test"
import { Deferred, Duration, Effect, Option, Scope } from "effect"
import { boundedInitialization } from "@/plugin"

test("plugin initialization returns after its deadline and continues in the service scope", async () => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope
        const completed = yield* Deferred.make<void>()
        const started = Date.now()
        const initialized = yield* boundedInitialization(
          Effect.sleep(Duration.millis(25)).pipe(Effect.andThen(Deferred.succeed(completed, undefined))),
          scope,
          Duration.millis(5),
        )
        const elapsed = Date.now() - started
        const continuation = yield* Deferred.await(completed).pipe(Effect.timeoutOption(Duration.seconds(1)))
        return { initialized, elapsed, continued: Option.isSome(continuation) }
      }),
    ),
  )

  expect(result.initialized).toBe(false)
  expect(result.elapsed).toBeLessThan(1_000)
  expect(result.continued).toBe(true)
})
