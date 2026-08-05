export * as ToolRegistry from "./registry"

import { ToolDefinition, ToolOutput, type ToolCall, type ToolContent, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Scope } from "effect"
import { AgentV2 } from "../agent"
import { truthy } from "../flag/flag"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { PluginRuntime } from "../plugin/runtime"
import { ProviderV2 } from "../provider"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { ApplicationTools } from "./application-tools"
import {
  definition,
  permission,
  settle,
  validateName,
  type AnyTool,
  type ExecutionError,
  type Failure,
  type RegistrationError,
} from "./tool"
import { Tools } from "./tools"
import { makeLocationNode } from "../effect/app-node"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

export type SettlementError = ToolOutputStore.Error | Exclude<ExecutionError, Failure>

export interface Interface {
  readonly materialize: (
    permissions?: PermissionV2.Ruleset,
    overrides?: Readonly<Record<string, boolean>>,
    context?: MaterializationContext,
  ) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, SettlementError>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export interface MaterializationContext {
  readonly model: {
    readonly providerID: ProviderV2.ID
    readonly modelID: ModelV2.ID
  }
  readonly features?: Partial<MaterializationFeatures>
}

export interface MaterializationFeatures {
  readonly client: string
  readonly enableExa: boolean
  readonly enableParallel: boolean
  readonly question: boolean
  readonly codeMode: boolean
  readonly lsp: boolean
  readonly plan: boolean
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

const BUILTIN_TASK_AGENT_TYPES = ["general", "explore", "research", "worker"] as const

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const applications = yield* ApplicationTools.Service
    const resources = yield* ToolOutputStore.Service
    const plugins = yield* PluginRuntime.Service
    const agents = yield* AgentV2.Service
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised?: object) {
      const registration =
        local.get(input.call.name)?.at(-1)?.registration ?? applications.entries().get(input.call.name)
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }

      const args = PluginRuntime.mutable(input.call.input)
      yield* plugins.run(PluginRuntime.HookName.toolExecuteBefore, {
        tool: input.call.name,
        sessionID: input.sessionID,
        callID: input.call.id,
        args: args.value,
      })
      const call = { ...input.call, input: args.get() }
      const pending = yield* settle(registration.tool, call, {
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
      }).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      if ("result" in pending) return pending

