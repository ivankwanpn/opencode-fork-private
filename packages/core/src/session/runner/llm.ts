import {
  LLM,
  LLMClient,
  LLMError,
  LLMEvent,
  LLMRequest,
  Message,
  SystemPart,
  ToolDefinition,
  mergeGenerationOptions,
  mergeJsonRecords,
  isContextOverflowFailure,
  type ProviderErrorEvent,
} from "@opencode-ai/llm"
import { WebSocketPool } from "@opencode-ai/llm/route"
import type { UserMessage } from "@opencode-ai/sdk/v2/types"
import { Cause, Clock, DateTime, Effect, FiberSet, Layer, Option, Semaphore, Stream } from "effect"
import { AgentV2 } from "../../agent"
import { Config } from "../../config"
import { InstructionContext } from "../../instruction-context"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { FSUtil } from "../../fs-util"
import { Location } from "../../location"
import { MCP } from "../../mcp/runtime"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { PluginRuntime } from "../../plugin/runtime"
import { ProviderV2 } from "../../provider"
import { QuestionV2 } from "../../question"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SkillGuidance } from "../../skill/guidance"
import { ReferenceGuidance } from "../../reference/guidance"
import { ToolRegistry } from "../../tool/registry"
import { ToolCatalog } from "../../tool/catalog"
import { ToolSearch } from "../../tool/tool-search"
import { SessionContextEpoch } from "../context-epoch"
import { SessionAttempt } from "../attempt"
import { SessionAttachment } from "../attachment"
import { SessionCompaction } from "../compaction"
import { SessionCommand } from "../command"
import { SessionEvent } from "../event"
import { SessionHistory } from "../history"
import { SessionMessage } from "../message"
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../prompt"
import { SessionInput } from "../input"
import { SessionTurn } from "../turn"
import { SessionReminder } from "../reminder"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionStopHook } from "../stop-hook"
import { type RunError, Service } from "./index"
import { SessionRunnerModel } from "./model"
import { SessionRunnerRequestPolicy } from "./request-policy"
import { SessionRunnerToolResultPreparation } from "./tool-result-preparation"
import { createLLMEventPublisher } from "./publish-llm-event"
import { fromPluginMessages, toLLMMessages, toPluginMessages } from "./to-llm-message"
import { MAX_STEPS_PROMPT } from "./max-steps"
import { SessionRunnerSystem } from "./system"
import { Snapshot } from "../../snapshot"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"

