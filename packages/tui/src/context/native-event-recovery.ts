import type { OpenCodeEvent as V2Event } from "@opencode-ai/client"

type ReplayPage = {
  readonly data: readonly V2Event[]
  readonly hasMore: boolean
}

export type RecoveryError = {
  readonly operation: "replay" | "rebuild" | "adapter"
  readonly sessionID?: string
  readonly cause: unknown
}

export function createNativeEventRecovery(input: {
  readonly dispatch: (event: V2Event) => void
  readonly sessions: () => readonly string[]
  readonly replay: (sessionID: string, after: number) => Promise<ReplayPage>
  readonly rebuild: () => Promise<void>
  readonly onError: (error: RecoveryError) => void
}) {
  const cursors = new Map<string, number>()
  const pending: V2Event[] = []
  let connected = false
  let recovering = false
  let dispatching = false
  let requested = false
  let stalled = false
  let disposed = false
  let current: Promise<void> | undefined

  const sessionID = (event: V2Event) => {
    const data = event.data as Record<string, unknown>
    return typeof data.sessionID === "string" ? data.sessionID : undefined
  }

  const sequence = (event: V2Event) => {
    const session = sessionID(event)
    return session && event.durable ? { sessionID: session, seq: event.durable.seq } : undefined
  }

  const deliver = (event: V2Event) => {
    const durable = sequence(event)
    const previous = durable ? cursors.get(durable.sessionID) : undefined
    if (durable && previous !== undefined && durable.seq <= previous) return true
    if (durable) cursors.set(durable.sessionID, durable.seq)
    dispatching = true
    try {
      input.dispatch(event)
      return true
    } catch (cause) {
      if (durable && cursors.get(durable.sessionID) === durable.seq) {
        if (previous === undefined) cursors.delete(durable.sessionID)
        else cursors.set(durable.sessionID, previous)
      }
      input.onError({ operation: "adapter", cause })
      return false
    } finally {
      dispatching = false
    }
  }

  const hasGap = (event: V2Event) => {
    const durable = sequence(event)
    const previous = durable ? cursors.get(durable.sessionID) : undefined
    return durable !== undefined && previous !== undefined && durable.seq > previous + 1
  }

  const hasBufferedGap = (event: V2Event) => {
    const durable = sequence(event)
    if (!durable) return false
    const previous = pending.reduce<number | undefined>((latest, item) => {
      const buffered = sequence(item)
      if (!buffered || buffered.sessionID !== durable.sessionID) return latest
      return latest === undefined || buffered.seq > latest ? buffered.seq : latest
    }, cursors.get(durable.sessionID))
    return previous !== undefined && durable.seq > previous + 1
  }

  const replay = async (session: string, after: number) => {
    let cursor = after
    while (!disposed) {
      const page = await input.replay(session, cursor)
      if (disposed) return
      const ordered = page.data.toSorted(
        (left, right) =>
          (sequence(left)?.seq ?? Number.MAX_SAFE_INTEGER) -
          (sequence(right)?.seq ?? Number.MAX_SAFE_INTEGER),
      )
      for (const event of ordered) {
        if (!deliver(event)) return
      }
      if (!page.hasMore) return
      const next = cursors.get(session) ?? cursor
      if (next <= cursor) throw new Error(`Session history made no progress after sequence ${cursor}`)
      cursor = next
    }
  }

  const recoverCycle = async () => {
    const sessions = new Set([...input.sessions(), ...cursors.keys()])
    for (const session of sessions) {
      const after = cursors.get(session)
      if (after === undefined) continue
      await replay(session, after).catch((cause) => {
        if (!disposed) input.onError({ operation: "replay", sessionID: session, cause })
      })
    }
    if (disposed) return
    await input.rebuild().catch((cause) => {
      if (!disposed) input.onError({ operation: "rebuild", cause })
    })
  }

  const recover = async () => {
    while (!disposed) {
      if (requested) {
        requested = false
        await recoverCycle()
        continue
      }
      const event = pending[0]
      if (!event) return
      if (hasGap(event)) {
        stalled = true
        return
      }
      if (!deliver(event)) {
        stalled = true
        return
      }
      pending.shift()
    }
  }

  const launch = () => {
    stalled = false
    recovering = true
    current = Promise.resolve()
      .then(recover)
      .catch((cause) => input.onError({ operation: "adapter", cause }))
      .finally(() => {
        current = undefined
        if (disposed) {
          recovering = false
          return
        }
        if (requested || (pending.length > 0 && !stalled)) {
          launch()
          return
        }
        recovering = stalled
      })
  }

  const start = () => {
    if (disposed) return
    requested = true
    if (!current) launch()
  }

  const accept = (event: V2Event) => {
    if (disposed) return
    if (event.type === "server.connected") {
      if (connected) start()
      else connected = true
      return
    }
    if (recovering || dispatching) {
      const gap = hasBufferedGap(event)
      pending.push(event)
      if (!gap) return
      if (dispatching) {
        requested = true
        return
      }
      start()
      return
    }
    if (hasGap(event)) {
      pending.push(event)
      start()
      return
    }
    if (deliver(event)) {
      if ((requested || pending.length > 0) && !current) launch()
      return
    }
    pending.unshift(event)
    stalled = true
    recovering = true
    if (requested && !current) launch()
  }

  return {
    accept,
    dispose() {
      disposed = true
      pending.length = 0
    },
  }
}