      const initial = pending.output
      const legacyOutput =
        initial.content.length === 1 && initial.content[0]?.type === "text"
          ? initial.content[0].text
          : initial.structured
      const result = PluginRuntime.mutable({
        title: undefined as string | undefined,
        output: legacyOutput,
        metadata: initial.structured,
      })
      yield* plugins.run(PluginRuntime.HookName.toolExecuteAfter, {
        tool: input.call.name,
        sessionID: input.sessionID,
        callID: input.call.id,
        args: args.get(),
        result: result.value,
      })
      const transformed = result.get()
      const output: ToolOutput = {
        structured:
          transformed.title === undefined
            ? transformed.metadata
            : {
                ...(transformed.metadata as Record<string, unknown>),
                title: transformed.title,
              },
        content:
          transformed.output === legacyOutput
            ? initial.content
            : typeof transformed.output === "string"
              ? replaceText(initial.content, transformed.output)
              : initial.content,
      }
      const bounded = yield* resources.bound({ sessionID: input.sessionID, toolCallID: input.call.id, output })
      const value = ToolOutput.toResultValue(bounded.output)
      if (value.type === "error")
        return bounded.outputPaths.length > 0 ? { result: value, outputPaths: bounded.outputPaths } : { result: value }
      return bounded.outputPaths.length > 0
        ? { result: value, output: bounded.output, outputPaths: bounded.outputPaths }
        : { result: value, output: bounded.output }
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools) {
        const entries = Object.entries(tools)
        if (entries.length === 0) return
        yield* Effect.forEach(entries, ([name]) => validateName(name), { discard: true })
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [...(local.get(name) ?? []), { token, registration: { identity: {}, tool } }])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (permissions = [], overrides = {}, context) {
        const registrations = new Map(applications.entries())
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        const advertised = new Map<string, Registration>()
        const definitions: ToolDefinition[] = []
        for (const [name, registration] of registrations) {
          if (overrides[name] === false) continue
          if (context && !visible(name, context)) continue
          if (whollyDisabled(permission(registration.tool, name), permissions)) continue
          const current = definition(name, registration.tool, permissions)
          if (!current) continue
          const taskAgentTypes =
            name === "task"
              ? [
                  ...new Set([
                    ...BUILTIN_TASK_AGENT_TYPES,
                    ...(yield* agents.all())
                      .filter((agent) => agent.mode !== "primary" && !agent.hidden)
                      .map((agent) => agent.id),
                  ]),
                ].toSorted()
              : undefined
          const taskDescription = taskAgentTypes
            ? `\n\nAvailable task agent identifiers (use exact names): ${taskAgentTypes.map((agent) => `\`${agent}\``).join(", ")}`
            : ""
          const value = PluginRuntime.mutable({
            description: `${current.description}${taskDescription}`,
            parameters: current.inputSchema as unknown,
          })
          yield* plugins.run(PluginRuntime.HookName.toolDefinition, {
            toolID: name,
            definition: value.value,
          })
          const transformed = value.get()
          advertised.set(name, registration)
          definitions.push(
            transformed.description === current.description && transformed.parameters === current.inputSchema
              ? current
              : new ToolDefinition({
                  ...current,
                  description: transformed.description,
                  inputSchema: transformed.parameters as ToolDefinition["inputSchema"],
                }),
          )
        }
        return {
          definitions,
          settle: (input) => {
            const registration = advertised.get(input.call.name)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
          },
        }
      }),
    })
  }),
)

function replaceText(content: ReadonlyArray<ToolContent>, text: string): ReadonlyArray<ToolContent> {
  const indexes = content.flatMap((part, index) => (part.type === "text" ? [index] : []))
  if (indexes.length === 1) {
    const target = indexes[0]!
    return content.map((part, index) => (index === target && part.type === "text" ? { ...part, text } : part))
  }
  const files = content.filter((part) => part.type === "file")
  if (indexes.length === 0) return [{ type: "text", text }, ...files]
  const first = indexes[0]!
  return content.flatMap((part, index): ReadonlyArray<ToolContent> => {
    if (index === first) return [{ type: "text" as const, text }]
    return part.type === "text" ? [] : [part]
  })
}

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) => Effect.succeed(Tools.Service.of({ register: registry.register }))),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export function visible(name: string, context: MaterializationContext) {
  const features = { ...materializationFeatures(), ...context.features }
  if (name === "websearch")
    return (
      context.model.providerID === ProviderV2.ID.opencode || features.enableExa || features.enableParallel
    )

  const usePatch =
    context.model.modelID.includes("gpt-") &&
    !context.model.modelID.includes("oss") &&
    !context.model.modelID.includes("gpt-4")
  if (name === "apply_patch") return usePatch
  if (name === "edit" || name === "write") return !usePatch
  if (name === "question")
    return ["app", "cli", "desktop"].includes(features.client) || features.question
  if (name === "execute") return features.codeMode
  if (name === "lsp") return features.lsp
  if (name === "plan_exit") return features.plan && features.client === "cli"
  return true
}

function materializationFeatures(): MaterializationFeatures {
  const experimental = (name: string) =>
    process.env[name] === undefined ? truthy("OPENCODE_EXPERIMENTAL") : truthy(name)
  return {
    client: process.env.OPENCODE_CLIENT ?? "cli",
    enableExa:
      truthy("OPENCODE_EXPERIMENTAL") ||
      truthy("OPENCODE_ENABLE_EXA") ||
      truthy("OPENCODE_EXPERIMENTAL_EXA"),
    enableParallel: truthy("OPENCODE_ENABLE_PARALLEL") || truthy("OPENCODE_EXPERIMENTAL_PARALLEL"),
    question: truthy("OPENCODE_ENABLE_QUESTION_TOOL"),
    codeMode: experimental("OPENCODE_EXPERIMENTAL_CODE_MODE"),
    lsp: experimental("OPENCODE_EXPERIMENTAL_LSP_TOOL"),
    plan: experimental("OPENCODE_EXPERIMENTAL_PLAN_MODE"),
  }
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ApplicationTools.node, AgentV2.node, PluginRuntime.node, ToolOutputStore.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [ApplicationTools.node, AgentV2.node, PluginRuntime.node, ToolOutputStore.node],
})
