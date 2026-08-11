import type { OpenCodeEvent } from "@opencode-ai/client"
import type { Event } from "@opencode-ai/sdk/v2"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

// useEvent remains the compatibility boundary for views that still consume the
// V1 event vocabulary. Native-only V2 events belong on useNativeEvent.
const compatibilityEventTypes = new Set<string>([
  "server.instance.disposed",
  "lsp.client.diagnostics",
  "lsp.updated",
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.delta",
  "message.part.removed",
  "permission.updated",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "session.status",
  "session.idle",
  "session.compacted",
  "file.edited",
  "todo.updated",
  "command.executed",
  "session.created",
  "session.updated",
  "session.deleted",
  "session.next.moved",
  "session.diff",
  "session.error",
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

  // Map the V2 session lifecycle events onto their V1 vocabulary so views
  // that consume session.created/updated/deleted keep working while V2
  // publishes them. Both carry { sessionID, info }; the V2 snapshot exposes
  // info.id which is all current views read.
  const lifecycleMap = new Map<string, string>([
    ["session.next.created", "session.created"],
    ["session.next.updated", "session.updated"],
    ["session.next.deleted", "session.deleted"],
  ])

  function subscribe(handler: (event: Event, metadata: EventMetadata) => void) {
    return sdk.nativeEvent.on("event", (event) => {
      const type = lifecycleMap.get(event.type) ?? event.type
      if (!compatibilityEventTypes.has(type)) return
      handler(
        { id: event.id, type, properties: event.data } as Event,
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
