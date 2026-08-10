import { VcsCapability } from "@opencode-ai/server/vcs-capability"
import { Effect, Layer } from "effect"
import { Vcs } from "./vcs"

export const layer = Layer.effect(
  VcsCapability.Service,
  Effect.gen(function* () {
    const vcs = yield* Vcs.Service
    return VcsCapability.Service.of({
      get: () => Effect.all({ branch: vcs.branch(), default_branch: vcs.defaultBranch() }),
      status: () => vcs.status(),
      diff: (mode, options) => vcs.diff(mode, options),
    })
  }),
)

export * as NativeVcs from "./native-vcs"