/**
 * Runs one durable coding-agent Session until it settles.
 *
 * Keep this as orchestration over smaller collaborators rather than rebuilding the legacy
 * `SessionPrompt` monolith. Implement the unchecked items in small reviewed slices:
 *
 * - Session ownership and controls
 *   - [x] Coordinate one local active drain per Session; explicit resumes join and prompt wakeups coalesce.
 *   - [ ] Replace local ownership with durable multi-node ownership when clustered.
 *   - [ ] Mark busy, retrying, idle, interrupted, or terminal-failure status durably.
 *   - [ ] Honor interruption and reject stale work after runtime attachment replacement.
 *   - [x] Honor optional agent step limits.
 *   - [x] Bound provider retries and repeated identical tool calls.
 *
 * - Runtime context assembly
 *   - Track V1 runtime-context parity canonically in `specs/v2/session.md`.
 *
 * - One provider turn
 *   - [x] Translate every projected V2 Session message variant into canonical
 *     `@opencode-ai/llm` messages.
 *   - [ ] Resolve policy-filtered built-in, MCP, plugin, and structured-output tool definitions.
 *   - [x] Stream exactly one `llm.stream(request)` provider turn.
 *   - [x] Persist assistant text and usage events incrementally as they arrive.
 *   - [ ] Persist snapshots, patches, and retry notices incrementally as they arrive.
 *   - [x] Persist reasoning, provider errors, and tool-call events incrementally as they arrive.
 *
 * - Tool settlement and continuation
 *   - [x] Durably record each tool call before side effects begin.
 *   - [x] Authorize and execute recorded local calls through a core-owned registry hook.
 *   - [x] Persist typed success, failure, and provider-executed tool outcomes.
 *   - [x] Start each recorded local call eagerly and await all settlements before continuation.
 *   - [ ] Add scoped runtime context, progress updates, attachment normalization,
 *     plugins, and cancellation settlement.
 *   - [x] Reload projected history and start the next explicit provider turn after local tool results.
 *   - [x] Continue for durable user steering accepted during an active provider turn.
 *   - [ ] Continue for compaction or another continuation condition when required.
 *
 * - Post-run maintenance
 *   - [ ] Settle final status and expose durable output events to replayable consumers.
 *   - [ ] Coalesce streamed deltas and add covering projected-history indexes.
 *   - [ ] Update title, summaries, compaction state, and cleanup in bounded background work.
 *
 * Use `llm.stream(request)` for each provider turn. Keep tool execution and continuation here.
 * Durable provider attempts distinguish safe continuation from ambiguous post-crash work and bound automatic retry.
 *
 * The current slice loads V2 history, translates it, resolves a model through a core service, and persists one
 * provider turn. Registry definitions are advertised, local tool calls are settled durably, and an
 * explicit loop starts the next provider turn after local settlement. Configured agent step limits bound the loop.
 */

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const MAX_IDENTICAL_TOOL_FAILURES = 2
type ToolFailureTracker = Map<string, number>

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const agents = yield* AgentV2.Service
    const tools = yield* ToolRegistry.Service
    const models = yield* SessionRunnerModel.Service
    const plugins = yield* PluginRuntime.Service
    const store = yield* SessionStore.Service
    const commands = yield* SessionCommand.Service
    const attachments = yield* SessionAttachment.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const mcp = yield* MCP.Service
    const systemContext = yield* SystemContextRegistry.Service
    const nestedInstructionContext = yield* InstructionContext.NestedService
    const skillGuidance = yield* SkillGuidance.Service
    const referenceGuidance = yield* ReferenceGuidance.Service
    const config = yield* Config.Service
    const snapshots = yield* Snapshot.Service
    const db = (yield* Database.Service).db
    const compaction = SessionCompaction.make({
      events,
      llm,
      plugins,
      config: yield* config.entries(),
    })
    const getSession = Effect.fn("SessionRunner.getSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
      return session
    })

    const getContext = Effect.fn("SessionRunner.getContext")(function* (sessionID: SessionSchema.ID) {
      return yield* store.context(sessionID)
    })
    const failInterruptedTools = Effect.fn("SessionRunner.failInterruptedTools")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* getContext(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "pending" && tool.state.status !== "running")) continue
          yield* events.publish(SessionEvent.Tool.Failed, {
            sessionID,
            timestamp: yield* DateTime.now,
            assistantMessageID: message.id,
            callID: tool.id,
            error: { type: "unknown", message: "Tool execution interrupted" },
            provider: {
              executed: tool.provider?.executed === true,
              ...(tool.provider?.metadata === undefined ? {} : { metadata: tool.provider.metadata }),
            },
          })
        }
      }
    })

    const awaitToolFibers = (fibers: FiberSet.FiberSet<void, ToolRegistry.SettlementError>) =>
      Effect.raceFirst(FiberSet.join(fibers), FiberSet.awaitEmpty(fibers))

    // Match V1: declining a user prompt halts the loop instead of becoming model-facing tool output.
    const isUserDeclined = (cause: Cause.Cause<unknown>) =>
      cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) &&
          (reason.defect instanceof PermissionV2.DeclinedError || reason.defect instanceof QuestionV2.RejectedError),
      )

    type PhysicalAttempt = {
      readonly attempt: number
      readonly retryOf?: EventV2.ID
    }

    type TurnTransition =
      // Automatic compaction completed; rebuild the request from compacted history.
      | { readonly _tag: "ContinueAfterCompaction"; readonly step: number }
      // Overflow compaction completed; rebuild once through the path without overflow recovery.
      | { readonly _tag: "ContinueAfterOverflowCompaction"; readonly step: number }
      // A durable retry notice authorized one bounded replacement attempt.
      | { readonly _tag: "RetryProvider"; readonly step: number; readonly physical: PhysicalAttempt }

    class TurnTransitionError extends Error {
      constructor(readonly transition: TurnTransition) {
        super()
      }
    }

    const continueAfterCompaction = (step: number) => new TurnTransitionError({ _tag: "ContinueAfterCompaction", step })
    const continueAfterOverflowCompaction = (step: number) =>
      new TurnTransitionError({ _tag: "ContinueAfterOverflowCompaction", step })
    const retryProvider = (step: number, physical: PhysicalAttempt) =>
      new TurnTransitionError({ _tag: "RetryProvider", step, physical })

    const MAX_PROVIDER_ATTEMPTS = 3
    const retryDelay = (attempt: number, error?: LLMError) =>
      Math.min(error?.retryAfterMs ?? 500 * 2 ** Math.max(0, attempt - 1), 10_000)
    const llmFailureMessage = (failure: LLMError) => {
      const reason = failure.reason
      const http = "http" in reason ? reason.http : undefined
      if (!http) return reason.message
      return [
        reason.message,
        `Request: ${http.request.method} ${http.request.url}`,
        http.response && !reason.message.includes(`HTTP ${http.response.status}`)
          ? `Status: HTTP ${http.response.status}`
          : undefined,
        http.requestId ? `Request ID: ${http.requestId}` : undefined,
        http.body && !reason.message.includes(http.body)
          ? `Response body${http.bodyTruncated ? " (truncated)" : ""}: ${http.body}`
          : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n")
    }
    const retryError = (failure: LLMError | ProviderErrorEvent): SessionEvent.RetryError => {
      if (!(failure instanceof LLMError))
        return {
          message: failure.message,
          isRetryable: failure.retryable === true,
        }
      const reason = failure.reason
      const http = "http" in reason ? reason.http : undefined
      return {
        message: llmFailureMessage(failure),
        statusCode: http?.response?.status,
        isRetryable: failure.retryable,
        responseHeaders: http?.response?.headers,
        responseBody: http?.body,
        metadata: { type: reason._tag },
      }
    }

    const loadSystemContext = (agent: AgentV2.Selection, sessionID: SessionSchema.ID) =>
      Effect.all(
        [
          systemContext.load(),
          skillGuidance.load(agent),
          referenceGuidance.load(),
          getContext(sessionID).pipe(Effect.orDie, Effect.flatMap(nestedInstructionContext.load)),
        ],
        {
          concurrency: "unbounded",
        },
      ).pipe(Effect.map(SystemContext.combine))

    type SearchedTools = {
      current: ReadonlyMap<ToolCatalog.Key, string>
      readonly select: (selections: ReadonlyArray<ToolSearch.Selection>) => void
    }

    const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      recoverOverflow: typeof compaction.compactAfterOverflow | undefined,
      physical: PhysicalAttempt | undefined,
      stopBlockCount: PluginRuntime.Mutable<number>["value"],
      toolFailures: ToolFailureTracker,
      searchedTools: SearchedTools,
    ) {
      const physicalAttempt: PhysicalAttempt = physical ?? { attempt: 1 }
      const session = yield* getSession(sessionID)
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt
      const agent = yield* agents.select(session.agent)
      const sessionPermissions = yield* store.permissions(session.id)
      const initialized = yield* SessionContextEpoch.initialize(db, loadSystemContext(agent, session.id), session.id)
      const toolFibers = yield* FiberSet.make<void, ToolRegistry.SettlementError>()
      let needsContinuation = false
      let toolCircuitOpen = false
      let structuredOutputCaptured = false
      let currentStep = step
      const pendingForPromotion =
        promotion === undefined ? undefined : (yield* SessionInput.pending(db, session.id, promotion))[0]
      const latestPromoted = yield* SessionInput.latestPromoted(db, session.id)
      if (promotion) {
        const cutoff = yield* EventV2.latestSequence(db, session.id)
        let promoted = 0
        if (promotion === "steer") promoted = yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        if (promotion === "queue") {
          promoted += Number(yield* SessionInput.promoteNextQueued(db, events, session.id))
          promoted += yield* SessionInput.promoteSteers(db, events, session.id, cutoff)
        }
        if (promoted > 0) {
          currentStep = 1
          toolFailures.clear()
        }
      }
      const turnAfterPromotion = yield* SessionTurn.get(db, session.id)
      const turnCandidate =
        (turnAfterPromotion?.status === "pending" || turnAfterPromotion?.status === "active"
          ? turnAfterPromotion.turn_id
          : undefined) ??
        pendingForPromotion?.id ??
        latestPromoted?.id
      const turnAware =
        turnAfterPromotion !== undefined ||
        pendingForPromotion?.intent !== undefined ||
        latestPromoted?.intent !== undefined
      const promotedAfterEndedTurn =
        latestPromoted?.promotedSeq !== undefined &&
        (turnAfterPromotion === undefined || latestPromoted.promotedSeq > turnAfterPromotion.seq)
      if (turnAware && turnAfterPromotion?.status === "pending")
        yield* SessionTurn.start(events, { sessionID: session.id, turnID: turnAfterPromotion.turn_id })
      else if (
        turnAware &&
        turnCandidate &&
        (promotion !== undefined || latestPromoted !== undefined) &&
        (!turnAfterPromotion ||
          (turnAfterPromotion.status === "ended" && (promotion !== undefined || promotedAfterEndedTurn)))
      )
        yield* SessionTurn.start(events, { sessionID: session.id, turnID: turnCandidate })
      const preparedContext =
        initialized ??
        (yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent, session.id), session.id))
      yield* SessionReminder.apply({
        db,
        sessionID: session.id,
        agent: agent.id,
        commands,
        fs,
      })
      const selectedModel = session.model ?? agent.info?.model
      const resolveWithInfo = models.resolveWithInfo
      const resolved = resolveWithInfo ? yield* resolveWithInfo(session, selectedModel) : undefined
      const model = resolved?.llm ?? (yield* models.resolve(session, selectedModel))
      const entries = yield* SessionHistory.entriesForRunner(db, session.id, preparedContext.baselineSeq)
      const context = entries.map((entry) => entry.message)
      const user = context.findLast((message) => message.type === "user")
      const prompt = yield* store.latestPrompt(session.id)
      const structuredFormat = prompt?.format?.type === "json_schema" ? prompt.format : undefined
      const structuredOutputTool = structuredFormat
        ? new ToolDefinition({
            name: STRUCTURED_OUTPUT_TOOL_NAME,
            description: STRUCTURED_OUTPUT_DESCRIPTION,
            inputSchema: Object.fromEntries(
              Object.entries(structuredFormat.schema).filter(([key]) => key !== "$schema"),
            ),
          })
        : undefined
      const effectivePermissions = agent.info
        ? PermissionV2.merge(
            agent.info.permissions,
            // Session-scoped grants (P3 task `permission` parameter) land after the
            // agent whitelist so an explicit grant can allow a specific external
            // tool for the lifetime of this child session.
            sessionPermissions,
            PermissionV2.fromToolOverrides(prompt?.tools),
          )
        : // Mirror the assert side (PermissionV2.configured): a missing agent is
          // deny-all and session/prompt rules never join, so the model sees no tools
          // that the assert side would reject.
          PermissionV2.missingAgentPermissions
      const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
      const toolMaterialization = isLastStep
        ? undefined
        : yield* tools.materialize(effectivePermissions, prompt?.tools, {
            model: {
              providerID: resolved?.model.providerID ?? ProviderV2.ID.make(model.provider),
              modelID: resolved?.model.id ?? ModelV2.ID.make(model.id),
            },
            // P5 dynamic loading: searched deferred tools are injected into the
            // advertised definitions, and tool_search writes new selections here
            // for the next provider turn.
            selected: searchedTools.current,
            onSelect: searchedTools.select,
          })
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const mcpInstructions = SessionRunnerSystem.mcp(yield* mcp.instructions(), effectivePermissions)
      const system = PluginRuntime.mutable<readonly string[]>(
        [
          agent.info?.system ?? SessionRunnerSystem.provider(model),
          SessionRunnerSystem.identity(model),
          preparedContext.baseline,
          mcpInstructions,
          prompt?.system,
          structuredFormat ? STRUCTURED_OUTPUT_SYSTEM_PROMPT : undefined,
        ].filter((part): part is string => part !== undefined && part.length > 0),
      )
      if (resolved) {
        yield* plugins.run(PluginRuntime.HookName.sessionSystemTransform, {
          sessionID: session.id,
          model: resolved.model,
          system: system.value,
        })
      }

      const optionKey = SessionRunnerRequestPolicy.optionKey(model)
      const modelRequest = SessionRunnerRequestPolicy.apply(
        mergeJsonRecords(model.route.defaults.http?.body, model.defaults?.http?.body) ?? {},
        optionKey,
      )
      const agentRequest = SessionRunnerRequestPolicy.apply(agent.info?.request.body ?? {}, optionKey)
      const providerOptions: Record<string, Record<string, unknown>> = optionKey === "openai"
        ? { openai: { promptCacheKey } }
        : {}
      const initialOptions =
        mergeJsonRecords(
          model.route.defaults.providerOptions?.[optionKey],
          model.defaults?.providerOptions?.[optionKey],
          modelRequest.options,
          providerOptions[optionKey],
          agentRequest.options,
        ) ?? {}
      if (Object.keys(initialOptions).length > 0) providerOptions[optionKey] = initialOptions
      let generation = mergeGenerationOptions(
        model.route.defaults.generation,
        model.defaults?.generation,
        modelRequest.generation,
        agentRequest.generation,
      )
      let headers: Record<string, string> = { ...(agent.info?.request.headers ?? {}) }
      const requestBodyKeys = Object.keys(agentRequest.body)
      let requestBody: Record<string, unknown> = agentRequest.body
      let chat:
        | {
            readonly model: NonNullable<typeof resolved>["model"]
            readonly provider: {
              readonly source: "env" | "config" | "custom" | "api"
              readonly info: NonNullable<typeof resolved>["provider"]
              readonly options: Record<string, unknown>
            }
            readonly message: UserMessage
          }
        | undefined
      if (resolved && user) {
        const message = {
          id: user.id,
          sessionID: session.id,
          role: "user",
          time: { created: DateTime.toEpochMillis(user.time.created) },
          agent: agent.id,
          model: {
            providerID: resolved.model.providerID,
            modelID: resolved.model.id,
            ...(selectedModel?.variant === undefined ? {} : { variant: selectedModel.variant }),
          },
        } satisfies UserMessage
        const provider = {
          source: resolved.source,
          info: resolved.provider,
          options: resolved.provider.request.body,
        }
        chat = { model: resolved.model, provider, message }
        const params = PluginRuntime.mutable({
          temperature: generation?.temperature,
          topP: generation?.topP,
          topK: generation?.topK,
          maxOutputTokens: generation?.maxTokens,
          options: initialOptions,
        })
        yield* plugins.run(PluginRuntime.HookName.sessionChatParams, {
          sessionID: session.id,
          agent: agent.id,
          model: resolved.model,
          provider,
          message,
          params: params.value,
        })
        const next = params.get()
        generation = {
          temperature: next.temperature,
          topP: next.topP,
          topK: next.topK,
          maxTokens: next.maxOutputTokens,
        }
        providerOptions[optionKey] = next.options
        requestBody = Object.fromEntries(
          requestBodyKeys.flatMap((key) => (next.options[key] === undefined ? [] : [[key, next.options[key]]])),
        )

        const header = PluginRuntime.mutable<Record<string, string>>(headers)
        yield* plugins.run(PluginRuntime.HookName.sessionChatHeaders, {
          sessionID: session.id,
          agent: agent.id,
          model: resolved.model,
          provider,
          message,
          headers: header.value,
        })
        headers = header.get()
      }

      const projectedMessages = toPluginMessages(context, {
        sessionID: session.id,
        agent: agent.id,
        mode: agent.info?.mode ?? "primary",
        model: resolved
          ? {
              providerID: resolved.model.providerID,
              modelID: resolved.model.id,
              ...(selectedModel?.variant === undefined ? {} : { variant: selectedModel.variant }),
            }
          : {
              providerID: model.provider,
              modelID: model.id,
              ...(selectedModel?.variant === undefined ? {} : { variant: selectedModel.variant }),
            },
        path: { cwd: location.directory, root: location.project.directory },
      })
      const pluginMessages = PluginRuntime.mutable(projectedMessages.messages)
      yield* plugins.run(PluginRuntime.HookName.sessionMessagesTransform, {
        messages: pluginMessages.value,
      })
      const transformedContext = fromPluginMessages(pluginMessages.get(), projectedMessages.origins)

      const request = LLM.request({
        model,
        providerOptions,
        generation,
        http:
          Object.keys(headers).length === 0 && Object.keys(requestBody).length === 0
            ? undefined
            : {
                ...(Object.keys(headers).length === 0 ? {} : { headers }),
                ...(Object.keys(requestBody).length === 0 ? {} : { body: requestBody }),
              },
        system: system.get().map(SystemPart.make),
        messages: [
          ...toLLMMessages(transformedContext, model),
          ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : []),
        ],
        tools: [
          ...(toolMaterialization?.definitions.filter((tool) => tool.name !== STRUCTURED_OUTPUT_TOOL_NAME) ?? []),
          ...(structuredOutputTool ? [structuredOutputTool] : []),
        ],
        toolChoice: structuredOutputTool ? "required" : isLastStep ? "none" : undefined,
      })
      const autoContinue = (overflow: boolean) =>
        chat
          ? compaction.autocontinue({
              sessionID: session.id,
              agent: agent.id,
              model: chat.model,
              provider: chat.provider,
              message: chat.message,
              overflow,
            })
          : Effect.succeed(true)
      if (yield* compaction.compactIfNeeded({ sessionID: session.id, entries, model, request })) {
        if (!(yield* autoContinue(false))) return { needsContinuation: false, step: currentStep }
        return yield* Effect.die(continueAfterCompaction(currentStep))
      }
      const startSnapshot = yield* snapshots.capture()
      const attemptID = EventV2.ID.create()
      const assistantMessageID = SessionMessage.ID.create()
      yield* events.publish(SessionEvent.ProviderAttempt.Started, {
        sessionID: session.id,
        attemptID,
        assistantMessageID,
        timestamp: yield* DateTime.now,
        attempt: physicalAttempt.attempt,
        retryOf: physicalAttempt.retryOf,
      })
      const publisher = createLLMEventPublisher(events, {
        sessionID: session.id,
        agent: agent.id,
        assistantMessageID,
        model: {
          id: ModelV2.ID.make(model.id),
          providerID: ProviderV2.ID.make(model.provider),
          ...(selectedModel?.variant === undefined ? {} : { variant: selectedModel.variant }),
          ...(selectedModel?.protocol === undefined ? {} : { protocol: selectedModel.protocol }),
        },
        snapshot: startSnapshot,
        textComplete: ({ messageID, partID, text }) =>
          Effect.gen(function* () {
            const value = PluginRuntime.mutable(text)
            yield* plugins.run(PluginRuntime.HookName.sessionTextComplete, {
              sessionID: session.id,
              messageID,
              partID,
              text: value.value,
            })
            return value.get()
          }),
      })
      let attemptEnded = false
      const endAttempt = Effect.fnUntraced(function* (
        outcome: "completed" | "failed" | "interrupted" | "abandoned",
        continuation: boolean,
        error?: string,
      ) {
        if (attemptEnded) return
        attemptEnded = true
        yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
          sessionID: session.id,
          attemptID,
          assistantMessageID,
          timestamp: yield* DateTime.now,
          outcome,
          continuation,
          error: error === undefined ? undefined : { type: "unknown", message: error },
        })
      })
      const withPublication = Semaphore.makeUnsafe(1).withPermit
      let responseStarted = false
      const markResponseStarted = withPublication(
        Effect.gen(function* () {
          if (responseStarted) return
          responseStarted = true
          yield* events.publish(SessionEvent.ProviderAttempt.ResponseStarted, {
            sessionID: session.id,
            attemptID,
            timestamp: yield* DateTime.now,
          })
        }),
      )
      const publish = (event: LLMEvent, outputPaths: ReadonlyArray<string> = []) =>
        withPublication(publisher.publish(event, outputPaths))
      let overflowFailure: ProviderErrorEvent | undefined
      let retryableProviderFailure: ProviderErrorEvent | undefined
      const providerStream = Stream.unwrap(
        Effect.gen(function* () {
          const prepared = yield* SessionRunnerToolResultPreparation.prepare(request.messages).pipe(
            Effect.provideService(SessionAttachment.Service, attachments),
          )
          const providerRequest = new LLMRequest({ ...request, messages: prepared })
          return llm.stream(providerRequest)
        }),
      ).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (overflowFailure || retryableProviderFailure || publisher.hasProviderError()) return
            yield* markResponseStarted
            if (LLMEvent.is.providerError(event)) {
              if (isContextOverflowFailure(event) && !publisher.hasAssistantStarted()) {
                overflowFailure = event
                return
              }
              if (
                event.retryable === true &&
                !publisher.hasAssistantStarted() &&
                physicalAttempt.attempt < MAX_PROVIDER_ATTEMPTS
              ) {
                retryableProviderFailure = event
                return
              }
            }
            yield* publish(event)
            if (
              event.type === "tool-call" &&
              !event.providerExecuted &&
              structuredOutputTool &&
              event.name === STRUCTURED_OUTPUT_TOOL_NAME
            ) {
              structuredOutputCaptured = true
              const output =
                typeof event.input === "object" && event.input !== null && !Array.isArray(event.input)
                  ? (event.input as Record<string, unknown>)
                  : { value: event.input }
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: { type: "text", value: "Structured output captured successfully." },
                  output: {
                    structured: output,
                    content: [{ type: "text", text: "Structured output captured successfully." }],
                  },
                }),
              )
              return
            }
            if (event.type !== "tool-call" || event.providerExecuted) return
            if (!toolMaterialization) {
              yield* withPublication(publisher.failUnsettledTools("Tools are disabled after the maximum agent steps"))
              return
            }
            needsContinuation = true
            const assistantMessageID = yield* publisher.assistantMessageID(event.id)
            const signature = toolCallSignature(event.name, event.input)
            if ((toolFailures.get(signature) ?? 0) >= MAX_IDENTICAL_TOOL_FAILURES) {
              toolCircuitOpen = true
              yield* publish(
                LLMEvent.toolResult({
                  id: event.id,
                  name: event.name,
                  result: {
                    type: "error",
                    value: `The same ${event.name} tool call failed twice and was blocked to prevent an infinite retry loop. Change the arguments or use a different approach.`,
                  },
                }),
              )
              return
            }
            yield* Effect.uninterruptibleMask((restore) =>
              restore(
                toolMaterialization.settle({
                  sessionID: session.id,
                  agent: agent.id,
                  assistantMessageID,
                  call: event,
                }),
              ).pipe(
                Effect.tap((settlement) =>
                  Effect.sync(() => {
                    if (settlement.result.type !== "error") {
                      toolFailures.delete(signature)
                      return
                    }
                    recordToolFailure(toolFailures, signature)
                  }),
                ),
                Effect.tapCause((cause) =>
                  Cause.hasInterrupts(cause)
                    ? Effect.void
                    : Effect.sync(() => {
                        recordToolFailure(toolFailures, signature)
                      }),
                ),
                Effect.flatMap((settlement) =>
                  publish(
                    LLMEvent.toolResult({
                      id: event.id,
                      name: event.name,
                      result: settlement.result,
                      output: settlement.output,
                    }),
                    settlement.outputPaths ?? [],
                  ),
                ),
              ),
            ).pipe(FiberSet.run(toolFibers))
          }),
        ),
        Effect.ensuring(withPublication(publisher.flush())),
      )

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const stream = yield* restore(providerStream).pipe(Effect.exit)
          const failure =
            stream._tag === "Failure" ? Option.getOrUndefined(Cause.findErrorOption(stream.cause)) : undefined
          if (
            recoverOverflow &&
            !publisher.hasAssistantStarted() &&
            isContextOverflowFailure(overflowFailure ?? failure) &&
            (yield* restore(recoverOverflow({ sessionID: session.id, entries, model, request })))
          ) {
            const message =
              overflowFailure?.message ??
              (failure instanceof LLMError ? failure.reason.message : "Provider context overflow")
            if (!(yield* restore(autoContinue(true)))) {
              yield* endAttempt("failed", false, message)
              return { needsContinuation: false, step: currentStep }
            }
            yield* endAttempt("failed", true, message)
            return yield* Effect.die(continueAfterOverflowCompaction(currentStep))
          }
          const llmFailure = failure instanceof LLMError ? failure : undefined
          const retryableFailure =
            retryableProviderFailure ??
            (llmFailure?.retryable === true &&
            !publisher.hasAssistantStarted() &&
            physicalAttempt.attempt < MAX_PROVIDER_ATTEMPTS
              ? llmFailure
              : undefined)
          if (retryableFailure) {
            const delay = retryDelay(
              physicalAttempt.attempt,
              retryableFailure instanceof LLMError ? retryableFailure : undefined,
            )
            const now = yield* Clock.currentTimeMillis
            yield* events.publish(SessionEvent.Retried, {
              sessionID: session.id,
              attemptID,
              timestamp: DateTime.makeUnsafe(now),
              attempt: physicalAttempt.attempt + 1,
              next: DateTime.makeUnsafe(now + delay),
              error: retryError(retryableFailure),
            })
            attemptEnded = true
            yield* restore(Effect.sleep(delay))
            return yield* Effect.die(
              retryProvider(currentStep, {
                attempt: physicalAttempt.attempt + 1,
                retryOf: attemptID,
              }),
            )
          }
          if (overflowFailure) yield* publish(overflowFailure)
          if (llmFailure && !publisher.hasProviderError()) {
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
            yield* withPublication(
              publisher.failAssistant(
                llmFailureMessage(llmFailure),
                llmFailure.reason._tag === "Authentication" ? "authentication" : "unknown",
              ),
            )
          }
          if (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) yield* FiberSet.clear(toolFibers)
          const settled = yield* restore(awaitToolFibers(toolFibers)).pipe(Effect.exit)
          if (settled._tag === "Failure" && isUserDeclined(settled.cause)) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            yield* endAttempt("completed", false)
            return { needsContinuation: false, step: currentStep }
          }
          if (
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          ) {
            yield* FiberSet.clear(toolFibers)
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
            if (publisher.hasActiveAssistant())
              yield* withPublication(publisher.failAssistant("Provider turn interrupted"))
          }
          if (settled._tag === "Failure" && !Cause.hasInterrupts(settled.cause)) {
            const failure = Cause.squash(settled.cause)
            const message = failure instanceof Error ? failure.message : String(failure)
            yield* withPublication(publisher.failUnsettledTools(`Tool execution failed: ${message}`))
          }
          const interrupted =
            (stream._tag === "Failure" && Cause.hasInterrupts(stream.cause)) ||
            (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
          const structuredOutputMissing =
            structuredFormat !== undefined &&
            stream._tag === "Success" &&
            !interrupted &&
            !publisher.hasProviderError() &&
            !needsContinuation &&
            !structuredOutputCaptured
          if (structuredOutputMissing)
            yield* withPublication(publisher.failAssistant("Model did not produce structured output"))
          const stepSettlement =
            publisher.stepSettlement() ??
            (stream._tag === "Success" && !publisher.hasProviderError()
              ? {
                  finish: "unknown",
                  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                }
              : undefined)
          if (stepSettlement && !publisher.hasProviderError() && !structuredOutputMissing) {
            const endSnapshot = yield* snapshots.capture()
            const files =
              startSnapshot && endSnapshot
                ? yield* snapshots
                    .files({ from: startSnapshot, to: endSnapshot })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            const patch =
              startSnapshot && endSnapshot && files && files.length > 0
                ? yield* snapshots
                    .diff({ from: startSnapshot, to: endSnapshot, context: 0 })
                    .pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined
            yield* withPublication(
              events.publish(SessionEvent.Step.Ended, {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                assistantMessageID: yield* publisher.startAssistant(),
                finish: structuredOutputCaptured ? "stop" : stepSettlement.finish,
                cost: 0,
                tokens: stepSettlement.tokens,
                snapshot: endSnapshot,
                files,
                patch,
              }),
            )
          }
          if (publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Tool execution interrupted"))
          if (stream._tag === "Success" && !publisher.hasProviderError())
            yield* withPublication(publisher.failUnsettledTools("Provider did not return a tool result", true))
          let continuation =
            stream._tag === "Success" &&
            !interrupted &&
            !publisher.hasProviderError() &&
            !structuredOutputMissing &&
            !structuredOutputCaptured &&
            !toolCircuitOpen &&
            needsContinuation
          yield* endAttempt(
            interrupted
              ? "interrupted"
              : stream._tag === "Failure" || publisher.hasProviderError() || structuredOutputMissing
                ? "failed"
                : "completed",
            continuation,
            interrupted
              ? "Provider turn interrupted"
              : structuredOutputMissing
                ? "Model did not produce structured output"
                : llmFailure?.reason.message,
          )
          if (!continuation && stream._tag === "Success" && !publisher.hasProviderError()) {
            const lastStored = yield* store.message(assistantMessageID)
            const lastText =
              lastStored?.sessionID === session.id && lastStored.message.type === "assistant"
                ? lastStored.message.content
                    .filter((part): part is SessionMessage.AssistantText => part.type === "text")
                    .map((part) => part.text)
                    .join("")
                : undefined
            const stop = yield* SessionStopHook.evaluateStopHooks({
              lastAssistantMessage: lastText,
              blockCount: stopBlockCount.get(),
              // Main-agent turns fire `session.stop`; only subagent turns select
              // `session.subagent.stop` (the subagent id is otherwise always defined).
              agent: agent.info?.mode === "subagent" ? agent.id : undefined,
            }).pipe(Effect.provideService(PluginRuntime.Service, plugins))
            if (stop.action === "continue" && stop.continuation && stop.continuation.length > 0) {
              stopBlockCount.update((value) => value + 1)
              // Admission is advisory: a cancelled session, missing session, or conflicting input
              // must not fail the provider turn, so degrade to ending the turn on any failure.
              continuation = yield* commands
                .admitSynthetic({
                  sessionID: session.id,
                  text: stop.continuation.map((fragment) => fragment.text).join("\n"),
                  description: "stop hook continuation",
                })
                .pipe(
                  Effect.as(true),
                  Effect.catchCause(() => Effect.succeed(false)),
                )
            }
          }
          if (stream._tag === "Failure") return yield* Effect.failCause(stream.cause)
          if (settled._tag === "Failure" && Cause.hasInterrupts(settled.cause))
            return yield* Effect.failCause(settled.cause)
          return { needsContinuation: continuation, step: currentStep }
        }),
      )
    }, Effect.scoped)
    type RunTurn = (
      sessionID: SessionSchema.ID,
      promotion: SessionInput.Delivery | undefined,
      step: number,
      physical: PhysicalAttempt | undefined,
      stopBlockCount: PluginRuntime.Mutable<number>["value"],
      toolFailures: ToolFailureTracker,
      searchedTools: SearchedTools,
    ) => Effect.Effect<{ readonly needsContinuation: boolean; readonly step: number }, RunError>

    const runAfterOverflowCompaction: RunTurn = Effect.fnUntraced(
      function* (sessionID, promotion, step, physical, stopBlockCount, toolFailures, searchedTools) {
        return yield* runTurnAttempt(
          sessionID,
          promotion,
          step,
          undefined,
          physical,
          stopBlockCount,
          toolFailures,
          searchedTools,
        ).pipe(
          Effect.catchDefect(
            Effect.fnUntraced(function* (defect) {
              if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
              if (defect.transition._tag === "ContinueAfterOverflowCompaction")
                return yield* Effect.die("Post-compaction provider attempt cannot recover another overflow")
              yield* Effect.yieldNow
              if (defect.transition._tag === "RetryProvider")
                return yield* runAfterOverflowCompaction(
                  sessionID,
                  undefined,
                  defect.transition.step,
                  defect.transition.physical,
                  stopBlockCount,
                  toolFailures,
                  searchedTools,
                )
              return yield* runAfterOverflowCompaction(
                sessionID,
                undefined,
                defect.transition.step,
                physical,
                stopBlockCount,
                toolFailures,
                searchedTools,
              )
            }),
          ),
        )
      },
    )

    const runTurn: RunTurn = Effect.fnUntraced(
      function* (sessionID, promotion, step, physical, stopBlockCount, toolFailures, searchedTools) {
        return yield* runTurnAttempt(
          sessionID,
          promotion,
          step,
          compaction.compactAfterOverflow,
          physical,
          stopBlockCount,
          toolFailures,
          searchedTools,
        ).pipe(
          Effect.catchDefect(
            Effect.fnUntraced(function* (defect) {
              if (!(defect instanceof TurnTransitionError)) return yield* Effect.die(defect)
              yield* Effect.yieldNow
              if (defect.transition._tag === "ContinueAfterOverflowCompaction")
                return yield* runAfterOverflowCompaction(
                  sessionID,
                  undefined,
                  defect.transition.step,
                  undefined,
                  stopBlockCount,
                  toolFailures,
                  searchedTools,
                )
              if (defect.transition._tag === "RetryProvider")
                return yield* runTurn(
                  sessionID,
                  undefined,
                  defect.transition.step,
                  defect.transition.physical,
                  stopBlockCount,
                  toolFailures,
                  searchedTools,
                )
              return yield* runTurn(
                sessionID,
                undefined,
                defect.transition.step,
                physical,
                stopBlockCount,
                toolFailures,
                searchedTools,
              )
            }),
          ),
        )
      },
    )

    const run = Effect.fn("SessionRunner.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }) {
      let force = input.force
      let projectedAttempt = yield* SessionAttempt.get(db, input.sessionID)
      if (projectedAttempt?.status === "started" || projectedAttempt?.status === "responding") {
        const stored = yield* store.message(projectedAttempt.assistant_message_id)
        const assistant =
          stored?.sessionID === input.sessionID && stored.message.type === "assistant" ? stored.message : undefined
        const unsettled = assistant?.content.some(
          (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
        )
        if (assistant?.time.completed !== undefined && unsettled === false) {
          const interrupted = assistant.error?.message === "Provider turn interrupted"
          const failed = assistant.finish === "error"
          const continuation =
            !failed && assistant.content.some((part) => part.type === "tool" && part.provider?.executed !== true)
          yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
            sessionID: input.sessionID,
            attemptID: projectedAttempt.attempt_id,
            assistantMessageID: projectedAttempt.assistant_message_id,
            timestamp: yield* DateTime.now,
            outcome: interrupted ? "interrupted" : failed ? "failed" : "completed",
            continuation,
            error: assistant.error,
          })
          projectedAttempt = yield* SessionAttempt.get(db, input.sessionID)
          force = false
        } else {
          yield* failInterruptedTools(input.sessionID)
          return yield* new SessionAttempt.RecoveryRequiredError({
            sessionID: input.sessionID,
            attemptID: projectedAttempt.attempt_id,
            reason: projectedAttempt.status === "responding" ? "response-interrupted" : "dispatch-unknown",
          })
        }
      }
      let initialPhysical: PhysicalAttempt | undefined
      if (projectedAttempt?.status === "retrying") {
        const now = yield* Clock.currentTimeMillis
        if (projectedAttempt.retry_at !== null && projectedAttempt.retry_at > now)
          yield* Effect.sleep(projectedAttempt.retry_at - now)
        initialPhysical = {
          attempt: projectedAttempt.attempt,
          retryOf: projectedAttempt.attempt_id,
        }
      }
      if (projectedAttempt?.status === "continuation" && projectedAttempt.decision === "retry")
        initialPhysical = {
          attempt: projectedAttempt.attempt,
          retryOf: projectedAttempt.attempt_id,
        }
      const hasDurableContinuation =
        projectedAttempt?.status === "continuation" || projectedAttempt?.status === "retrying"
      const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
      const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
      const currentTurn = yield* SessionTurn.get(db, input.sessionID)
      const latestPromoted = yield* SessionInput.latestPromoted(db, input.sessionID)
      const hasPromoted =
        latestPromoted !== undefined &&
        latestPromoted.promotedSeq !== undefined &&
        (projectedAttempt === undefined || latestPromoted.promotedSeq > projectedAttempt.seq)
      const hasOpenTurn = currentTurn?.status === "pending" || currentTurn?.status === "active"
      if (!force && !hasSteer && !hasQueue && !hasDurableContinuation && !hasPromoted && !hasOpenTurn) return
      yield* failInterruptedTools(input.sessionID)
      let promotion: SessionInput.Delivery | undefined = initialPhysical
        ? undefined
        : hasSteer
          ? "steer"
          : hasQueue
            ? "queue"
            : undefined
      let shouldRun = force || hasSteer || hasQueue || hasDurableContinuation || hasPromoted || hasOpenTurn
      while (shouldRun) {
        let needsContinuation = true
        let step = 1
        // Exact deferred definitions accumulate only across provider turns in
        // this drain. A later selection for the same key replaces its old hash.
        const searchedTools: SearchedTools = {
          current: new Map(),
          select: (selections) => {
            const current = new Map(searchedTools.current)
            for (const selection of selections) current.set(selection.key, selection.definitionHash)
            searchedTools.current = current
          },
        }
        // One pool per turn: every `needsContinuation` iteration of the same
        // turn reuses the pooled Responses WebSocket connection (keyed by url +
        // headers) instead of opening and closing a socket per provider request.
        // The pool only takes effect when the route is the WebSocket transport
        // and a WebSocket executor is available; every other route never reads
        // it. `closeAll` runs when the turn region ends, including on failure
        // or interruption.
        const pool = yield* WebSocketPool.make()
        // Fresh per-turn cap: a drain spans multiple turns when queued inputs are
        // promoted, and each turn owns its stop-hook block budget. The counter is
        // shared across every provider attempt within this one turn so a hook that
        // keeps returning "continue" is still capped at MAX_BLOCKS_PER_TURN.
        const stopBlockCount = PluginRuntime.mutable(0)
        const toolFailures: ToolFailureTracker = new Map()
        yield* Effect.gen(function* () {
          while (needsContinuation) {
            const result = yield* runTurn(
              input.sessionID,
              promotion,
              step,
              initialPhysical,
              stopBlockCount.value,
              toolFailures,
              searchedTools,
            ).pipe(Effect.provideService(WebSocketPool.Service, pool))
            initialPhysical = undefined
            needsContinuation = result.needsContinuation
            step = result.step + 1
            promotion = "steer"
            if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
          }
        }).pipe(Effect.ensuring(pool.closeAll))
        const turn = yield* SessionTurn.get(db, input.sessionID)
        if (turn?.status === "active") {
          const ended = yield* SessionTurn.end(events, {
            sessionID: input.sessionID,
            turnID: turn.turn_id,
          })
          if (!ended) {
            shouldRun = true
            promotion = "steer"
            continue
          }
        }
        shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
        promotion = shouldRun ? "queue" : undefined
      }
    })

    return Service.of({
      run,
    })
  }),
)

function toolCallSignature(name: string, input: unknown) {
  return `${name}:${canonicalToolValue(input)}`
}

function canonicalToolValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalToolValue).join(",")}]`
  if (typeof value !== "object") return `${typeof value}:${String(value)}`
  return `{${Object.entries(value)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalToolValue(item)}`)
    .join(",")}}`
}

function recordToolFailure(tracker: ToolFailureTracker, signature: string) {
  tracker.set(signature, (tracker.get(signature) ?? 0) + 1)
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    EventV2.node,
    llmClient,
    AgentV2.node,
    PluginRuntime.node,
    ToolRegistry.node,
    SessionRunnerModel.node,
    SessionStore.node,
    SessionCommand.node,
    SessionAttachment.node,
    FSUtil.node,
    Location.node,
    MCP.node,
    SystemContextRegistry.node,
    InstructionContext.nestedNode,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    Database.node,
  ],
})
