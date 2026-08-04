import { describe, expect, test } from "bun:test"
import { createSessionMutationQueue } from "./session-mutation"

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
})
