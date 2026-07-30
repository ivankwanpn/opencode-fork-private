import type { OpenCodeEvent } from "@opencode-ai/client"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import type { EventSource } from "../../src/context/sdk"

export const worktree = "/tmp/opencode"
export const directory = `${worktree}/packages/tui`

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
}

export function eventSource(): EventSource {
  return {
    subscribeNative: async () => () => {},
  }
}

export function createEventSource() {
  let nativeFn: ((event: OpenCodeEvent) => void) | undefined
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined
  const pending: Uint8Array[] = []
  const emitNative = (event: OpenCodeEvent) => {
    if (!nativeFn) throw new Error("native event source not ready")
    nativeFn(event)
  }
  const emitNativeSSE = (event: OpenCodeEvent) => {
    const chunk = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
    if (stream) return stream.enqueue(chunk)
    pending.push(chunk)
  }
  const emitLegacy = (event: GlobalEvent) => {
    if (!("properties" in event.payload)) return
    emitNative({
      ...event.payload,
      location: { directory: event.directory, workspaceID: event.workspace },
      data: event.payload.properties,
    } as OpenCodeEvent)
  }
  const emit = emitLegacy
  return {
    source: {
      subscribeNative: async (handler: (event: OpenCodeEvent) => void) => {
        nativeFn = handler
        return () => {
          if (nativeFn === handler) nativeFn = undefined
        }
      },
    } satisfies EventSource,
    emitLegacy,
    emitNative,
    emitNativeSSE,
    emit,
    response() {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            for (const chunk of pending.splice(0)) controller.enqueue(chunk)
          },
          cancel() {
            stream = undefined
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    },
  }
}

export type FetchHandler = (url: URL) => Response | Promise<Response> | undefined

export function createFetch(override?: FetchHandler, events?: ReturnType<typeof createEventSource>) {
  const session = [] as URL[]
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === "/api/session") session.push(url)
    const overridden = await override?.(url)
    if (overridden) return overridden
    if (url.pathname === "/api/event" && events) return events.response()
    const located = (data: unknown) =>
      json({ location: { directory, project: { id: "proj_test", directory: worktree } }, data })

    if (
      [
        "/agent",
        "/command",
        "/experimental/workspace",
        "/experimental/workspace/status",
        "/formatter",
        "/lsp",
      ].includes(url.pathname)
    )
      return json([])
    if (["/config", "/experimental/resource", "/mcp", "/provider/auth", "/session/status"].includes(url.pathname))
      return json({})
    if (url.pathname === "/config/providers") return json({ providers: {}, default: {} })
    if (url.pathname === "/experimental/console") return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
    if (url.pathname === "/experimental/capabilities") return json({ backgroundSubagents: false })
    if (url.pathname === "/path") return json({ home: "", state: "", config: "", worktree, directory })
    if (url.pathname === "/api/location") return json({ directory, project: { id: "proj_test", directory: worktree } })
    if (url.pathname === "/api/project/proj_test/directory")
      return located([{ directory: worktree }])
    if (
      ["/api/agent", "/api/model", "/api/provider", "/api/integration", "/api/command", "/api/skill"].includes(
        url.pathname,
      )
    )
      return located([])
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/active") return json({ data: {} })
    if (url.pathname === "/api/capability") return json({ backgroundSubagents: false })
    if (url.pathname === "/api/config") return located({})
    if (url.pathname === "/api/console")
      return located({ consoleManagedProviders: [], switchableOrgCount: 0 })
    if (["/api/lsp", "/api/formatter"].includes(url.pathname)) return located([])
    if (["/api/mcp", "/api/mcp/resource"].includes(url.pathname)) return located({})
    if (url.pathname === "/api/vcs") return located({ branch: "main" })
    if (["/api/workspace", "/api/workspace/status", "/api/workspace/adapter"].includes(url.pathname))
      return located([])
    if (url.pathname === "/project/current") return json({ id: "proj_test" })
    if (url.pathname === "/api/reference")
      return located([])
    if (url.pathname === "/provider") return json({ all: [], default: {}, connected: [] })
    if (url.pathname === "/session") return json([])
    if (url.pathname === "/vcs") return json({ branch: "main" })
    throw new Error(`unexpected request: ${url.pathname}`)
  }) as typeof globalThis.fetch
  return { fetch, session }
}
