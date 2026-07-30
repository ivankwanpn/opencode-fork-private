import { Project } from "@opencode-ai/schema/project"
import { ProjectWorktree } from "@opencode-ai/schema/project-worktree"
import { Context, Effect, Layer, Schema } from "effect"

export class OperationError extends Schema.TaggedErrorClass<OperationError>()(
  "ProjectLifecycleCapability.OperationError",
  {
    operation: Schema.Literals(["init_git", "worktree_create", "worktree_remove", "worktree_reset"]),
    message: Schema.String,
  },
) {}

export interface Interface {
  readonly initGit: () => Effect.Effect<
    {
      readonly project: Project.Info
      readonly reload?: Effect.Effect<void>
    },
    OperationError
  >
  readonly worktree: {
    readonly create: (input: ProjectWorktree.Create) => Effect.Effect<ProjectWorktree.Info, OperationError>
    readonly remove: (input: ProjectWorktree.Remove) => Effect.Effect<boolean, OperationError>
    readonly reset: (input: ProjectWorktree.Reset) => Effect.Effect<boolean, OperationError>
  }
  readonly dispose: () => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/ProjectLifecycleCapability") {}

const unavailable = (operation: OperationError["operation"]) =>
  Effect.fail(new OperationError({ operation, message: "Project lifecycle operation is unavailable" }))

export const layer = Layer.succeed(
  Service,
  Service.of({
    initGit: () => unavailable("init_git"),
    worktree: {
      create: () => unavailable("worktree_create"),
      remove: () => unavailable("worktree_remove"),
      reset: () => unavailable("worktree_reset"),
    },
    dispose: () => Effect.succeed(Effect.void),
  }),
)

export * as ProjectLifecycleCapability from "./project-lifecycle-capability"
