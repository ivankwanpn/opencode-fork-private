import type { V2Event as LegacyV2Event } from "@opencode-ai/client/promise"
import type { Event, V2Event } from "@opencode-ai/sdk/v2/client"
import type { SessionLifecycleEvent, SessionStatusEvent } from "@/utils/session-snapshot"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { makeEventListener } from "@solid-primitives/event-listener"
import { type Accessor, batch, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { createApiForServer, type ServerApi } from "@/utils/server"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { ServerConnection, useServer } from "./server"
import { createRefCountMap } from "@/utils/refcount"
import { useGlobal } from "./global"
import { ServerScope } from "@/utils/server-scope"
import {
  detectServerProtocolDetails,
  resolveDesktopServerProtocolMode,
  type ServerProtocol,
  type ServerProtocolMode,
} from "@/utils/server-protocol"
import {
  createV2OnlyApi,
  resolveCompatibleGeneration,
  type CompatibleApi,
  type CompatibleImplementation,
  type ServerGeneration,
} from "@/utils/server-compat"
import { createSessionMutationQueue } from "@/utils/session-mutation"
export { resolveServerSessionApi, runServerSessionMutation } from "@/utils/session-mutation"

const isAbortError = (error: unknown) =>
  error !== null && typeof error === "object" && "name" in error && error.name === "AbortError"

const isStreamClosed = (error: unknown, signal?: AbortSignal) => isAbortError(error) || signal?.aborted === true
type CurrentServerEvent = LegacyV2Event | V2Event | SessionLifecycleEvent | SessionStatusEvent
export type ServerEvent = Event & { current?: CurrentServerEvent }
type QueuedServerEvent = { directory: string; payload: ServerEvent }
type CurrentDelta = Extract<
  CurrentServerEvent,
  {
    type:
      | "session.text.delta"
      | "session.reasoning.delta"
      | "session.tool.input.delta"
      | "session.compaction.delta"
      | "session.next.text.delta"
      | "session.next.reasoning.delta"
      | "session.next.tool.input.delta"
      | "session.next.compaction.delta"
  }
>

export function adaptServerEvent(event: CurrentServerEvent): ServerEvent {
  return { id: event.id, type: event.type, properties: event.data, current: event } as ServerEvent
}

const coalescedKey = (event: QueuedServerEvent) => {
  if (event.payload.type === "lsp.updated") return `lsp.updated:${event.directory}`
  return undefined
}

export function enqueueServerEvent(queue: QueuedServerEvent[], event: QueuedServerEvent) {
  const key = coalescedKey(event)
  const previous = queue[queue.length - 1]
  if (key && previous && coalescedKey(previous) === key) {
    queue[queue.length - 1] = event
    return false
  }
  queue.push(event)
  return true
}

export function coalesceServerEvents(events: QueuedServerEvent[]) {
  const output: QueuedServerEvent[] = []
  events.forEach((event) => {
    const current = currentDelta(event.payload.current)
    if (current) {
      const previous = output[output.length - 1]
      const prior = currentDelta(previous?.payload.current)
      if (
        previous &&
        prior &&
        previous.directory === event.directory &&
        currentDeltaKey(prior) === currentDeltaKey(current)
      ) {
        const fragment = currentDeltaFragment(prior) + currentDeltaFragment(current)
        const data =
          current.type === "session.compaction.delta" || current.type === "session.next.compaction.delta"
            ? { ...current.data, text: fragment }
            : { ...current.data, delta: fragment }
        output[output.length - 1] = {
          directory: event.directory,
          payload: {
            ...event.payload,
            properties: data,
            current: { ...current, data } as CurrentDelta,
          } as ServerEvent,
        }
        return
      }
      output.push(event)
      return
    }
    output.push(event)
  })
  return output
}

function currentDelta(event: CurrentServerEvent | undefined): CurrentDelta | undefined {
  if (
    event?.type === "session.text.delta" ||
    event?.type === "session.reasoning.delta" ||
    event?.type === "session.tool.input.delta" ||
    event?.type === "session.compaction.delta" ||
    event?.type === "session.next.text.delta" ||
    event?.type === "session.next.reasoning.delta" ||
    event?.type === "session.next.tool.input.delta" ||
    event?.type === "session.next.compaction.delta"
  )
    return event
}

function currentDeltaKey(event: CurrentDelta) {
  if (event.type === "session.tool.input.delta" || event.type === "session.next.tool.input.delta")
    return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.callID}`
  if (event.type === "session.compaction.delta" || event.type === "session.next.compaction.delta")
    return `${event.type}:${event.data.sessionID}`
  if (event.type === "session.text.delta" || event.type === "session.reasoning.delta")
    return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.ordinal}`
  if (event.type === "session.next.text.delta")
    return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.textID}`
  return `${event.type}:${event.data.sessionID}:${event.data.assistantMessageID}:${event.data.reasoningID}`
}

function currentDeltaFragment(event: CurrentDelta) {
  return event.type === "session.compaction.delta" || event.type === "session.next.compaction.delta"
    ? event.data.text
    : event.data.delta
}

function durableEventPosition(value: unknown) {
  if (value === null || typeof value !== "object" || !("durable" in value)) return
  const durable = value.durable
  if (durable === null || typeof durable !== "object") return
  if (!("aggregateID" in durable) || typeof durable.aggregateID !== "string") return
  if (!("seq" in durable) || typeof durable.seq !== "number") return
  return { aggregateID: durable.aggregateID, seq: durable.seq }
}

export function resumeStreamAfterPageShow(event: PageTransitionEvent, start: () => unknown) {
  if (!event.persisted) return
  start()
}

type ServerEventEmitter = ReturnType<typeof createGlobalEmitter<{ [key: string]: ServerEvent }>>
export type ServerGenerationDiagnostics = {
  serverType: ServerConnection.Any["type"]
  compatibility: "v2-only"
  protocolMode: ServerProtocolMode
  protocol: ServerProtocol | undefined
  serverVersion?: string
  serverPID?: number
  backgroundSubagents?: boolean
  lastDurableAggregateID?: string
  lastDurableSequence?: number
  protocolGeneration: number
  eventGeneration: number
  reconnects: number
  started: boolean
  lastConnectedAt?: number
  lastEventAt?: number
}
type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  protocol: Promise<ServerProtocol>
  protocolForGeneration: () => Promise<ServerProtocol>
  protocolGeneration: () => number
  eventGeneration: () => number
  generationFor: () => Promise<ServerGeneration>
  diagnostics: () => ServerGenerationDiagnostics
  apiForGeneration: () => Promise<CompatibleImplementation>
  protocolKind: Accessor<ServerProtocol | undefined>
  url: string
  api: CompatibleApi
  currentApi: ServerApi
  sessionMutations: ReturnType<typeof createSessionMutationQueue>
  event: {
    on: ServerEventEmitter["on"]
    listen: ServerEventEmitter["listen"]
    start: () => Promise<void> | undefined
  }
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const abort = new AbortController()

  const eventFetch = (() => {
    if (!platform.fetch || !server) return
    try {
      const url = new URL(server.http.url)
      const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
      if (url.protocol === "http:" && !loopback) return platform.fetch
    } catch {
      return
    }
  })()

  const eventApi = createApiForServer({ server: server.http, fetch: eventFetch })
  let serverVersion: string | undefined
  let serverPID: number | undefined
  let backgroundSubagents: boolean | undefined
  let lastDurableAggregateID: string | undefined
  let lastDurableSequence: number | undefined
  const protocolMode: ServerProtocolMode = resolveDesktopServerProtocolMode(
    server.type,
    import.meta.env.VITE_OPENCODE_DESKTOP_SERVER_PROTOCOL,
  )
  const detect = () =>
    detectServerProtocolDetails(server.http, platform.fetch ?? globalThis.fetch, {
      mode: protocolMode,
    }).then((details) => {
      serverVersion = details.version
      serverPID = details.pid
      backgroundSubagents = details.backgroundSubagents
      return details.protocol
    })
  let protocol = detect()
  let protocolGeneration = 1
  let eventGeneration = 0
  let reconnects = 0
  let lastConnectedAt: number | undefined
  let lastEventAt: number | undefined
  let lastEventID: string | undefined
  const [protocolSource, setProtocolSource] = createSignal(protocol)
  const [protocolKind] = createResource(protocolSource, (value) => value)
  const protocolForGeneration = () => protocol
  const refreshProtocol = () => {
    protocolGeneration += 1
    reconnects += 1
    protocol = detect()
    setProtocolSource(protocol)
    return protocol
  }
  const emitter = createGlobalEmitter<{
    [key: string]: ServerEvent
  }>()
  const sessionMutations = createSessionMutationQueue()

  type Queued = QueuedServerEvent
  const FLUSH_FRAME_MS = 16
  const STREAM_YIELD_MS = 8
  const RECONNECT_DELAY_MS = 250

  let queue: Queued[] = []
  let buffer: Queued[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = 0

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined

    if (queue.length === 0) return

    const events = queue
    queue = buffer
    buffer = events
    queue.length = 0

    last = Date.now()
    const output = coalesceServerEvents(events)
    batch(() => {
      output.forEach((event) => emitter.emit(event.directory, event.payload))
    })

    buffer.length = 0
  }

  const schedule = () => {
    if (timer) return
    const elapsed = Date.now() - last
    timer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
  }

  let streamErrorLogged = false
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  let attempt: AbortController | undefined
  let run: Promise<void> | undefined
  let started = false
  let generation = 0

  const start = () => {
    if (started) return run
    started = true
    const active = ++generation
    const previous = run
    const current = (async () => {
      if (previous) {
        await previous
        flush()
      }
      let reconnect = false
      // oxlint-disable-next-line no-unmodified-loop-condition -- `started` is set to false by stop() which also aborts; both flags are checked to allow graceful exit
      while (!abort.signal.aborted && started && generation === active) {
        const streamGeneration = ++eventGeneration
        attempt = new AbortController()
        const onAbort = () => {
          attempt?.abort()
        }
        abort.signal.addEventListener("abort", onAbort)
        try {
          if (reconnect) refreshProtocol()
          const kind = await protocolForGeneration()
          if (kind !== "v2") throw new Error("V2 server protocol unavailable")
          lastConnectedAt = Date.now()
          console.debug("[global-sdk] event stream connected", {
            protocol: kind,
            serverType: server.type,
            compatibility: "v2-only",
            protocolMode,
            serverVersion,
            serverPID,
            backgroundSubagents,
            lastDurableAggregateID,
            lastDurableSequence,
            protocolGeneration,
            eventGeneration: streamGeneration,
            reconnects,
          })
          const events = eventApi.event.subscribe({
            signal: attempt.signal,
            headers: lastEventID ? { "Last-Event-ID": lastEventID } : undefined,
          })
          let yielded = Date.now()
          for await (const event of events) {
            if (abort.signal.aborted || !started || generation !== active || eventGeneration !== streamGeneration) break
            streamErrorLogged = false
            lastEventAt = Date.now()
            lastEventID = event.id
            const position = durableEventPosition(event)
            if (position) {
              lastDurableAggregateID = position.aggregateID
              lastDurableSequence = position.seq
            }
            const directory = event.location?.directory ?? "global"
            if (enqueueServerEvent(queue, { directory, payload: adaptServerEvent(event) })) schedule()

            if (Date.now() - yielded < STREAM_YIELD_MS) continue
            yielded = Date.now()
            await wait(0)
          }
        } catch (error) {
          if (!isStreamClosed(error, attempt?.signal) && !streamErrorLogged) {
            streamErrorLogged = true
            console.error("[global-sdk] event stream failed", {
              url: server.http.url,
              fetch: eventFetch ? "platform" : "webview",
              error,
            })
          }
        } finally {
          abort.signal.removeEventListener("abort", onAbort)
          attempt = undefined
        }

        if (abort.signal.aborted || !started || generation !== active) return
        flush()
        reconnect = true
        await wait(RECONNECT_DELAY_MS)
      }
    })().finally(() => {
      if (run !== current) return
      run = undefined
      flush()
    })
    run = current
    return run
  }

  const stop = () => {
    started = false
    generation++
    attempt?.abort()
  }

  onMount(() => {
    makeEventListener(window, "pagehide", stop)
    makeEventListener(window, "pageshow", (event) => resumeStreamAfterPageShow(event, start))
  })

  onCleanup(() => {
    stop()
    abort.abort()
    flush()
  })

  const currentApi: ServerApi = createApiForServer({ server: server.http, fetch: platform.fetch })
  const api = createV2OnlyApi({ protocol: protocolForGeneration, current: currentApi })
  const generationFor = () => protocolForGeneration().then((value) => resolveCompatibleGeneration(api, value))
  const apiForGeneration = () => generationFor().then((value) => value.api)

  return {
    server,
    scope,
    get protocol() {
      return protocolForGeneration()
    },
    protocolForGeneration,
    protocolGeneration: () => protocolGeneration,
    eventGeneration: () => eventGeneration,
    generationFor,
    apiForGeneration,
    diagnostics: () => ({
      serverType: server.type,
      compatibility: "v2-only",
      protocolMode,
      protocol: protocolKind(),
      serverVersion,
      serverPID,
      backgroundSubagents,
      lastDurableAggregateID,
      lastDurableSequence,
      protocolGeneration,
      eventGeneration,
      reconnects,
      started,
      lastConnectedAt,
      lastEventAt,
    }),
    protocolKind,
    url: server.http.url,
    api,
    currentApi,
    sessionMutations,
    event: {
      on: emitter.on.bind(emitter),
      listen: emitter.listen.bind(emitter),
      start,
    },
  }
}

export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)
  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const { use: useServerSDK, provider: ServerSDKProvider } = createSimpleContext({
  name: "ServerSDK",
  // Returns an accessor so the resolved server can change reactively (e.g. a
  // /new-session draft retargeting its server) without re-instantiating the subtree.
  init: (props: { server?: Accessor<ServerConnection.Any | undefined> }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSDK>(() => {
      const conn = props.server?.() ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.ensureServerCtx(conn).sdk
    })
  },
})

export function useServerProtocol() {
  const serverSDK = useServerSDK()
  return createMemo(() => serverSDK().protocolKind())
}

type SDKEventMap = {
  [key in Event["type"]]: Extract<ServerEvent, { type: key }>
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase) {
  const emitter = createGlobalEmitter<SDKEventMap>()

  const unsub = serverSDK.event.on(directory, (event) => {
    emitter.emit(event.type, event)
  })
  onCleanup(unsub)

  const api = serverSDK.api
  const generationFor = () =>
    serverSDK.protocolForGeneration().then((protocol) => resolveCompatibleGeneration(api, protocol))
  const apiForGeneration = () => generationFor().then((value) => value.api)

  return {
    scope: serverSDK.scope,
    get protocol() {
      return serverSDK.protocolForGeneration()
    },
    protocolForGeneration: serverSDK.protocolForGeneration,
    protocolGeneration: serverSDK.protocolGeneration,
    eventGeneration: serverSDK.eventGeneration,
    generationFor,
    apiForGeneration,
    diagnostics: serverSDK.diagnostics,
    directory,
    api,
    currentApi: serverSDK.currentApi,
    sessionMutations: serverSDK.sessionMutations,
    event: emitter,
    get url() {
      return serverSDK.url
    },
  }
}
