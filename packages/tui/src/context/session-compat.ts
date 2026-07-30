import type { SessionsListOutput } from "@opencode-ai/client"
import type { Session } from "@opencode-ai/sdk/v2"

type NativeSession = SessionsListOutput["data"][number]

export type SessionListFilter = { scope?: "project"; path?: string }

export function nativeSessionListQuery(input: {
  filter: SessionListFilter
  projectID?: string
  workspaceID?: string
  directory?: string
  search?: string
  limit: number
}) {
  const search = input.search?.trim()
  return {
    limit: input.limit,
    order: "desc" as const,
    ...(search ? { search } : {}),
    ...(input.workspaceID ? { workspace: input.workspaceID } : {}),
    ...(input.projectID
      ? {
          project: input.projectID,
          ...(input.filter.path ? { subpath: input.filter.path } : {}),
        }
      : input.directory
        ? { directory: input.directory }
        : {}),
  }
}

// Transitional boundary for views that still consume the legacy TUI Session
// store shape. Do not add host-only fields here: they remain unavailable until
// the central session store itself moves to SessionV2.Info.
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
      cache: {
        read: info.tokens.cache.read,
        write: info.tokens.cache.write,
      },
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
