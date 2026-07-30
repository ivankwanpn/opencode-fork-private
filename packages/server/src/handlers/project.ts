import { ProjectV2 } from "@opencode-ai/core/project"
import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { ProjectNotFoundError } from "@opencode-ai/protocol/errors"
import { ProjectOperationError } from "@opencode-ai/protocol/groups/project"
import { ProjectLifecycleCapability } from "../project-lifecycle-capability"
import { HttpEffect } from "effect/unstable/http"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const lifecycle = yield* ProjectLifecycleCapability.Service

    return handlers
      .handle(
        "project.list",
        Effect.fn(function* () {
          return yield* ProjectV2.list()
        }),
      )
      .handle(
        "project.initGit",
        Effect.fn(function* () {
          const result = yield* lifecycle.initGit().pipe(
            Effect.mapError(
              (error) =>
                new ProjectOperationError({
                  name: "ProjectOperationError",
                  data: { message: error.message },
                }),
            ),
          )
          const reload = result.reload
          if (reload)
            yield* HttpEffect.appendPreResponseHandler((_request, response) =>
              Effect.as(Effect.uninterruptible(reload), response),
            )
          return result.project
        }),
      )
      .handle(
        "project.current",
        Effect.fn(function* () {
          const location = yield* Location.Service
          return {
            id: location.project.id,
            directory: location.project.directory,
          }
        }),
      )
      .handle(
        "project.update",
        Effect.fn(function* (ctx) {
          return yield* ProjectV2.update({ projectID: ctx.params.projectID, ...ctx.payload }).pipe(
            Effect.catchTag(
              "Project.NotFoundError",
              (error) =>
                new ProjectNotFoundError({
                  projectID: error.projectID,
                  message: `Project not found: ${error.projectID}`,
                }),
            ),
          )
        }),
      )
      .handle(
        "project.directories",
        Effect.fn(function* (ctx) {
          return yield* response((yield* ProjectV2.Service).directories({ projectID: ctx.params.projectID }))
        }),
      )
  }),
)
