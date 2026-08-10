import { FileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import path from "path"

export const FileSystemHandler = HttpApiBuilder.group(Api, "server.fs", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("fs.read", (ctx) =>
        response(
          Effect.gen(function* () {
            const file = yield* (yield* FileSystem.Service).read({ path: ctx.query.path })
            const encoding = file.mime.startsWith("text/") ? "utf8" : "base64"
            return {
              uri: ctx.query.path,
              name: path.basename(ctx.query.path),
              content:
                encoding === "utf8"
                  ? new TextDecoder().decode(file.content)
                  : Buffer.from(file.content).toString("base64"),
              encoding,
              mime: file.mime,
            }
          }),
        ),
      )
      .handle("fs.list", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.list(ctx.query)
          }),
        ),
      )
      .handle("fs.find", (ctx) =>
        response(
          Effect.gen(function* () {
            const fs = yield* FileSystem.Service
            return yield* fs.find(ctx.query)
          }),
        ),
      )
  }),
)
