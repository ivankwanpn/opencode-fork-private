import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import {
  createNativeEventRecovery,
  type RecoveryError,
} from "../../src/context/native-event-recovery"

type ReplayPage = {
  readonly data: readonly OpenCodeEvent[]
  readonly hasMore: boolean
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function readiness() {
  const waiters = new Set<{ ready: () => boolean; resolve: () => void }>()
  return {
    notify() {
      for (const waiter of [...waiters]) {
        if (!waiter.ready()) continue
        waiters.delete(waiter)
        waiter.resolve()
      }
    },
    wait(ready: () => boolean) {
      if (ready()) return Promise.resolve()
      return new Promise<void>((resolve) => waiters.add({ ready, resolve }))
    },
  }
}

function connected(id = "evt_connected") {
  return {
    id,
    type: "server.connected",
    data: {},
  } as OpenCodeEvent
}

function durable(seq: number, sessionID = "ses_test", id = `evt_${sessionID}_${seq}`) {
  return {
    id,
    type: "session.next.model.switched",
    durable: { aggregateID: sessionID, seq, version: 1 },
    data: {
      sessionID,
      messageID: `msg_${id}`,
      timestamp: seq,
      model: { id: `model-${seq}`, providerID: "provider" },
    },
  } as OpenCodeEvent
}

function transient(id: string) {
  return {
    id,
    type: "catalog.updated",
    data: {},
  } as OpenCodeEvent
}

function harness(input?: {
  readonly sessions?: () => readonly string[]
  readonly replay?: (sessionID: string, after: number) => Promise<ReplayPage> | ReplayPage
  readonly rebuild?: () => Promise<void> | void
  readonly onDispatch?: (
    event: OpenCodeEvent,
    accept: (event: OpenCodeEvent) => void,
  ) => void
}) {
  const dispatched: OpenCodeEvent[] = []
  const replayed: Array<{ sessionID: string; after: number }> = []
  const errors: RecoveryError[] = []
  const changed = readiness()
  let rebuilds = 0
  let completedRebuilds = 0
  let adapter!: ReturnType<typeof createNativeEventRecovery>
  adapter = createNativeEventRecovery({
    dispatch(event) {
      input?.onDispatch?.(event, adapter.accept)
      dispatched.push(event)
      changed.notify()
    },
    sessions: input?.sessions ?? (() => []),
    async replay(sessionID, after) {
      replayed.push({ sessionID, after })
      changed.notify()
      return input?.replay?.(sessionID, after) ?? { data: [], hasMore: false }
    },
    async rebuild() {
      rebuilds++
      changed.notify()
      await input?.rebuild?.()
      completedRebuilds++
      changed.notify()
    },
    onError(error) {
      errors.push(error)
      changed.notify()
    },
  })
  return {
    adapter,
    dispatched,
    replayed,
    errors,
    rebuilds: () => rebuilds,
    completedRebuilds: () => completedRebuilds,
    until: changed.wait,
  }
}

test("treats the first server connection as a handshake", () => {
  const recovery = harness()

  recovery.adapter.accept(connected())

  expect(recovery.dispatched).toEqual([])
  expect(recovery.replayed).toEqual([])
  expect(recovery.rebuilds()).toBe(0)
})

test("replays from the observed cursor and rebuilds on reconnect", async () => {
  const recovery = harness()
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.completedRebuilds() === 1)

  expect(recovery.replayed).toEqual([{ sessionID: "ses_test", after: 0 }])
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])
  expect(recovery.errors).toEqual([])
})

test("recovers a sequence gap without redelivering its replayed boundary event", async () => {
  const recovery = harness({
    replay() {
      return { data: [durable(1), durable(2)], hasMore: false }
    },
  })
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(durable(2))
  recovery.adapter.accept(transient("evt_after_gap"))
  await recovery.until(() => recovery.dispatched.some((event) => event.id === "evt_after_gap"))

  expect(recovery.replayed).toEqual([{ sessionID: "ses_test", after: 0 }])
  expect(recovery.rebuilds()).toBe(1)
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_after_gap",
  ])
})

test("continues replay across every history page before rebuilding", async () => {
  const trace: string[] = []
  const recovery = harness({
    replay(_sessionID, after) {
      trace.push(`replay:${after}`)
      if (after === 0) return { data: [durable(1)], hasMore: true }
      return { data: [durable(2)], hasMore: false }
    },
    rebuild() {
      trace.push("rebuild")
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.completedRebuilds() === 1)

  expect(recovery.replayed).toEqual([
    { sessionID: "ses_test", after: 0 },
    { sessionID: "ses_test", after: 1 },
  ])
  expect(trace).toEqual(["replay:0", "replay:1", "rebuild"])
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
  ])
})

