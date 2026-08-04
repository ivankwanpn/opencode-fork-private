import { MCP } from "@opencode-ai/core/mcp"
import { InvalidRequestError, McpNotFoundError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

const notFound = (error: MCP.NotFoundError) =>
  new McpNotFoundError({ name: error.name, message: `MCP server not found: ${error.name}` })

export const McpHandler = HttpApiBuilder.group(Api, "server.mcp", (handlers) =>
  handlers
    .handle("mcp.status", () => response(MCP.Service.use((mcp) => mcp.status())))
    .handle("mcp.resources", () => response(MCP.Service.use((mcp) => mcp.resources())))
    .handle("mcp.connect", (ctx) =>
      MCP.Service.use((mcp) => mcp.connect(ctx.params.name)).pipe(
        Effect.mapError(notFound),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
    .handle("mcp.disconnect", (ctx) =>
      MCP.Service.use((mcp) => mcp.disconnect(ctx.params.name)).pipe(
        Effect.mapError(notFound),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
    )
    .handle("mcp.authenticate", (ctx) =>
      MCP.Service.use((mcp) =>
        Effect.gen(function* () {
          const supportsOAuth = yield* mcp.supportsOAuth(ctx.params.name)
          if (!supportsOAuth) {
            return yield* new InvalidRequestError({
              kind: "mcp-oauth",
              message: `MCP server ${ctx.params.name} does not support OAuth`,
            })
          }
          return yield* response(mcp.authenticate(ctx.params.name))
        }).pipe(
          Effect.catchTag("MCP.NotFoundError", (error) => Effect.fail(notFound(error))),
          Effect.catchTag("MCP.AuthError", (error) =>
            Effect.fail(new InvalidRequestError({ kind: "mcp-oauth", message: error.message })),
          ),
        ),
      ),
    ),
)
