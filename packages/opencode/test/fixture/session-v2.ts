import { InstanceState } from "@/effect/instance-state"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { toV2Rules } from "@opencode-ai/core/session/info"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { Effect, Schema } from "effect"

export type Input = {
  readonly id?: SessionV2.ID
  readonly parentID?: SessionV2.ID
  readonly title?: string
  readonly agent?: string
  readonly model?: {
    readonly id: ModelV2.ID
    readonly providerID: ProviderV2.ID
    readonly variant?: string
    readonly protocol?: ModelV2.Protocol
  }
  readonly metadata?: Readonly<Record<string, Schema.Json>>
  readonly permission?: PermissionV1.Ruleset
  readonly workspaceID?: WorkspaceV2.ID
}

export const create = Effect.fn("TestSessionV2.create")(function* (input: Input = {}) {
  const instance = yield* InstanceState.context
  const workspaceID = input.workspaceID ?? (yield* InstanceState.workspaceID)
  const sessions = yield* SessionV2.Service
  return yield* sessions.create({
    id: input.id,
    parentID: input.parentID,
    title: input.title,
    agent: input.agent === undefined ? undefined : AgentV2.ID.make(input.agent),
    model:
      input.model === undefined
        ? undefined
        : ModelV2.Ref.make({
            ...input.model,
            variant: input.model.variant === undefined ? undefined : ModelV2.VariantID.make(input.model.variant),
          }),
    metadata: input.metadata,
    permissions: input.permission === undefined ? undefined : toV2Rules(input.permission),
    location: Location.Ref.make({
      directory: AbsolutePath.make(instance.directory),
      workspaceID,
    }),
  })
})

export * as TestSessionV2 from "./session-v2"
