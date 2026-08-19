import { ProjectCopyNameCapability } from "@opencode-ai/server/project-copy-name-capability"
import { Slug } from "@opencode-ai/core/util/slug"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const projectCopyHandlers = HttpApiBuilder.group(InstanceHttpApi, "projectCopyName", (handlers) =>
  Effect.gen(function* () {
    const naming = yield* ProjectCopyNameCapability.Service

    return handlers.handle("generateName", (ctx) =>
      naming.generate(ctx.payload.context).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project copy name generation failed", {
            projectID: ctx.params.projectID,
            cause,
          }).pipe(Effect.as(Slug.create())),
        ),
        Effect.map((name) => ({ name })),
      ),
    )
  }),
)
