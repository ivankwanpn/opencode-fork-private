import { Formatter } from "@opencode-ai/schema/formatter"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly status: () => Effect.Effect<readonly Formatter.Status[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/FormatterCapability") {}

export const layer = Layer.succeed(Service, Service.of({ status: () => Effect.succeed([]) }))

export * as FormatterCapability from "./formatter-capability"
