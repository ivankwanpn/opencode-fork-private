import { WorkspaceCapability } from "@opencode-ai/server/workspace-capability"
import { Cause, Effect, Layer } from "effect"
import { listAdapters } from "./adapters"
import { Workspace } from "./workspace"
import { context } from "@/effect/instance-state"
import { Vcs } from "@/project/vcs"

function message(input: unknown) {
  return input instanceof Error ? input.message : String(input)
}

function failed(kind: WorkspaceCapability.OperationError["kind"], cause: Cause.Cause<unknown>) {
  return new WorkspaceCapability.OperationError({ kind, message: message(Cause.squash(cause)) })
}

export const layer = Layer.effect(
  WorkspaceCapability.Service,
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    return WorkspaceCapability.Service.of({
      adapters: () => Effect.map(context, (instance) => listAdapters(instance.project.id)),
      list: () => Effect.flatMap(context, (instance) => workspace.list(instance.project)),
      create: (input) =>
        Effect.flatMap(context, (instance) =>
          workspace.create({ ...input, extra: input.extra ?? null, projectID: instance.project.id }),
        ).pipe(Effect.catchCause((cause) => Effect.fail(failed("create", cause)))),
      remove: (id) =>
        workspace.remove(id).pipe(
          Effect.map((removed) => removed !== undefined),
          Effect.catchCause((cause) => Effect.fail(failed("remove", cause))),
        ),
      status: () =>
        Effect.gen(function* () {
          const instance = yield* context
          const ids = new Set((yield* workspace.list(instance.project)).map((item) => item.id))
          return (yield* workspace.status()).filter((item) => ids.has(item.workspaceID))
        }),
      syncList: () =>
        Effect.flatMap(context, (instance) => workspace.syncList(instance.project)).pipe(
          Effect.catchCause((cause) => Effect.fail(failed("sync", cause))),
        ),
      start: () =>
        Effect.flatMap(context, (instance) => workspace.startWorkspaceSyncing(instance.project.id)).pipe(
          Effect.catchCause((cause) => Effect.fail(failed("sync", cause))),
        ),
      warp: (input) =>
        workspace.sessionWarp(input).pipe(
          Effect.mapError(
            (error) =>
              new WorkspaceCapability.OperationError({
                kind: error instanceof Vcs.PatchApplyError ? "vcs_apply" : "warp",
                message: error.message,
              }),
          ),
          Effect.catchDefect((defect) =>
            Effect.fail(new WorkspaceCapability.OperationError({ kind: "warp", message: message(defect) })),
          ),
        ),
    })
  }),
)

export * as NativeWorkspace from "./native-workspace"
