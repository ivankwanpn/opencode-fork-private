import { EOL } from "os"
import { basename } from "path"
import { Cause, DateTime, Effect } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { ModelV2 } from "@opencode-ai/core/model"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { createLLMEventPublisher } from "@opencode-ai/core/session/runner/publish-llm-event"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { iife } from "../../../util/iife"
import { fail } from "../../effect-cmd"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"

export const debugAgent = Effect.fn("Cli.debug.agent")(function* (args: {
  name: string
  tool?: string
  params?: string
}) {
  const ctx = yield* InstanceRef
  if (!ctx) return
  const workspaceID = yield* WorkspaceRef
  const location = Location.Ref.make({
    directory: AbsolutePath.make(ctx.directory),
    ...(workspaceID === undefined ? {} : { workspaceID }),
  })
  const locations = yield* LocationServiceMap.Service
  return yield* run(args, location).pipe(Effect.provide(locations.get(location)))
})

const run = Effect.fn("Cli.debug.agent.body")(function* (
  args: { name: string; tool?: string; params?: string },
  location: Location.Ref,
) {
  const agents = yield* AgentV2.Service
  const agent = yield* agents.get(AgentV2.ID.make(args.name))
  if (!agent) {
    process.stderr.write(
      `Agent ${args.name} not found, run '${basename(process.execPath)} agent list' to get an agent list` + EOL,
    )
    return yield* fail("", 1)
  }

  const catalog = yield* Catalog.Service
  const selectedModel = agent.model ?? (yield* catalog.model.default())
  if (!selectedModel) return yield* fail("No models found")
  const model =
    agent.model ??
    ModelV2.Ref.make({
      providerID: selectedModel.providerID,
      id: selectedModel.id,
    })
  const registry = yield* ToolRegistry.Service
  const context = { model: { providerID: model.providerID, modelID: model.id } }
  const all = yield* registry.materialize([], {}, context)
  const available = yield* registry.materialize(agent.permissions, {}, context)
  const enabled = new Set(available.definitions.map((item) => item.name))
  const resolvedTools = Object.fromEntries(all.definitions.map((item) => [item.name, enabled.has(item.name)]))
  const toolID = args.tool
  if (toolID) {
    if (!all.definitions.some((item) => item.name === toolID)) {
      process.stderr.write(`Tool ${toolID} not found for agent ${args.name}` + EOL)
      return yield* fail("", 1)
    }
    if (!enabled.has(toolID)) {
      process.stderr.write(`Tool ${toolID} is disabled for agent ${args.name}` + EOL)
      return yield* fail("", 1)
    }
    const params = parseToolParams(args.params)
    const session = yield* SessionV2.Service.use((sessions) =>
      sessions.create({
        title: `Debug tool run (${agent.id})`,
        agent: agent.id,
        model,
        location,
      }),
    )
    const events = yield* EventV2.Service
    const assistantMessageID = SessionMessage.ID.create()
    const call = LLMEvent.toolCall({ id: EventV2.ID.create(), name: toolID, input: params })
    const publisher = createLLMEventPublisher(events, {
      sessionID: session.id,
      agent: agent.id,
      model,
      assistantMessageID,
    })
    yield* publisher.publish(call)
    const result = yield* available.settle({ sessionID: session.id, agent: agent.id, assistantMessageID, call }).pipe(
      Effect.tapCause((cause) => {
        const error = Cause.squash(cause)
        const message = error instanceof Error ? error.message : String(error)
        return publisher
          .publish(LLMEvent.toolError({ id: call.id, name: call.name, message, error }))
          .pipe(Effect.andThen(publisher.failAssistant(message)))
      }),
      Effect.catch((error) => fail(error instanceof Error ? error.message : String(error))),
    )
    yield* publisher.publish(
      LLMEvent.toolResult({
        id: call.id,
        name: call.name,
        result: result.result,
        output: result.output,
      }),
      result.outputPaths,
    )
    yield* events.publish(SessionEvent.Step.Ended, {
      sessionID: session.id,
      timestamp: yield* DateTime.now,
      assistantMessageID,
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    process.stdout.write(JSON.stringify({ tool: toolID, input: params, result }, null, 2) + EOL)
    return
  }

  const output = {
    ...agent,
    tools: resolvedTools,
  }
  process.stdout.write(JSON.stringify(output, null, 2) + EOL)
})

function parseToolParams(input?: string) {
  if (!input) return {}
  const trimmed = input.trim()
  if (trimmed.length === 0) return {}

  const parsed = iife(() => {
    try {
      return JSON.parse(trimmed)
    } catch (jsonError) {
      try {
        return new Function(`return (${trimmed})`)()
      } catch (evalError) {
        throw new Error(
          `Failed to parse --params. Use JSON or a JS object literal. JSON error: ${jsonError}. Eval error: ${evalError}.`,
          { cause: evalError },
        )
      }
    }
  })

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool params must be an object.")
  }
  return parsed as Record<string, unknown>
}
