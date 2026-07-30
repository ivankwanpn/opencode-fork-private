import { describe, expect, test } from "bun:test"
import { createOAuthAttemptLifecycle } from "./oauth-attempt-lifecycle"

describe("createOAuthAttemptLifecycle", () => {
  test("cancels an accepted attempt", async () => {
    const cancellation = Promise.withResolvers<void>()
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
      await cancellation.promise
    })

    const generation = lifecycle.begin()
    expect(lifecycle.accept(generation, "attempt")).toBeTrue()
    const result = lifecycle.cancel()

    expect(canceled).toEqual(["attempt"])
    expect(
      await Promise.race([
        result.then(() => "settled"),
        Bun.sleep(0).then(() => "pending"),
      ]),
    ).toBe("pending")

    cancellation.resolve()
    await expect(result).resolves.toBeUndefined()
  })

  test("cancels a response that arrives after cancellation", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })

    const generation = lifecycle.begin()
    await lifecycle.cancel()

    expect(lifecycle.accept(generation, "late-attempt")).toBeFalse()
    expect(canceled).toEqual(["late-attempt"])
  })

  test("accepts only the current generation", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })

    const staleGeneration = lifecycle.begin()
    const currentGeneration = lifecycle.begin()

    expect(lifecycle.accept(staleGeneration, "stale-attempt")).toBeFalse()
    expect(lifecycle.accept(currentGeneration, "current-attempt")).toBeTrue()
    await lifecycle.cancel()

    expect(canceled).toEqual(["stale-attempt", "current-attempt"])
  })

  test("completes without canceling an accepted attempt", async () => {
    const canceled: string[] = []
    const lifecycle = createOAuthAttemptLifecycle(async (attempt: string) => {
      canceled.push(attempt)
    })

    const generation = lifecycle.begin()
    expect(lifecycle.accept(generation, "attempt")).toBeTrue()
    lifecycle.complete()
    expect(lifecycle.accept(generation, "late-attempt")).toBeFalse()
    await lifecycle.cancel()

    expect(canceled).toEqual(["late-attempt"])
  })

  test("resolves cancellation when the cancellation callback rejects", async () => {
    const lifecycle = createOAuthAttemptLifecycle(async () => {
      throw new Error("cancellation failed")
    })

    const generation = lifecycle.begin()
    lifecycle.accept(generation, "attempt")

    await expect(lifecycle.cancel()).resolves.toBeUndefined()
  })
})
