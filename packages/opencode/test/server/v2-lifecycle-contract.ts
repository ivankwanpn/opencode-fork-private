import { expect } from "bun:test"
import { OpenCode } from "@opencode-ai/client"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

export type LifecycleEvent = {
  readonly type: string
  readonly data?: {
    readonly sessionID?: string
  }
}

export type LifecycleSession = {
  readonly id: string
}

export type LifecycleAdmission = {
  readonly id: string
  readonly sessionID: string
  readonly delivery: string
}

export type LifecycleInput = {
  readonly id: string
  readonly sessionID: string
  readonly admittedSeq: number
  readonly promotedSeq?: number
  readonly delivery: string
}

export type LifecycleHistory = {
  readonly data: ReadonlyArray<{ readonly type: string }>
}

export type LifecycleClient = {
  readonly create: (input: { readonly id: string; readonly directory: string }) => Promise<LifecycleSession>
  readonly get: (sessionID: string) => Promise<LifecycleSession>
  readonly prompt: (input: {
    readonly sessionID: string
    readonly id: string
    readonly text: string
    readonly delivery?: "steer" | "queue"
  }) => Promise<LifecycleAdmission>
  readonly inputList: (sessionID: string) => Promise<ReadonlyArray<LifecycleInput>>
  readonly inputGet: (input: { readonly sessionID: string; readonly inputID: string }) => Promise<LifecycleInput>
  readonly inputCancel: (input: { readonly sessionID: string; readonly inputID: string }) => Promise<void>
  readonly history: (sessionID: string) => Promise<LifecycleHistory>
  readonly active: () => Promise<Record<string, unknown>>
  readonly interrupt: (sessionID: string) => Promise<void>
  readonly events: (sessionID: string, signal: AbortSignal) => Promise<AsyncIterable<LifecycleEvent>>
}

export function createGeneratedLifecycleClient(input: {
  readonly baseUrl: string
  readonly directory: string
  readonly fetch?: typeof fetch
}): LifecycleClient {
  const sdk = createOpencodeClient({
    baseUrl: input.baseUrl,
    directory: input.directory,
    ...(input.fetch ? { fetch: input.fetch } : {}),
  })

  return {
    create: async (value) => {
      const result = await sdk.v2.session.create({
        id: value.id,
        location: { directory: value.directory },
      })
      if (result.error !== undefined || result.data === undefined) throw new Error("V2 session.create failed")
      return result.data.data
    },
    get: async (sessionID) => {
      const result = await sdk.v2.session.get({ sessionID })
      if (result.error !== undefined || result.data === undefined)
        throw new Error(`V2 session.get failed: ${JSON.stringify(result.error)}`)
      return result.data.data
    },
    prompt: async (value) => {
      const result = await sdk.v2.session.prompt({
        sessionID: value.sessionID,
        id: value.id,
        prompt: { text: value.text },
        delivery: value.delivery,
        resume: false,
      })
      if (result.error !== undefined || result.data === undefined) throw new Error("V2 session.prompt failed")
      return result.data.data
    },
    inputList: async (sessionID) => {
      const result = await sdk.v2.session.input.list({ sessionID })
      if (result.error !== undefined || result.data === undefined) throw new Error("V2 session.input.list failed")
      return result.data.data
    },
    inputGet: async (value) => {
      const result = await sdk.v2.session.input.get(value)
      if (result.error !== undefined || result.data === undefined) throw new Error("V2 session.input.get failed")
      return result.data.data
    },
    inputCancel: async (value) => {
      const result = await sdk.v2.session.input.cancel(value)
      if (result.error !== undefined)
        throw new Error(`V2 session.input.cancel failed: ${JSON.stringify(result.error)}`)
    },
    history: async (sessionID) => {
      const result = await sdk.v2.session.history({ sessionID, after: 0 })
      if (result.error !== undefined || result.data === undefined) throw new Error("V2 session.history failed")
      return result.data
    },
    active: async () => {
      const result = await sdk.v2.session.active()
      if (result.error !== undefined || result.data === undefined) throw new Error("V2 session.active failed")
      return result.data.data
    },
    interrupt: async (sessionID) => {
      const result = await sdk.v2.session.interrupt({ sessionID })
      if (result.error !== undefined) throw new Error("V2 session.interrupt failed")
    },
    events: async (sessionID, signal) => {
      const result = await sdk.v2.session.events({ sessionID, after: "0" }, { signal })
      return result.stream as AsyncIterable<LifecycleEvent>
    },
  }
}