test("delivers sequence zero once and ignores duplicate durable events", () => {
  const recovery = harness()

  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(durable(0, "ses_test", "evt_duplicate"))

  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])
})

test("buffers live events until replay and rebuild finish, then preserves arrival order", async () => {
  const replay = deferred<ReplayPage>()
  const rebuild = deferred<void>()
  const recovery = harness({
    replay: () => replay.promise,
    rebuild: () => rebuild.promise,
  })
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(durable(2))
  await recovery.until(() => recovery.replayed.length === 1)

  recovery.adapter.accept(transient("evt_catalog"))
  recovery.adapter.accept(durable(3))
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])

  replay.resolve({ data: [durable(1)], hasMore: false })
  await recovery.until(() => recovery.rebuilds() === 1)
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0", "evt_ses_test_1"])

  rebuild.resolve(undefined)
  await recovery.until(() => recovery.dispatched.length === 5)
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_catalog",
    "evt_ses_test_3",
  ])
})

test("starts another recovery when a durable gap arrives during recovery", async () => {
  const pages = [deferred<ReplayPage>(), deferred<ReplayPage>()]
  let page = 0
  const recovery = harness({
    replay: () => pages[page++]!.promise,
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.replayed.length === 1)

  recovery.adapter.accept(durable(3))
  recovery.adapter.accept(transient("evt_after_second_recovery"))
  pages[0]!.resolve({ data: [durable(1)], hasMore: false })
  await recovery.until(() => recovery.replayed.length === 2)

  expect(recovery.replayed).toEqual([
    { sessionID: "ses_test", after: 0 },
    { sessionID: "ses_test", after: 1 },
  ])
  pages[1]!.resolve({ data: [durable(2), durable(3)], hasMore: false })
  await recovery.until(() =>
    recovery.dispatched.some((event) => event.id === "evt_after_second_recovery"),
  )

  expect(recovery.rebuilds()).toBe(2)
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_ses_test_3",
    "evt_after_second_recovery",
  ])
})

test("finishes a reconnect requested during recovery before draining buffered events", async () => {
  const pages = [deferred<ReplayPage>(), deferred<ReplayPage>()]
  const rebuilds = [deferred<void>(), deferred<void>()]
  let page = 0
  let rebuild = 0
  const recovery = harness({
    replay: () => pages[page++]!.promise,
    rebuild: () => rebuilds[rebuild++]!.promise,
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.replayed.length === 1)

  recovery.adapter.accept(transient("evt_buffered"))
  recovery.adapter.accept(connected("evt_overlap"))
  pages[0]!.resolve({ data: [durable(1)], hasMore: false })
  await recovery.until(() => recovery.rebuilds() === 1)
  rebuilds[0]!.resolve(undefined)
  await recovery.until(() => recovery.replayed.length === 2)

  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
  ])

  pages[1]!.resolve({ data: [durable(2)], hasMore: false })
  await recovery.until(() => recovery.rebuilds() === 2)
  expect(recovery.dispatched.some((event) => event.id === "evt_buffered")).toBe(false)
  rebuilds[1]!.resolve(undefined)
  await recovery.until(() => recovery.dispatched.some((event) => event.id === "evt_buffered"))

  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_buffered",
  ])
})

test("coalesces overlapping reconnects into one follow-up recovery", async () => {
  const pages = [deferred<ReplayPage>(), deferred<ReplayPage>()]
  let page = 0
  const recovery = harness({
    replay: () => pages[page++]!.promise,
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.replayed.length === 1)

  recovery.adapter.accept(connected("evt_overlap_1"))
  recovery.adapter.accept(connected("evt_overlap_2"))
  pages[0]!.resolve({ data: [], hasMore: false })
  await recovery.until(() => recovery.replayed.length === 2)

  expect(recovery.replayed).toEqual([
    { sessionID: "ses_test", after: 0 },
    { sessionID: "ses_test", after: 0 },
  ])
  pages[1]!.resolve({ data: [], hasMore: false })
  await recovery.until(() => recovery.completedRebuilds() === 2)
  expect(recovery.rebuilds()).toBe(2)
})

test("sorts each replay page before advancing the durable cursor", async () => {
  const recovery = harness({
    replay(_sessionID, after) {
      if (after === 0) return { data: [durable(2), durable(1)], hasMore: true }
      return { data: [durable(3)], hasMore: false }
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.completedRebuilds() === 1)

  expect(recovery.replayed).toEqual([
    { sessionID: "ses_test", after: 0 },
    { sessionID: "ses_test", after: 2 },
  ])
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_ses_test_3",
  ])
})

test("rebuilds a loaded Session without replaying when no cursor was observed", async () => {
  const recovery = harness({ sessions: () => ["ses_loaded"] })
  recovery.adapter.accept(connected())

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.completedRebuilds() === 1)

  expect(recovery.replayed).toEqual([])
  expect(recovery.rebuilds()).toBe(1)
})

