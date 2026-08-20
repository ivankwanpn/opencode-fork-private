import { Credential } from "@opencode-ai/core/credential"
import { Effect, Layer } from "effect"

export const empty = Layer.mock(Credential.Service)({
  all: () => Effect.succeed([]),
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  create: () => Effect.die("unexpected credential.create"),
  update: () => Effect.void,
  remove: () => Effect.void,
})

export * as CredentialTest from "./credential"
