import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { llmClient } from "@opencode-ai/core/effect/app-node-platform"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { CatalogSnapshot } from "@opencode-ai/core/catalog-snapshot"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PluginV1Projection } from "@opencode-ai/core/plugin/v1-projection"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Provider } from "@/compat/provider-wire"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionStore } from "@opencode-ai/core/session/store"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import type { LLMEvent } from "@opencode-ai/llm"
import { LLMClient } from "@opencode-ai/llm/route"
import type { LLMClientService } from "@opencode-ai/llm/route"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import type { LegacyAgentInfo } from "@/compat/agent-wire"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { LegacyPermissionRules } from "@/permission/legacy-rules"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { AuthWire } from "@/compat/auth-wire"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { LLMAISDK } from "./llm/ai-sdk"
import { LLMNativeRuntime } from "./llm/native-runtime"
import { LLMRequestPrep } from "./llm/request"
import { legacyProvidersFromNative } from "@/compat/native-v1-catalog"
import { InstanceState } from "@/effect/instance-state"

export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

export type StreamInput = {
  user: SessionV1.User
  sessionID: string
  parentSessionID?: string
  model: Provider.Model
  agent: LegacyAgentInfo
  permission?: PermissionV1.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  toolChoice?: "auto" | "required" | "none"
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<LLMEvent, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

export const use = serviceUse(Service)

export const requestWorkflowApproval = Effect.fn("LLM.requestWorkflowApproval")(function* (input: {
  sessionID: string
  approvalTools: ReadonlyArray<{ name: string; args: string }>
}) {
  const sessions = yield* SessionStore.Service
  const locations = yield* LocationServiceMap.Service
  const session = yield* sessions.get(SessionID.make(input.sessionID))
  if (!session) return { approved: false as const }
  const decode = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
  const uniquePatterns = [
    ...new Set(
      input.approvalTools.map((tool) => {
        const parsed = decode(tool.args)
        if (Option.isNone(parsed)) return tool.name
        const value = parsed.value
        if (typeof value !== "object" || value === null) return tool.name
        const record = value as Record<string, unknown>
        const title =
          typeof record.title === "string" && record.title
            ? record.title
            : typeof record.name === "string" && record.name
              ? record.name
              : ""
        return title ? `${tool.name}: ${title}` : tool.name
      }),
    ),
  ]
  return yield* Effect.gen(function* () {
    const permission = yield* PermissionV2.Service
    yield* permission.assert({
      sessionID: SessionID.make(input.sessionID),
      action: "workflow_tool_approval",
      resources: uniquePatterns,
      save: uniquePatterns,
      metadata: { tools: input.approvalTools },
      // source 省略：唯一合法 Source 為 {type:"tool", messageID, callID}，多工具 workflow 無法真實提供。
    })
    return { approved: true as const }
  }).pipe(
    Effect.provide(locations.get(session.location)),
    Effect.catchTag("PermissionV2.BlockedError", () => Effect.succeed({ approved: false as const })),
    Effect.catchTag("PermissionV2.CorrectedError", (error) =>
      Effect.logDebug("workflow tool approval corrected", { feedback: error.feedback }).pipe(
        Effect.as({ approved: false as const }),
      ),
    ),
    Effect.catchTag("Session.NotFoundError", () => Effect.succeed({ approved: false as const })),
    Effect.catchDefect((defect) =>
      defect instanceof PermissionV2.DeclinedError ? Effect.succeed({ approved: false as const }) : Effect.die(defect),
    ),
  )
})

const live: Layer.Layer<
  Service,
  never,
  | Config.Service
  | LocationServiceMap.Service
  | Plugin.Service
  | LLMClientService
  | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const locations = yield* LocationServiceMap.Service
    const plugin = yield* Plugin.Service
    const llmClient = yield* LLMClient.Service
    const flags = yield* RuntimeFlags.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const location = locations.get(
        Location.Ref.make({
          directory: AbsolutePath.make(ctx.directory),
          ...(workspaceID === undefined ? {} : { workspaceID }),
        }),
      )
      const [catalog, snapshot, aisdk, integrations] = yield* Effect.all([
        Catalog.Service,
        CatalogSnapshot.Service,
        AISDK.Service,
        Integration.Service,
      ]).pipe(Effect.provide(location))
      const providerID = input.model.providerID
      const modelID = input.model.id
      const available = yield* catalog.model.available()
      const canonical = available.find(
        (model) => model.providerID === providerID && model.id === modelID,
      )
      const nativeCatalog = yield* snapshot.get()
      const projectedProvider = legacyProvidersFromNative(nativeCatalog).providers.find(
        (provider) => provider.id === providerID,
      )
      if (!canonical || !projectedProvider) {
        return yield* new Provider.ModelNotFoundError({
          providerID,
          modelID,
          suggestions: available
            .filter((model) => model.providerID === providerID)
            .map((model) => model.id)
            .slice(0, 3),
        })
      }
      const model = legacyModel(PluginV1Projection.model(canonical))
      const item = legacyProvider(projectedProvider)

      yield* Effect.logInfo("stream", {
        providerID: model.providerID,
        modelID: model.id,
        "session.id": input.sessionID,
        small: (input.small ?? false).toString(),
        agent: input.agent.name,
        mode: input.agent.mode,
      })

      const [language, cfg] = yield* Effect.all(
        [aisdk.language(canonical), config.get()],
        { concurrency: "unbounded" },
      )
      const provider = yield* catalog.provider.get(providerID)
      const connection = yield* integrations.connection.active(
        provider?.integrationID ?? Integration.ID.make(providerID),
      )
      const credential = connection ? yield* integrations.connection.resolve(connection) : undefined
      const info = credential ? AuthWire.fromCredential(credential) : undefined

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const prepared = yield* LLMRequestPrep.prepare({
        ...input,
        model,
        provider: item,
        auth: info,
        plugin,
        flags,
        isWorkflow,
      })

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      const bridge = yield* EffectBridge.make()
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = prepared.system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = prepared.tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: any) {
            return { result: "", error: e.message ?? String(e) }
          }
        }

        const ruleset = LegacyPermissionRules.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(prepared.tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = bridge.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }
          const result = await bridge.promise(
            requestWorkflowApproval({ sessionID: input.sessionID, approvalTools }),
          )
          if (!result.approved) return { approved: false }
          for (const name of uniqueNames) approvedToolsForSession.add(name)
          workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
          return { approved: true }
        })
      }

      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined
      const telemetryTracer = tracer
        ? new Proxy(tracer, {
            get(target, prop, receiver) {
              if (prop !== "startSpan") return Reflect.get(target, prop, receiver)
              return (...args: Parameters<typeof target.startSpan>) => {
                const span = target.startSpan(...args)
                span.setAttribute("session.id", input.sessionID)
                return span
              }
            },
          })
        : undefined

      // Runtime seam: native is an opt-in adapter over @opencode-ai/llm. It
      // either returns a ready LLMEvent stream or a concrete fallback reason.
      if (flags.experimentalNativeLlm) {
        const native = LLMNativeRuntime.stream({
          model,
          provider: item,
          auth: info,
          llmClient,
          messages: prepared.messages,
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          maxOutputTokens: prepared.params.maxOutputTokens,
          providerOptions: prepared.params.options,
          headers: prepared.headers,
          abort: input.abort,
        })
        if (native.type === "supported") {
          yield* Effect.logInfo("llm runtime selected", {
            "llm.runtime": "native",
            "llm.provider": model.providerID,
            "llm.model": model.id,
          })
          return {
            type: "native" as const,
            stream: native.stream,
          }
        }
        yield* Effect.logInfo("llm runtime selected", {
          "llm.runtime": "ai-sdk",
          "llm.provider": model.providerID,
          "llm.model": model.id,
          "llm.native_unsupported_reason": native.reason,
        })
        yield* Effect.logInfo("native runtime unavailable; falling back to ai-sdk", {
          providerID: model.providerID,
          modelID: model.id,
          "session.id": input.sessionID,
          small: (input.small ?? false).toString(),
          agent: input.agent.name,
          mode: input.agent.mode,
          reason: native.reason,
        })
      }

      yield* Effect.logInfo("llm runtime selected", {
        "llm.runtime": "ai-sdk",
        "llm.provider": model.providerID,
        "llm.model": model.id,
      })
      // Default runtime path: AI SDK owns provider execution and tool dispatch;
      // LLMAISDK.toLLMEvents below normalizes fullStream parts for the processor.
      return {
        type: "ai-sdk" as const,
        result: streamText({
          onError(error) {
            bridge.fork(
              Effect.logError("stream error", {
                providerID: model.providerID,
                modelID: model.id,
                "session.id": input.sessionID,
                small: (input.small ?? false).toString(),
                agent: input.agent.name,
                mode: input.agent.mode,
                error,
              }),
            )
          },
          // Copilot returns the authoritative billed amount only in provider-specific response fields.
          includeRawChunks: model.providerID.includes("github-copilot"),
          async experimental_repairToolCall(failed) {
            const lower = failed.toolCall.toolName.toLowerCase()
            if (lower !== failed.toolCall.toolName && prepared.tools[lower]) {
              return {
                ...failed.toolCall,
                toolName: lower,
              }
            }
            return {
              ...failed.toolCall,
              input: JSON.stringify({
                tool: failed.toolCall.toolName,
                error: failed.error.message,
              }),
              toolName: "invalid",
            }
          },
          temperature: prepared.params.temperature,
          topP: prepared.params.topP,
          topK: prepared.params.topK,
          providerOptions: ProviderTransform.providerOptions(model, prepared.params.options),
          activeTools: Object.keys(prepared.tools).filter((x) => x !== "invalid"),
          tools: prepared.tools,
          toolChoice: input.toolChoice,
          maxOutputTokens: prepared.params.maxOutputTokens,
          abortSignal: input.abort,
          headers: prepared.headers,
          maxRetries: input.retries ?? 0,
          messages: prepared.messages,
          model: wrapLanguageModel({
            model: language,
            middleware: [
              {
                specificationVersion: "v3" as const,
                async transformParams(args) {
                  if (args.type === "stream") {
                    // @ts-expect-error
                    args.params.prompt = ProviderTransform.message(
                      args.params.prompt,
                      model,
                      prepared.messageTransformOptions,
                    )
                  }
                  return args.params
                },
              },
            ],
          }),
          experimental_telemetry: {
            isEnabled: cfg.experimental?.openTelemetry,
            functionId: "session.llm",
            tracer: telemetryTracer,
            metadata: {
              userId: cfg.username ?? "unknown",
              sessionId: input.sessionID,
            },
          },
        }),
        providerID: model.providerID,
      }
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            if (result.type === "native") return result.stream

            // Adapter seam: both runtimes expose the same LLMEvent stream. Native
            // already returns one; AI SDK streams are converted here.
            const state = LLMAISDK.adapterState()
            return Stream.fromAsyncIterable(result.result.fullStream, (e) =>
              e instanceof Error ? e : new Error(String(e)),
            ).pipe(
              Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event, result.providerID)),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            )
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const hasToolCalls = LLMRequestPrep.hasToolCalls

function legacyModel(input: ReturnType<typeof PluginV1Projection.model>): Provider.Model {
  return {
    ...input,
    id: ModelV2.ID.make(input.id),
    providerID: ProviderV2.ID.make(input.providerID),
  }
}

function legacyProvider(input: ReturnType<typeof legacyProvidersFromNative>["providers"][number]): Provider.Info {
  return {
    ...input,
    id: ProviderV2.ID.make(input.id),
    models: Object.fromEntries(Object.entries(input.models).map(([id, model]) => [id, legacyModel(model)])),
  }
}

export const node = LayerNode.make({
  service: Service,
  layer: live,
  deps: [
    Config.node,
    LocationServiceMap.node,
    Plugin.node,
    llmClient,
    RuntimeFlags.node,
  ],
})

export * as LLM from "./llm"