export function createNativeLifecycleClient(input: {
  readonly baseUrl: string
  readonly fetch?: typeof fetch
}): LifecycleClient {
  const client = OpenCode.make({
    baseUrl: input.baseUrl,
    ...(input.fetch ? { fetch: input.fetch } : {}),
  })

  return {
    create: (value) => client.sessions.create({ id: value.id, location: { directory: value.directory } }),
    get: (sessionID) => client.sessions.get({ sessionID }),
    prompt: (value) =>
      client.sessions.prompt({
        sessionID: value.sessionID,
        id: value.id,
        prompt: { text: value.text },
        delivery: value.delivery,
        resume: false,
      }),
    inputList: (sessionID) => client.sessions.inputList({ sessionID }),
    inputGet: (value) => client.sessions.inputGet(value),
    inputCancel: (value) => client.sessions.inputCancel(value),
    history: (sessionID) => client.sessions.history({ sessionID, after: 0 }),
    active: () => client.sessions.active(),
    interrupt: (sessionID) => client.sessions.interrupt({ sessionID }),
    events: async (sessionID, signal) => client.sessions.events({ sessionID, after: 0 }, { signal }),
  }
}

export async function runV2LifecycleContract(client: LifecycleClient, directory: string, label: string) {
  const sessionID = `ses_${label}_${crypto.randomUUID().replaceAll("-", "")}`
  const firstMessageID = `msg_${label}_first`
  const secondMessageID = `msg_${label}_cancelled`
  const created = await client.create({ id: sessionID, directory })
  const eventConnection = new AbortController()
  const admittedEvent = waitForEvent(
    await client.events(sessionID, eventConnection.signal),
    (event) => event.type === "session.next.prompt.admitted" && event.data?.sessionID === sessionID,
    eventConnection,
  )

  const admitted = await client.prompt({
    sessionID,
    id: firstMessageID,
    text: "shared lifecycle admission",
  })
  const event = await admittedEvent
  const retried = await client.prompt({
    sessionID,
    id: firstMessageID,
    text: "shared lifecycle admission",
  })
  const pending = await client.inputList(sessionID)
  const exact = await client.inputGet({ sessionID, inputID: firstMessageID })

  await client.prompt({
    sessionID,
    id: secondMessageID,
    text: "cancel this input",
    delivery: "queue",
  })
  await client.inputCancel({ sessionID, inputID: secondMessageID })
  const afterCancel = await client.inputList(sessionID)
  const replayConnection = new AbortController()
  const replayedEvent = waitForEvent(
    await client.events(sessionID, replayConnection.signal),
    (item) => item.type === "session.next.prompt.admitted" && item.data?.sessionID === sessionID,
    replayConnection,
  )
  const history = await client.history(sessionID)
  const replay = await replayedEvent
  const restored = await client.get(sessionID)
  await client.interrupt(sessionID)
  const active = await client.active()

  expect(created.id).toBe(sessionID)
  expect(admitted).toMatchObject({ id: firstMessageID, sessionID, delivery: "steer" })
  expect(retried).toEqual(admitted)
  expect(event).toMatchObject({ type: "session.next.prompt.admitted", data: { sessionID } })
  expect(pending.map((input) => input.id)).toEqual([firstMessageID])
  expect(exact).toMatchObject({ id: firstMessageID, sessionID, delivery: "steer" })
  expect(afterCancel.map((input) => input.id)).toEqual([firstMessageID])
  expect(history.data.some((item) => item.type === "session.next.prompt.admitted")).toBe(true)
  expect(replay).toMatchObject({ type: "session.next.prompt.admitted", data: { sessionID } })
  expect(restored.id).toBe(sessionID)
  expect(active[sessionID]).toBeUndefined()
}

async function waitForEvent(
  events: AsyncIterable<LifecycleEvent>,
  predicate: (event: LifecycleEvent) => boolean,
  signal: AbortController,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = (async () => {
    for await (const event of events) {
      if (predicate(event)) return event
    }
    throw new Error("V2 event stream closed before the expected event")
  })()

  try {
    return await Promise.race([
      result,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for the V2 lifecycle event")), 10_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    signal.abort()
  }
}
