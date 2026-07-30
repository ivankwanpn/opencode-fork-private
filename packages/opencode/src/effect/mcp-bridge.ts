export * as MCPBridge from "./mcp-bridge"

import { MCP as CoreMCP } from "@opencode-ai/core/mcp"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { InstanceState } from "./instance-state"

export const AuthError = CoreMCP.AuthError
export const NotFoundError = CoreMCP.NotFoundError
export const Resource = CoreMCP.Resource
export const Service = CoreMCP.Service
export const Status = CoreMCP.Status

export type AuthStatus = CoreMCP.AuthStatus
export type Interface = CoreMCP.Interface
export type McpTool = CoreMCP.McpTool
export type Resource = CoreMCP.Resource
export type ServerInstructions = CoreMCP.ServerInstructions
export type Status = CoreMCP.Status

const layer = Layer.effect(
  CoreMCP.Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service

    const dispatch = <A, E>(
      run: (mcp: CoreMCP.Interface) => Effect.Effect<A, E>,
    ): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const context = yield* InstanceState.context
        const workspaceID = yield* InstanceState.workspaceID
        const location = locations
          .get(
            Location.Ref.make({
              directory: AbsolutePath.make(context.directory),
              workspaceID,
            }),
          )
          .pipe(Layer.orDie)
        return yield* CoreMCP.Service.use(run).pipe(Effect.provide(location))
      })

    return CoreMCP.Service.of({
      status: () => dispatch((mcp) => mcp.status()),
      clients: () => dispatch((mcp) => mcp.clients()),
      instructions: () => dispatch((mcp) => mcp.instructions()),
      tools: () => dispatch((mcp) => mcp.tools()),
      prompts: () => dispatch((mcp) => mcp.prompts()),
      resources: (clientName) => dispatch((mcp) => mcp.resources(clientName)),
      resourceTemplates: (clientName) => dispatch((mcp) => mcp.resourceTemplates(clientName)),
      add: (name, server) => dispatch((mcp) => mcp.add(name, server)),
      connect: (name) => dispatch((mcp) => mcp.connect(name)),
      disconnect: (name) => dispatch((mcp) => mcp.disconnect(name)),
      getPrompt: (clientName, name, args) => dispatch((mcp) => mcp.getPrompt(clientName, name, args)),
      readResource: (clientName, resourceUri) =>
        dispatch((mcp) => mcp.readResource(clientName, resourceUri)),
      startAuth: (name) => dispatch((mcp) => mcp.startAuth(name)),
      authenticate: (name, onAuthorization) =>
        dispatch((mcp) => mcp.authenticate(name, onAuthorization)),
      finishAuth: (name, authorizationCode) =>
        dispatch((mcp) => mcp.finishAuth(name, authorizationCode)),
      removeAuth: (name) => dispatch((mcp) => mcp.removeAuth(name)),
      supportsOAuth: (name) => dispatch((mcp) => mcp.supportsOAuth(name)),
      hasStoredTokens: (name) => dispatch((mcp) => mcp.hasStoredTokens(name)),
      getAuthStatus: (name) => dispatch((mcp) => mcp.getAuthStatus(name)),
    })
  }),
)

export const node = LayerNode.make({
  service: CoreMCP.Service,
  layer,
  deps: [LocationServiceMap.node],
})
