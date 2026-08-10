import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "@opencode-ai/core/tool/tool"
import { ToolProgress } from "@opencode-ai/core/tool/progress"
import { Tools } from "@opencode-ai/core/tool/tools"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import type { ToolContext as PluginToolContext } from "@opencode-ai/plugin"
import { Cause, Context, Effect, Exit, Fiber, JsonSchema, Layer, Schema, ScopedCache } from "effect"
import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { Plugin } from "@/plugin"
import { errorMessage } from "@/util/error"
import { PluginToolCompat } from "./plugin-compat"

const Attachment = Schema.Struct({
  type: Schema.Literal("file"),
  mime: Schema.String,
  url: Schema.String,
  filename: Schema.optional(Schema.String),
})

const Result = Schema.Struct({
  output: Schema.String,
  title: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  attachments: Schema.optional(Schema.Array(Attachment)),
})

const Structured = Schema.Record(Schema.String, Schema.Unknown)

class PermissionBridgeFailure {
  constructor(readonly cause: Cause.Cause<Tool.Failure>) {}
}

type RuntimePluginToolContext = PluginToolContext & {
  readonly callID: string
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginToolCompatV2") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const pluginTools = yield* PluginToolCompat.Service
    const progress = yield* ToolProgress.Service
    const state = yield* InstanceState.make(
      Effect.fn("PluginToolCompatV2.state")(function* (instance) {
        return yield* ScopedCache.make<string, void>({
          capacity: Number.POSITIVE_INFINITY,
          lookup: (key) => {
            const workspaceID = key === defaultWorkspaceKey ? undefined : WorkspaceV2.ID.make(key)
            const locationLayer = locations
              .get(
                Location.Ref.make({
                  directory: AbsolutePath.make(instance.directory),
                  workspaceID,
                }),
              )
              .pipe(Layer.orDie)

            return Effect.gen(function* () {
              const registry = yield* Tools.Service
              const permission = yield* PermissionV2.Service
              const location = yield* Location.Service
              const bridge = yield* EffectBridge.make()
              const contributions = yield* pluginTools.list()
              const tools = Object.fromEntries(
                contributions.map((contribution) => [
                  contribution.id,
                  makeTool(contribution, {
                    bridge,
                    permission,
                    progress,
                    directory: location.directory,
                    worktree: instance.worktree,
                  }),
                ]),
              )
              yield* registry.register(tools).pipe(Effect.orDie)
            }).pipe(Effect.provide(locationLayer))
          },
        })
      }),
    )

    return Service.of({
      init: Effect.fn("PluginToolCompatV2.init")(function* () {
        const workspaceID = yield* InstanceState.workspaceID
        const placements = yield* InstanceState.get(state)
        yield* ScopedCache.get(placements, workspaceID ?? defaultWorkspaceKey)
      }),
    })
  }),
)

const defaultWorkspaceKey = "\u0000default"

