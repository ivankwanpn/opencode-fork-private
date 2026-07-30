import { WorktreeOperationError } from "@opencode-ai/protocol/groups/worktree"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProjectLifecycleCapability } from "../project-lifecycle-capability"

export const WorktreeHandler = HttpApiBuilder.group(Api, "server.worktree", (handlers) =>
  Effect.gen(function* () {
    const lifecycle = yield* ProjectLifecycleCapability.Service
    const operation = <A>(effect: Effect.Effect<A, ProjectLifecycleCapability.OperationError>) =>
      effect.pipe(
        Effect.mapError(
          (error) =>
            new WorktreeOperationError({
              name: "WorktreeOperationError",
              data: { message: error.message },
            }),
        ),
      )

    return handlers
      .handle("worktree.create", (ctx) => operation(lifecycle.worktree.create(ctx.payload)))
      .handle("worktree.remove", (ctx) => operation(lifecycle.worktree.remove(ctx.payload)))
      .handle("worktree.reset", (ctx) => operation(lifecycle.worktree.reset(ctx.payload)))
  }),
)
