import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { Credential } from "@opencode-ai/core/credential"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { buildLocationServiceMap } from "@opencode-ai/core/location-services"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Config as EffectConfig, Context, Layer, Option } from "effect"
import { Api } from "./api"
import { ServerAuth } from "./auth"
import { handlers } from "./handlers"
import { authorizationLayer } from "./middleware/authorization"
import { schemaErrorLayer } from "./middleware/schema-error"
import { PtyEnvironment } from "./pty-environment"
import { layer as locationLayer } from "./location"
import { sessionLocationLayer } from "./middleware/session-location"
import { SessionRead } from "./session-read"
import { SessionShareCapability } from "./session-share"
import { SessionDiffCapability } from "./session-diff"
import { VcsCapability } from "./vcs-capability"
import { FormatterCapability } from "./formatter-capability"
import { ConsoleCapability } from "./console-capability"
import { ConfigCapability } from "./config-capability"
import { WorkspaceCapability } from "./workspace-capability"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopyNameCapability } from "./project-copy-name-capability"
import { ProjectLifecycleCapability } from "./project-lifecycle-capability"
import { PluginCapability } from "./plugin-capability"

const applicationServices = LayerNode.group([
  Database.node,
  EventV2.node,
  httpClient,
  ToolOutputStore.cleanupNode,
  SessionV2.node,
  SessionTodo.node,
  PermissionSaved.node,
  PtyTicket.node,
  Credential.node,
  PtyEnvironment.node,
  LocationServiceMap.node,
  MoveSession.node,
  BackgroundJob.node,
  ProjectV2.node,
])

export const context = Context.makeUnsafe<unknown>(new Map())

export function createRoutes(password?: string) {
  return makeRoutes(
    password
      ? ServerAuth.Config.configLayer({ username: "opencode", password: Option.some(password) })
      : ServerAuth.Config.layer,
  )
}

export function createEmbeddedRoutes() {
  return makeRoutes(ServerAuth.Config.configLayer({ username: "opencode", password: Option.none() }))
}

function makeRoutes<AuthError, AuthServices>(auth: Layer.Layer<ServerAuth.Config, AuthError, AuthServices>) {
  const locationServiceMap = buildLocationServiceMap([
    [SessionExecution.node, SessionExecution.noopLayer],
  ])
  const serviceLayer = AppNodeBuilder.build(applicationServices, [
    [LocationServiceMap.node, locationServiceMap],
    [SessionExecution.node, SessionExecutionLocal.node],
  ])
  const hostHandlers = handlers.pipe(
    Layer.provide(SessionRead.layer),
    Layer.provide(SessionShareCapability.layer),
    Layer.provide(SessionDiffCapability.layer),
    Layer.provide(VcsCapability.layer),
    Layer.provide(FormatterCapability.layer),
    Layer.provide(ConsoleCapability.layer),
    Layer.provide(ConfigCapability.layer),
    Layer.provide(WorkspaceCapability.layer),
    Layer.provide(ProjectCopyNameCapability.layer),
    Layer.provide(ProjectLifecycleCapability.layer),
    Layer.provide(PluginCapability.layer),
  )

  return HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(hostHandlers),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(auth),
    Layer.provide(serviceLayer),
    HttpRouter.provideRequest(serviceLayer),
    HttpRouter.provideRequest(ProjectCopyNameCapability.layer),
    HttpRouter.provideRequest(ProjectLifecycleCapability.layer),
  )
}

type RouteRequirements =
  | Layer.Success<typeof HttpServer.layerServices>
  | HttpRouter.HttpRouter
  | HttpRouter.Request<"Error", unknown>
  | HttpRouter.Request<"GlobalError", unknown>
  | HttpRouter.Request<"Requires", unknown>
  | HttpRouter.Request<"GlobalRequires", never>

export const routes: Layer.Layer<never, EffectConfig.ConfigError, RouteRequirements> = createRoutes()

export const webHandler = () =>
  HttpRouter.toWebHandler(routes.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })
