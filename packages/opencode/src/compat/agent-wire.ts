import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { type DeepMutable } from "@opencode-ai/core/schema"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { CustomProvider } from "@opencode-ai/schema/custom-provider"
import { Schema } from "effect"

/** Legacy `/agent` and provider-adapter shape. It is not an executable agent catalog. */
export const LegacyAgentInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  native: Schema.optional(Schema.Boolean),
  hidden: Schema.optional(Schema.Boolean),
  topP: Schema.optional(Schema.Finite),
  temperature: Schema.optional(Schema.Finite),
  color: Schema.optional(Schema.String),
  permission: PermissionV1.Ruleset,
  model: Schema.optional(
    Schema.Struct({
      modelID: ModelV2.ID,
      providerID: ProviderV2.ID,
      protocol: Schema.optional(CustomProvider.Protocol),
    }),
  ),
  variant: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Unknown),
  steps: Schema.optional(Schema.Finite),
}).annotate({ identifier: "Agent" })
export type LegacyAgentInfo = DeepMutable<Schema.Schema.Type<typeof LegacyAgentInfo>>
