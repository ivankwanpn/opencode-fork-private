import { DateTime } from "effect"
import { AgentV2 } from "../agent"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { ProjectV2 } from "../project"
import { ProviderV2 } from "../provider"
import { AbsolutePath, RelativePath } from "../schema"
import { WorkspaceV2 } from "../workspace"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"
import { SessionMessage } from "./message"
import { Snapshot } from "../snapshot"
import { SessionV1 } from "../v1/session"
import { PermissionV1 } from "../v1/permission"

// The session permission column stores the V2 rule shape
// ({ action, resource, effect }); the V1 service and events consume
// { permission, pattern, action }. Convert at the read boundary.
export const toV1Rules = (rules: PermissionV2.Ruleset): PermissionV1.Ruleset =>
  rules.map((rule) => ({ permission: rule.action, pattern: rule.resource, action: rule.effect }))

// The V1 event projector writes the legacy rule shape; convert back to the
// V2 column shape when materializing session rows.
export const toV2Rules = (
  rules: readonly { readonly permission: string; readonly pattern: string; readonly action: "allow" | "ask" | "deny" }[],
): PermissionV2.Ruleset =>
  rules.map((rule) => ({ action: rule.permission, resource: rule.pattern, effect: rule.action }))

export function fromRow(row: typeof SessionTable.$inferSelect): SessionSchema.Info {
  return SessionSchema.Info.make({
    id: SessionSchema.ID.make(row.id),
    projectID: ProjectV2.ID.make(row.project_id),
    title: row.title,
    metadata: row.metadata ?? undefined,
    parentID: row.parent_id ? SessionSchema.ID.make(row.parent_id) : undefined,
    agent: row.agent ? AgentV2.ID.make(row.agent) : undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: ModelV2.VariantID.make(row.model.variant ?? "default"),
          protocol: row.model.protocol,
        }
      : undefined,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    location: Location.Ref.make({
      directory: AbsolutePath.make(row.directory),
      workspaceID: row.workspace_id ? WorkspaceV2.ID.make(row.workspace_id) : undefined,
    }),
    subpath: row.path ? RelativePath.make(row.path) : undefined,
    revert: row.revert ? { ...row.revert, messageID: SessionMessage.ID.make(row.revert.messageID) } : undefined,
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      compacting: row.time_compacting === null ? undefined : DateTime.makeUnsafe(row.time_compacting),
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
    },
    share: row.share_url ? { url: row.share_url } : undefined,
  })
}

export function toLegacyInfo(row: typeof SessionTable.$inferSelect): SessionV1.SessionInfo {
  return SessionV1.SessionInfo.make({
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    summary:
      row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ? [...row.summary_diffs] : undefined,
          }
        : undefined,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: { read: row.tokens_cache_read, write: row.tokens_cache_write },
    },
    share: row.share_url ? { url: row.share_url } : undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: row.model.variant,
          protocol: row.model.protocol,
        }
      : undefined,
    version: row.version,
    metadata: row.metadata ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
    permission: row.permission ? toV1Rules(row.permission) : undefined,
    revert: row.revert
      ? {
          ...row.revert,
          messageID: SessionV1.MessageID.make(row.revert.messageID),
          partID: row.revert.partID ? SessionV1.PartID.make(row.revert.partID) : undefined,
        }
      : undefined,
  })
}
