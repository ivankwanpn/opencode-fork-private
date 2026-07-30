import { FormatterCapability } from "@opencode-ai/server/formatter-capability"
import { Effect, Layer } from "effect"
import { Format } from "."

export const layer = Layer.effect(
  FormatterCapability.Service,
  Effect.gen(function* () {
    const formatter = yield* Format.Service
    return FormatterCapability.Service.of({ status: () => formatter.status() })
  }),
)

export * as NativeFormatter from "./native-formatter"
