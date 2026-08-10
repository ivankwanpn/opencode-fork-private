import { Location } from "@opencode-ai/schema/location"
import { Project } from "@opencode-ai/schema/project"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { ProjectNotFoundError } from "../errors"

export class ProjectOperationError extends Schema.ErrorClass<ProjectOperationError>("ProjectOperationError")(
  {
    name: Schema.Literal("ProjectOperationError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.get("project.list", "/api/project", {
      success: Schema.Array(Project.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.list",
        summary: "List projects",
        description: "List projects known to this server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("project.initGit", "/api/project/git/init", {
      query: LocationQuery,
      success: Project.Info,
      error: ProjectOperationError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.project.initGit",
          summary: "Initialize git repository",
          description: "Create a git repository for the requested project location and refresh its project identity.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("project.current", "/api/project/current", {
      query: LocationQuery,
      success: Project.Current,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.project.current",
          summary: "Get current project",
          description: "Resolve the project for the requested location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("project.update", "/api/project/:projectID", {
      params: { projectID: Project.ID },
      payload: Project.Update,
      success: Project.Info,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.project.update",
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project.directories", "/api/project/:projectID/directory", {
      params: { projectID: Project.ID },
      query: LocationQuery,
      success: Location.response(Project.Directories),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.project.directories",
          summary: "List project directories",
          description: "Retrieve the root checkout and registered copies for a project.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "projects", description: "Project catalog routes." }))
