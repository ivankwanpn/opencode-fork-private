import { describe, expect, test } from "bun:test"
import { disconnectProviderAndRefresh } from "./provider-disconnect"

describe("disconnectProviderAndRefresh", () => {
  test("does not wait for provider refresh before completing disconnect", async () => {
    let releaseRefresh!: () => void
    let refreshed = false
    let succeeded = false
    const refresh = new Promise<void>((resolve) => {
      releaseRefresh = () => {
        refreshed = true
        resolve()
      }
    })

    await disconnectProviderAndRefresh({
      disconnect: async () => undefined,
      refresh: async () => refresh,
      onSuccess: () => {
        succeeded = true
      },
      onError: () => {
        throw new Error("disconnect should not fail")
      },
    })

    expect(succeeded).toBe(true)
    expect(refreshed).toBe(false)
    releaseRefresh()
    await refresh
    expect(refreshed).toBe(true)
  })
})
