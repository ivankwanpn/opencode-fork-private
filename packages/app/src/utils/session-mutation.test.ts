import { describe, expect, test } from "bun:test"
import type { ServerApi } from "./server"
import { createV2OnlyApi } from "./server-compat"
import { createSessionMutationQueue, resolveServerSessionApi, runServerSessionMutation } from "./session-mutation"

describe("session mutation queue", () => {
  test("serializes mutations for one session while allowing other sessions to proceed", async () => {
    const queue = createSessionMutationQueue()
    const pending: Array<() => void> = []
    const events: string[] = []

    const first = queue.run("ses_1", async () => {
      events.push("first:start")
      await new Promise<void>((resolve) => pending.push(resolve))
      events.push("first:end")
    })
    const second = queue.run("ses_1", async () => {
      events.push("second")
    })
    const other = queue.run("ses_2", async () => {
      events.push("other")
    })

    await other
    await Promise.resolve()
    expect(events).toEqual(["first:start", "other"])

    pending[0]?.()
    await first
    await second
    expect(events).toEqual(["first:start", "other", "first:end", "second"])
  })

  test("continues the queue after a failed mutation", async () => {
    const queue = createSessionMutationQueue()
    const events: string[] = []

    const failed = queue.run("ses_1", async () => {
      events.push("failed")
      throw new Error("mutation failed")
    })
    const next = queue.run("ses_1", async () => {
      events.push("next")
    })

    await expect(failed).rejects.toThrow("mutation failed")
    await next
    expect(events).toEqual(["failed", "next"])
  })

  test("waits for the selected V2 protocol before resolving the session namespace", async () => {
    const protocol = Promise.withResolvers<"v1" | "v2">()
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: protocol.promise,
      current: {
        session: {
          inputList: async () => {
            calls.push("inputList")
            return []
          },
        },
      } as unknown as ServerApi,
    })

    const selected = resolveServerSessionApi({ protocol: protocol.promise, api })
    let settled = false
    void selected.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    protocol.resolve("v2")
    const session = await selected
    await expect(session.inputList({ sessionID: "ses_1", delivery: "queue" })).resolves.toEqual([])
    expect(calls).toEqual(["inputList"])
  })

  test("fails closed before invoking a sidecar API when the generation is not V2", async () => {
    const calls: string[] = []
    const api = createV2OnlyApi({
      protocol: Promise.resolve("v1"),
      current: {
        session: {
          inputList: async () => {
            calls.push("inputList")
            return []
          },
        },
      } as unknown as ServerApi,
    })

    await expect(resolveServerSessionApi({ protocol: Promise.resolve("v1"), api })).rejects.toThrow(
      "V2 server protocol unavailable",
    )
    expect(calls).toEqual([])
  })

  test("prefers the generation-pinned API over a stale protocol pair", async () => {
    const calls: string[] = []
    const current = {
      session: {
        inputList: async () => {
          calls.push("inputList")
          return []
        },
      },
    } as unknown as ServerApi
    const api = createV2OnlyApi({ protocol: Promise.resolve("v1"), current })

    await expect(
      runServerSessionMutation({
        protocol: Promise.resolve("v1"),
        api,
        apiForGeneration: () => Promise.resolve(current),
        sessionMutations: createSessionMutationQueue(),
        sessionID: "ses_1",
        run: (session) => session.inputList({ sessionID: "ses_1", delivery: "queue" }).then(() => true),
      }),
    ).resolves.toBe(true)
    expect(calls).toEqual(["inputList"])
  })
})