test("suppresses durable sequences older than the observed cursor", () => {
  const recovery = harness()

  recovery.adapter.accept(durable(2))
  recovery.adapter.accept(durable(1, "ses_test", "evt_older"))

  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_2"])
})

test("reports a non-progressing history page that claims more data", async () => {
  const recovery = harness({
    replay() {
      return { data: [durable(0, "ses_test", "evt_stale")], hasMore: true }
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.errors.length === 1 && recovery.completedRebuilds() === 1)

  expect(recovery.replayed).toEqual([{ sessionID: "ses_test", after: 0 }])
  expect(recovery.errors[0]).toMatchObject({
    operation: "replay",
    sessionID: "ses_test",
  })
  expect(String(recovery.errors[0]?.cause)).toContain(
    "Session history made no progress after sequence 0",
  )
})

test("reports replay failures with session context and still rebuilds", async () => {
  const failure = new Error("history unavailable")
  const recovery = harness({
    async replay() {
      throw failure
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.errors.length === 1 && recovery.completedRebuilds() === 1)

  expect(recovery.errors).toEqual([
    {
      operation: "replay",
      sessionID: "ses_test",
      cause: failure,
    },
  ])
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])
})

test("retains a buffered durable gap until a later replay succeeds", async () => {
  const failure = new Error("history temporarily unavailable")
  let attempt = 0
  const recovery = harness({
    replay() {
      attempt++
      if (attempt === 1) throw failure
      return { data: [durable(1), durable(2)], hasMore: false }
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(durable(2))
  await recovery.until(() => recovery.errors.length === 1 && recovery.completedRebuilds() === 1)
  recovery.adapter.accept(transient("evt_waiting_behind_gap"))

  expect(recovery.errors).toEqual([
    {
      operation: "replay",
      sessionID: "ses_test",
      cause: failure,
    },
  ])
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])

  recovery.adapter.accept(connected("evt_retry"))
  await recovery.until(() =>
    recovery.dispatched.some((event) => event.id === "evt_waiting_behind_gap"),
  )

  expect(recovery.replayed).toEqual([
    { sessionID: "ses_test", after: 0 },
    { sessionID: "ses_test", after: 0 },
  ])
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_waiting_behind_gap",
  ])
})

test("restarts stalled recovery when a later durable gap arrives", async () => {
  const failure = new Error("history temporarily unavailable")
  const retry = deferred<ReplayPage>()
  let attempt = 0
  const recovery = harness({
    replay() {
      attempt++
      if (attempt === 1) throw failure
      return retry.promise
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))

  recovery.adapter.accept(durable(2))
  await recovery.until(() => recovery.errors.length === 1 && recovery.completedRebuilds() === 1)
  await Bun.sleep(0)

  recovery.adapter.accept(durable(4))
  recovery.adapter.accept(transient("evt_waiting_behind_later_gap"))
  await recovery.until(() => recovery.replayed.length === 2)

  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])
  expect(recovery.replayed).toEqual([
    { sessionID: "ses_test", after: 0 },
    { sessionID: "ses_test", after: 0 },
  ])

  retry.resolve({
    data: [durable(1), durable(2), durable(3), durable(4)],
    hasMore: false,
  })
  await recovery.until(() =>
    recovery.dispatched.some((event) => event.id === "evt_waiting_behind_later_gap"),
  )

  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_ses_test_2",
    "evt_ses_test_3",
    "evt_ses_test_4",
    "evt_waiting_behind_later_gap",
  ])
})

test("continues other Session replays after a contextual partial failure", async () => {
  const failure = new Error("first Session unavailable")
  const recovery = harness({
    replay(sessionID) {
      if (sessionID === "ses_first") throw failure
      return { data: [durable(1, sessionID)], hasMore: false }
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0, "ses_first"))
  recovery.adapter.accept(durable(0, "ses_second"))

  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.errors.length === 1 && recovery.completedRebuilds() === 1)

  expect(recovery.replayed).toEqual([
    { sessionID: "ses_first", after: 0 },
    { sessionID: "ses_second", after: 0 },
  ])
  expect(recovery.errors).toEqual([
    {
      operation: "replay",
      sessionID: "ses_first",
      cause: failure,
    },
  ])
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_first_0",
    "evt_ses_second_0",
    "evt_ses_second_1",
  ])
})

