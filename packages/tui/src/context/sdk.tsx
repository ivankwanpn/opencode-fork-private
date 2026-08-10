import { OpenCode, type OpenCodeEvent } from "@opencode-ai/client"
import { Flag } from "@opencode-ai/core/flag/flag"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribeNative: (handler: (event: OpenCodeEvent) => void) => Promise<() => void>
}

function eventChannel<A>() {
  const handlers = new Set<(event: A) => void>()
  const emitter = {
    emit(_type: "event", event: A) {
      for (const handler of handlers) handler(event)
    },
    on(_type: "event", handler: (event: A) => void) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }

  let queue: A[] = []
  let timer: Timer | undefined
  let last = 0
  const flush = () => {
    if (queue.length === 0) return
    const events = queue
    queue = []
    const scheduled = timer
    timer = undefined
    if (scheduled) clearTimeout(scheduled)
    last = Date.now()
    batch(() => {
      for (const event of events) emitter.emit("event", event)
    })
  }
  const push = (event: A) => {
    queue.push(event)
    if (timer) return
    if (Date.now() - last < 16) {
      timer = setTimeout(flush, 16)
      return
    }
    flush()
  }
  const dispose = () => {
    if (timer) clearTimeout(timer)
    flush()
    handlers.clear()
  }

  return { emitter, push, flush, dispose }
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let nativeSse: AbortController | undefined

    const native = OpenCode.make({
      baseUrl: props.url,
      fetch: ((input, init) =>
        (props.fetch ?? fetch)(input, {
          ...init,
          signal: init?.signal ?? abort.signal,
        })) as typeof fetch,
      headers: props.headers,
    })

    const nativeEvents = eventChannel<OpenCodeEvent>()
    const retryDelay = 1000
    const maxRetryDelay = 30000

    function startNativeSSE() {
      nativeSse?.abort()
      const ctrl = new AbortController()
      nativeSse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          for await (const event of native.events.subscribe({ signal: ctrl.signal })) {
            if (ctrl.signal.aborted) break
            nativeEvents.push(event)
          }

          nativeEvents.flush()
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })().catch(() => {})
    }

    onMount(async () => {
      if (props.events) {
        const unsubNative = await props.events.subscribeNative(nativeEvents.push)
        onCleanup(unsubNative)

        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          await native.workspaces.start().catch(() => {})
        }
      } else {
        startNativeSSE()
        if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) await native.workspaces.start().catch(() => {})
      }
    })

    onCleanup(() => {
      abort.abort()
      nativeSse?.abort()
      nativeEvents.dispose()
    })

    return {
      native,
      directory: props.directory,
      nativeEvent: nativeEvents.emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
