import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const PathHandler = HttpApiBuilder.group(Api, "server.path", (handlers) =>
  handlers.handle(
    "path.get",
    Effect.fn(function* () {
      const location = yield* Location.Service
      return {
        home: AbsolutePath.make(Global.Path.home),
        state: AbsolutePath.make(Global.Path.state),
        config: AbsolutePath.make(Global.Path.config),
        worktree: location.project.directory,
        directory: location.directory,
      }
    }),
  ),
)
