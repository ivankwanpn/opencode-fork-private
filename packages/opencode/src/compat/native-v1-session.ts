import { DateTime } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import type { Session, SessionV2Info } from "@opencode-ai/sdk/v2"
import type { Session as LegacySession } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"

type NativeSession = SessionV2Info

export function legacySessionFromNative(info: NativeSession): Session {
  return {
    id: info.id,
    slug: info.id,
    projectID: info.projectID,
    workspaceID: info.location.workspaceID,
    directory: info.location.directory,
    path: info.subpath,
    parentID: info.parentID,
    cost: info.cost,
    tokens: {
      input: info.tokens.input,
      output: info.tokens.output,
      reasoning: info.tokens.reasoning,
      cache: { read: info.tokens.cache.read, write: info.tokens.cache.write },
    },
    title: info.title,
    share: info.share,
    agent: info.agent,
    model: info.model
      ? {
          id: info.model.id,
          providerID: info.model.providerID,
          variant: info.model.variant,
        }
      : undefined,
    version: "2",
    time: {
      created: info.time.created,
      updated: info.time.updated,
      compacting: info.time.compacting,
      archived: info.time.archived,
    },
    revert: info.revert
      ? {
          messageID: info.revert.messageID,
          partID: info.revert.partID,
          snapshot: info.revert.snapshot,
          diff: info.revert.diff,
        }
      : undefined,
  }
}

// Pure V2→V1 wire projection for the experimental httpapi session surface.
// The canonical SessionV2.Info has no slug/version (synthesized here like
// legacySessionFromNative), and no summary/permission (V1-only row data kept
// separate from the public V2 Info — matching the production server surface).
// This performs no storage reads: everything comes from the V2 values.
export function legacySessionFromV2(info: SessionSchema.Info): LegacySession.Info {
  const millis = (value: DateTime.Utc | undefined) => (value === undefined ? undefined : DateTime.toEpochMillis(value))
  return {
    id: SessionID.make(info.id),
    slug: info.id,
    projectID: info.projectID,
    workspaceID: info.location.workspaceID,
    directory: info.location.directory,
    path: info.subpath,
    parentID: info.parentID === undefined ? undefined : SessionID.make(info.parentID),
    title: info.title,
    agent: info.agent,
    model:
      info.model === undefined
        ? undefined
        : {
            id: ModelV2.ID.make(info.model.id),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: info.model.variant,
            protocol: info.model.protocol,
          },
    version: "2",
    cost: info.cost,
    tokens: {
      input: info.tokens.input,
      output: info.tokens.output,
      reasoning: info.tokens.reasoning,
      cache: { read: info.tokens.cache.read, write: info.tokens.cache.write },
    },
    share: info.share,
    metadata: info.metadata,
    time: {
      created: DateTime.toEpochMillis(info.time.created),
      updated: DateTime.toEpochMillis(info.time.updated),
      compacting: millis(info.time.compacting),
      archived: millis(info.time.archived),
    },
    revert:
      info.revert === undefined
        ? undefined
        : {
            messageID: MessageID.make(info.revert.messageID),
            partID: info.revert.partID === undefined ? undefined : PartID.make(info.revert.partID),
            snapshot: info.revert.snapshot,
            diff: info.revert.diff,
          },
  }
}

export * as NativeV1Session from "./native-v1-session"
