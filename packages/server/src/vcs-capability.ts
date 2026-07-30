import { Vcs } from "@opencode-ai/schema/vcs"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly get: () => Effect.Effect<Vcs.Info>
  readonly status: () => Effect.Effect<readonly Vcs.FileStatus[]>
  readonly diff: (mode: Vcs.DiffMode, options?: { readonly context?: number }) => Effect.Effect<readonly Vcs.Diff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/VcsCapability") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({}),
    status: () => Effect.succeed([]),
    diff: () => Effect.succeed([]),
  }),
)

export * as VcsCapability from "./vcs-capability"
