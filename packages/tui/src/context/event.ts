import type { OpenCodeEvent } from "@opencode-ai/client"
import type { Event } from "@opencode-ai/sdk/v2"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

// useEvent remains the compatibility boundary for views that still consume the
// V1 event vocabulary. Canonical V2 events belong on useNativeEvent.
const compatibilityEventTypes = new Set<string>([
  "server.instance.disposed",
  "lsp.client.diagnostics",
  "lsp.updated",
  "permission.updated",
  "file.edited",
  "todo.updated",
  "command.executed",
  "session.next.moved",
  "file.watcher.updated",
  "vcs.branch.updated",
  "tui.prompt.append",
  "tui.command.execute",
  "tui.toast.show",
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "server.connected",
])

export function useEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.nativeEvent.on("event", (event) => {
      if (!compatibilityEventTypes.has(event.type)) return
      handler(
        { id: event.id, type: event.type, properties: event.data } as Event,
        {
          directory: event.location?.directory ?? sdk.directory ?? "",
          workspace: event.location?.workspaceID,
        },
      )
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: Event, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}

export function useNativeEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: OpenCodeEvent, metadata: OpenCodeEvent["location"]) => void) {
    return sdk.nativeEvent.on("event", (event) => {
      handler(event, event.location)
    })
  }

  function on<T extends OpenCodeEvent["type"]>(
    type: T,
    handler: (event: Extract<OpenCodeEvent, { type: T }>, metadata: OpenCodeEvent["location"]) => void,
  ) {
    return subscribe((event, metadata) => {
      if (event.type !== type) return
      handler(event as Extract<OpenCodeEvent, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}
