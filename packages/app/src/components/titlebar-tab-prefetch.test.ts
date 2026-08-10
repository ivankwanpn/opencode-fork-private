import { describe, expect, test } from "bun:test"
import { createTabPrefetchQueue } from "./titlebar-tab-prefetch"

function createScheduler() {
  const pending: Array<() => void> = []
  return {
    schedule(run: () => void) {
      pending.push(run)
      return () => {
        const index = pending.indexOf(run)
        if (index !== -1) pending.splice(index, 1)
      }
    },
    flush() {
      pending.shift()?.()
    },
    size() {
      return pending.length
    },
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => (resolve = done))
  return { promise, resolve }
}

async function flushMicrotasks(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve()
  }
}

describe("createTabPrefetchQueue", () => {
  test("waits for the scheduler and runs one task at a time", async () => {
    const scheduler = createScheduler()
    const first = deferred()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)

    queue.add("a", async () => {
      order.push("a:start")
      await first.promise
      order.push("a:end")
    })
    queue.add("b", async () => {
      order.push("b")
    })

    expect(order).toEqual([])
    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["a:start"])
    expect(scheduler.size()).toBe(0)

    first.resolve()
    await first.promise
    await flushMicrotasks()
    expect(scheduler.size()).toBe(1)
    expect(order).toEqual(["a:start", "a:end"])

    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["a:start", "a:end", "b"])
  })

  test("promotes focused work and removes closed work", async () => {
    const scheduler = createScheduler()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)
    queue.add("a", async () => {
      order.push("a")
    })
    queue.add("b", async () => {
      order.push("b")
    })
    queue.add("c", async () => {
      order.push("c")
    })
    queue.promote("c")
    queue.remove("a")

    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["c"])
    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["c", "b"])
  })

  test("continues after failure and cancels scheduled work on dispose", async () => {
    const scheduler = createScheduler()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)
    queue.add("bad", async () => {
      order.push("bad")
      throw new Error("offline")
    })
    queue.add("good", async () => {
      order.push("good")
    })

    scheduler.flush()
    await flushMicrotasks()
    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["bad", "good"])

    queue.add("cancelled", async () => {
      order.push("cancelled")
    })
    queue.dispose()
    expect(scheduler.size()).toBe(0)
    expect(order).toEqual(["bad", "good"])
  })

  test("skips duplicate work for pending and running keys", async () => {
    const scheduler = createScheduler()
    const first = deferred()
    const order: string[] = []
    const queue = createTabPrefetchQueue(scheduler.schedule)

    queue.add("a", async () => {
      order.push("a:start")
      queue.add("a", async () => {
        order.push("a:duplicate-running")
      })
      await first.promise
      order.push("a:end")
    })
    queue.add("a", async () => {
      order.push("a:duplicate-pending")
    })
    queue.add("b", async () => {
      order.push("b")
    })

    expect(scheduler.size()).toBe(1)
    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["a:start"])

    first.resolve()
    await first.promise
    await flushMicrotasks()
    expect(scheduler.size()).toBe(1)

    scheduler.flush()
    await flushMicrotasks()
    expect(order).toEqual(["a:start", "a:end", "b"])
  })
})