test("reports rebuild failures and still drains buffered events", async () => {
  const rebuild = deferred<void>()
  const failure = new Error("canonical reads unavailable")
  const recovery = harness({
    rebuild: () => rebuild.promise,
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.rebuilds() === 1)

  recovery.adapter.accept(durable(1))
  recovery.adapter.accept(transient("evt_after_failed_rebuild"))
  rebuild.reject(failure)
  await recovery.until(
    () =>
      recovery.errors.some((error) => error.operation === "rebuild") &&
      recovery.dispatched.some((event) => event.id === "evt_after_failed_rebuild"),
  )

  expect(recovery.errors).toEqual([{ operation: "rebuild", cause: failure }])
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_after_failed_rebuild",
  ])
})

test("keeps recovery active so reentrant acceptance joins the ordered drain", async () => {
  const rebuild = deferred<void>()
  const recovery = harness({
    rebuild: () => rebuild.promise,
    onDispatch(event, accept) {
      if (event.id === "evt_first") accept(transient("evt_reentrant"))
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.rebuilds() === 1)

  recovery.adapter.accept(transient("evt_first"))
  recovery.adapter.accept(transient("evt_second"))
  rebuild.resolve(undefined)
  await recovery.until(() => recovery.dispatched.some((event) => event.id === "evt_reentrant"))

  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_first",
    "evt_second",
    "evt_reentrant",
  ])
})

test("retains a direct event and rolls back its cursor when dispatch fails", async () => {
  const failure = new Error("reducer rejected direct delivery")
  let attempts = 0
  const recovery = harness({
    onDispatch(event) {
      if (event.id !== "evt_ses_test_0") return
      attempts++
      if (attempts === 1) throw failure
    },
  })
  recovery.adapter.accept(connected())

  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(transient("evt_waiting_after_direct_failure"))

  expect(recovery.errors).toEqual([{ operation: "adapter", cause: failure }])
  expect(recovery.dispatched).toEqual([])

  recovery.adapter.accept(connected("evt_retry"))
  await recovery.until(() =>
    recovery.dispatched.some((event) => event.id === "evt_waiting_after_direct_failure"),
  )

  expect(attempts).toBe(2)
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_waiting_after_direct_failure",
  ])
})

test("retains the front of the recovery drain when dispatch fails", async () => {
  const rebuild = deferred<void>()
  const failure = new Error("reducer rejected buffered delivery")
  let attempts = 0
  const recovery = harness({
    rebuild: () => rebuild.promise,
    onDispatch(event) {
      if (event.id !== "evt_ses_test_1") return
      attempts++
      if (attempts === 1) throw failure
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.rebuilds() === 1)

  recovery.adapter.accept(durable(1))
  recovery.adapter.accept(transient("evt_waiting_after_buffered_failure"))
  rebuild.resolve(undefined)
  await recovery.until(() => recovery.errors.length === 1)

  expect(recovery.errors).toEqual([{ operation: "adapter", cause: failure }])
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])

  recovery.adapter.accept(connected("evt_retry"))
  await recovery.until(() =>
    recovery.dispatched.some((event) => event.id === "evt_waiting_after_buffered_failure"),
  )

  expect(attempts).toBe(2)
  expect(recovery.dispatched.map((event) => event.id)).toEqual([
    "evt_ses_test_0",
    "evt_ses_test_1",
    "evt_waiting_after_buffered_failure",
  ])
})

test("stops replay and drops buffered delivery when disposed during recovery", async () => {
  const replay = deferred<ReplayPage>()
  const replayFinished = deferred<void>()
  const recovery = harness({
    async replay() {
      const page = await replay.promise
      replayFinished.resolve(undefined)
      return page
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.replayed.length === 1)

  recovery.adapter.accept(transient("evt_buffered"))
  recovery.adapter.dispose()
  replay.resolve({ data: [durable(1)], hasMore: false })
  await replayFinished.promise
  await Promise.resolve()

  expect(recovery.rebuilds()).toBe(0)
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])
})

test("suppresses a rebuild rejection received after disposal", async () => {
  const rebuild = deferred<void>()
  const rebuildFinished = deferred<void>()
  const failure = new Error("rebuild finished after cleanup")
  const recovery = harness({
    async rebuild() {
      try {
        await rebuild.promise
      } finally {
        rebuildFinished.resolve(undefined)
      }
    },
  })
  recovery.adapter.accept(connected())
  recovery.adapter.accept(durable(0))
  recovery.adapter.accept(connected("evt_reconnected"))
  await recovery.until(() => recovery.rebuilds() === 1)

  recovery.adapter.dispose()
  rebuild.reject(failure)
  await rebuildFinished.promise
  await Promise.resolve()

  expect(recovery.errors).toEqual([])
  expect(recovery.dispatched.map((event) => event.id)).toEqual(["evt_ses_test_0"])
})
