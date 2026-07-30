import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectLifecycleCapability } from "@opencode-ai/server/project-lifecycle-capability"
import { Cause, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Worktree } from "@/worktree"
import { InstanceStore } from "./instance-store"
import { Project } from "./project"

function failed(
  operation: ProjectLifecycleCapability.OperationError["operation"],
  cause: Cause.Cause<unknown>,
) {
  const error = Cause.squash(cause)
  return new ProjectLifecycleCapability.OperationError({
    operation,
    message: error instanceof Error ? error.message : String(error),
  })
}

export const layer = Layer.effect(
  ProjectLifecycleCapability.Service,
  Effect.gen(function* () {
    const project = yield* Project.Service
    const worktree = yield* Worktree.Service
    const store = yield* InstanceStore.Service

    return ProjectLifecycleCapability.Service.of({
      initGit: () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const next = yield* project.initGit({ directory: ctx.directory, project: ctx.project })
          if (next.id === ctx.project.id && next.vcs === ctx.project.vcs && next.worktree === ctx.project.worktree)
            return { project: next }
          const bridge = yield* EffectBridge.make()
          return {
            project: next,
            reload: bridge.run(
              store.reload({
                directory: ctx.directory,
                worktree: ctx.directory,
                project: next,
              }),
            ).pipe(Effect.asVoid),
          }
        }).pipe(Effect.catchCause((cause) => Effect.fail(failed("init_git", cause)))),
      worktree: {
        create: (input) =>
          worktree.create(input).pipe(
            Effect.map((value) => ({ ...value, directory: AbsolutePath.make(value.directory) })),
            Effect.catchCause((cause) => Effect.fail(failed("worktree_create", cause))),
          ),
        remove: (input) =>
          Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const removed = yield* worktree.remove(input)
            yield* project.removeSandbox(ctx.project.id, input.directory)
            return removed
          }).pipe(Effect.catchCause((cause) => Effect.fail(failed("worktree_remove", cause)))),
        reset: (input) =>
          worktree
            .reset(input)
            .pipe(Effect.catchCause((cause) => Effect.fail(failed("worktree_reset", cause)))),
      },
      dispose: () =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const bridge = yield* EffectBridge.make()
          return bridge.run(store.dispose(ctx))
        }),
    })
  }),
)

export * as NativeProjectLifecycle from "./native-project-lifecycle"
