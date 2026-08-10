import type { Event as SDKEvent } from "@opencode-ai/sdk/v2/types"
import type { Registration } from "./registration.js"

export type EventMap = {
  [Item in SDKEvent as Item["type"]]: Item
}

export interface Event {
  subscribe<Type extends keyof EventMap>(
    type: Type,
    callback: (event: EventMap[Type]) => Promise<void> | void,
  ): Promise<Registration>
  all(callback: (event: SDKEvent) => Promise<void> | void): Promise<Registration>
}
