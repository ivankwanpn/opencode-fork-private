import type { OpenCodeEvent } from "@opencode-ai/client"
import { useSDK } from "./sdk"

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
