import { ProjectWorktree } from "@opencode-ai/schema/project-worktree"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

const root = "/api/worktree"

export class WorktreeOperationError extends Schema.ErrorClass<WorktreeOperationError>("WorktreeOperationError")(
  {
    name: Schema.Literal("WorktreeOperationError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const WorktreeGroup = HttpApiGroup.make("server.worktree")
  .add(
    HttpApiEndpoint.post("worktree.create", root, {
      query: LocationQuery,
      payload: ProjectWorktree.Create,
      success: ProjectWorktree.Info,
      error: WorktreeOperationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.create",
          summary: "Create worktree",
          description: "Create a git worktree for the current project and run configured startup scripts.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("worktree.remove", root, {
      query: LocationQuery,
      payload: ProjectWorktree.Remove,
      success: Schema.Boolean,
      error: WorktreeOperationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.remove",
          summary: "Remove worktree",
          description: "Remove a git worktree and its project registration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("worktree.reset", `${root}/reset`, {
      query: LocationQuery,
      payload: ProjectWorktree.Reset,
      success: Schema.Boolean,
      error: WorktreeOperationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.worktree.reset",
          summary: "Reset worktree",
          description: "Reset a worktree to the primary default branch and rerun configured startup scripts.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "worktrees", description: "Project worktree lifecycle routes." }))