function makeTool(
  contribution: PluginToolCompat.Contribution,
  services: {
    readonly bridge: EffectBridge.Shape
    readonly permission: PermissionV2.Interface
    readonly progress: ToolProgress.Interface
    readonly directory: string
    readonly worktree: string
  },
) {
  const execute = contribution.definition.execute as (
    input: unknown,
    context: PluginToolContext,
  ) => Promise<unknown>

  return Tool.make({
    description: contribution.description,
    input: contribution.parameters,
    output: Result,
    structured: Structured,
    jsonSchema: { input: contribution.jsonSchema as JsonSchema.JsonSchema },
    toStructuredOutput: ({ output }) => ({
      ...(output.metadata ?? {}),
      ...(output.title === undefined ? {} : { title: output.title }),
    }),
    toModelOutput: ({ output }) => [
      { type: "text", text: output.output },
      ...(output.attachments ?? []).map((attachment) => ({
        type: "file" as const,
        uri: attachment.url,
        mime: attachment.mime,
        name: attachment.filename,
      })),
    ],
    execute: (input, context) => {
      return Effect.callback<unknown, Tool.Failure>((resume, signal) => {
        const result = Promise.resolve().then(() => {
          const pluginContext: RuntimePluginToolContext = {
            sessionID: context.sessionID,
            messageID: context.assistantMessageID,
            callID: context.toolCallID,
            agent: context.agent,
            directory: services.directory,
            worktree: services.worktree,
            abort: signal,
            metadata(update) {
              void services.bridge.fork(
                services.progress.publish(context, {
                  structured: {
                    ...(update.metadata ?? {}),
                    ...(update.title === undefined ? {} : { title: update.title }),
                  },
                  content: [],
                }),
              )
            },
            ask(request) {
              const permissionFiber = services.bridge.fork(
                services.permission
                  .assert({
                    sessionID: context.sessionID,
                    agent: context.agent,
                    action: request.permission,
                    resources: request.patterns,
                    save: request.always,
                    metadata: request.metadata,
                    source: {
                      type: "tool",
                      messageID: context.assistantMessageID,
                      callID: context.toolCallID,
                    },
                  })
                  .pipe(Effect.mapError((error) => permissionFailure(error, request.permission))),
              )
              const interrupt = () => {
                void services.bridge.fork(Fiber.interrupt(permissionFiber))
              }
              if (signal.aborted) interrupt()
              else signal.addEventListener("abort", interrupt, { once: true })
              return services.bridge
                .promise(Fiber.await(permissionFiber))
                .then((exit) => {
                  if (Exit.isFailure(exit)) throw new PermissionBridgeFailure(exit.cause)
                })
                .finally(() => signal.removeEventListener("abort", interrupt))
            },
          }
          return execute(input, pluginContext)
        })
        result.then(
          (value) => resume(Effect.succeed(value)),
          (error) =>
            resume(
              error instanceof PermissionBridgeFailure
                ? Effect.failCause(error.cause)
                : Effect.fail(new Tool.Failure({ message: errorMessage(error) })),
            ),
        )
        return Effect.promise(() => result.then(() => undefined, () => undefined))
      }).pipe(
        Effect.flatMap((result) =>
          Effect.try({
            try: () => normalizeResult(result),
            catch: (error) => new Tool.Failure({ message: errorMessage(error) }),
          }),
        ),
        Effect.withSpan("PluginToolCompatV2.execute", {
          attributes: {
            "tool.name": contribution.id,
            "session.id": context.sessionID,
            "message.id": context.assistantMessageID,
            "tool.call_id": context.toolCallID,
          },
        }),
      )
    },
  })
}

function permissionFailure(error: unknown, action: string) {
  if (error instanceof PermissionV2.CorrectedError) return new Tool.Failure({ message: error.feedback })
  if (error instanceof PermissionV2.BlockedError)
    return new Tool.Failure({ message: `Permission denied: ${action}` })
  return new Tool.Failure({ message: errorMessage(error) })
}

function normalizeResult(value: unknown): Schema.Schema.Type<typeof Result> {
  if (typeof value === "string") return { output: value }
  if (!isRecord(value) || typeof value.output !== "string")
    throw new TypeError("Plugin tool returned an invalid result")
  if (value.title !== undefined && typeof value.title !== "string")
    throw new TypeError("Plugin tool title must be a string")
  if (value.metadata !== undefined && !isRecord(value.metadata))
    throw new TypeError("Plugin tool metadata must be an object")
  if (value.attachments !== undefined && !Array.isArray(value.attachments))
    throw new TypeError("Plugin tool attachments must be an array")
  const attachments = value.attachments?.map((attachment) => {
    if (
      !isRecord(attachment) ||
      attachment.type !== "file" ||
      typeof attachment.mime !== "string" ||
      typeof attachment.url !== "string" ||
      (attachment.filename !== undefined && typeof attachment.filename !== "string")
    )
      throw new TypeError("Plugin tool attachment is invalid")
    return {
      type: "file" as const,
      mime: attachment.mime,
      url: attachment.url,
      ...(attachment.filename === undefined ? {} : { filename: attachment.filename }),
    }
  })
  return {
    output: value.output,
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
    ...(attachments === undefined ? {} : { attachments }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Plugin.node, PluginToolCompat.node, LocationServiceMap.node, ToolProgress.node],
})

export * as PluginToolCompatV2 from "./plugin-compat-v2"
