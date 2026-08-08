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
