export * as TurnCoordinator from "./coordinator"

import { Cause, Clock, Context, DateTime, Deferred, Duration, Effect, Layer, Option, Ref, Scope } from "effect"
import { LLM, LLMRequest, SystemPart, ToolResultValue, type ToolDefinition } from "@opencode-ai/llm"
import { AgentV2 } from "../../agent"
import { Database } from "../../database/database"
import { EventV2 } from "../../event"
import { makeGlobalNode } from "../../effect/app-node"
import { InstructionContext } from "../../instruction-context"
import { LocationServiceMap } from "../../location-service-map"
import { MCP } from "../../mcp/runtime"
import { ModelV2 } from "../../model"
import { PermissionV2 } from "../../permission"
import { ProviderV2 } from "../../provider"
import { ReferenceGuidance } from "../../reference/guidance"
import { SkillGuidance } from "../../skill/guidance"
import { SystemContext } from "../../system-context/index"
import { SystemContextRegistry } from "../../system-context/registry"
import { SessionEvent } from "../event"
import { SessionInput } from "../input"
import { SessionMessage } from "../message"
import { Prompt } from "../prompt"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionContextEpoch } from "../context-epoch"
import { SessionRunnerModel } from "../runner/model"
import { SessionRunnerSystem } from "../runner/system"
import { SessionCompaction } from "../compaction"
import { toLLMMessages } from "../runner/to-llm-message"
import { SessionRunCoordinator } from "../run-coordinator"
import { ToolRegistry } from "../../tool/registry"
import { KernelPluginHost } from "./plugin-host"
import { KernelDiagnostics } from "./diagnostics"
import { LifecycleStore } from "./lifecycle-store"
import { PublicationActor } from "./publication-actor"
import { ProviderReader } from "./provider-reader"
import { claimExecutionOwnership, processIncarnation, releaseExecutionOwnership } from "./incarnation"
import { ToolScheduler } from "./tool-scheduler"

const retryDelayMs = (attempt: number) => Math.min(500 * 2 ** Math.max(0, attempt - 1), 10_000)

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  value !== null && typeof value === "object" ? (value as Readonly<Record<string, unknown>>) : undefined

const selectExposedDefinitions = (value: unknown, approved: ReadonlyArray<ToolDefinition>) => {
  const definitions = asRecord(value)?.definitions
  if (!Array.isArray(definitions)) return approved
  const names = new Set(
    definitions.flatMap((definition) => {
      const name = asRecord(definition)?.name
      return typeof name === "string" ? [name] : []
    }),
  )
  return approved.filter((definition) => names.has(definition.name))
}

const selectRequest = (value: unknown, fallback: LLMRequest, tools: ReadonlyArray<ToolDefinition>) => {
  const candidate = asRecord(value)?.request
  return LLM.updateRequest(candidate instanceof LLMRequest ? candidate : fallback, { model: fallback.model, tools })
}

const toolError = (message: string): ToolRegistry.Settlement => ({ result: { type: "error", value: message } })

const selectSettlement = (value: unknown, fallback: ToolRegistry.Settlement) => {
  const candidate = asRecord(value)?.settlement ?? value
  const record = asRecord(candidate)
  return record && ToolResultValue.is(record.result) ? (candidate as ToolRegistry.Settlement) : fallback
}

export interface CompactInput {
  readonly sessionID: SessionSchema.ID
  readonly prompt?: Prompt
  readonly reason: "auto" | "manual"
}

export interface Interface {
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly run: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Durable fence first, then abort provider/tool scopes. */
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  /** Fenced compaction phase: acquire idle, compact, release idle. */
  readonly compact: (input: CompactInput) => Effect.Effect<SessionCompaction.Result, SessionRunCoordinator.Busy>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/TurnCoordinator") {}

/**
 * One process-local coordinator per active Kernel Session: coalesces
 * same-Session wakes, allows different Sessions concurrently, creates the
 * turn cancellation scope, waits for publication and terminal commit, and
 * releases ownership only after durable settlement.
 */
export const make = Effect.fn("TurnCoordinator.make")(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const lifecycle = yield* LifecycleStore.Service
  const reader = yield* ProviderReader.Service
  const store = yield* SessionStore.Service
  const locations = yield* LocationServiceMap.Service
  const diagnostics = yield* KernelDiagnostics.Service
  const scope = yield* Scope.Scope
  // Per-session actor ownership: a global actor ref would let one session's
  // run stamp over another's, so interrupting session A could signal B.
  const currentActors = yield* Ref.make<ReadonlyMap<SessionSchema.ID, PublicationActor.Interface>>(new Map())

  const morePending = Effect.fn("TurnCoordinator.morePending")(function* (sessionID: SessionSchema.ID) {
    if (yield* SessionInput.hasPending(db, sessionID, "steer")) return true
    return yield* SessionInput.hasPending(db, sessionID, "queue")
  })

  const compactSession = Effect.fn("TurnCoordinator.compactSession")(function* (input: {
    readonly session: SessionSchema.Info
    readonly prompt?: Prompt
    readonly reason: "auto" | "manual"
  }) {
    const dependencies = yield* Effect.gen(function* () {
      return {
        compaction: yield* SessionCompaction.Service,
        pluginHost: Option.getOrUndefined(yield* Effect.serviceOption(KernelPluginHost.Service)),
      }
    }).pipe(Effect.provide(locations.get(input.session.location)))
    const policy = { sessionID: input.session.id, reason: input.reason, permitted: true }
    const decided = dependencies.pluginHost
      ? yield* dependencies.pluginHost.seams
          .run(KernelPluginHost.SeamName.compactionPolicyDecide, policy)
          .pipe(Effect.orDie)
      : policy
    if (asRecord(decided)?.permitted === false) return { compacted: false, shouldContinue: false }
    const pluginHost = dependencies.pluginHost
    const transformSummary = pluginHost
      ? (summary: SessionCompaction.Summary) =>
          pluginHost.seams.run(KernelPluginHost.SeamName.compactionSummaryTransform, summary).pipe(
            Effect.orDie,
            Effect.flatMap((value) => {
              const transformed = asRecord(value)
              if (typeof transformed?.text !== "string" || typeof transformed.recent !== "string")
                return Effect.die("Plugin returned an invalid compaction summary")
              return Effect.succeed({
                sessionID: summary.sessionID,
                text: transformed.text,
                recent: transformed.recent,
              })
            }),
          )
      : undefined
    return yield* dependencies.compaction
      .compact({
        session: input.session,
        prompt: input.prompt,
        reason: input.reason,
        transformSummary,
      })
      .pipe(Effect.orDie)
  })

  const runTurn = Effect.fn("TurnCoordinator.runTurn")(function* (sessionID: SessionSchema.ID) {
    const snapshot = yield* lifecycle.get(sessionID)
    if (snapshot.state !== "idle") return false
    const session = yield* store.get(sessionID)
    if (!session || session.engine !== "kernel") return false
    // Idle promotes exactly one durable input per turn: steers first, then
    // the oldest queue entry. Anything still pending is the next loop pass.
    const steer = yield* SessionInput.pending(db, sessionID, "steer")
    const input = steer[0] ?? (yield* SessionInput.pending(db, sessionID, "queue"))[0]
    if (!input) return false

    const attemptID = EventV2.ID.create()
    const turnID = SessionMessage.ID.create()
    const assistantMessageID = SessionMessage.ID.create()
    const lease = yield* lifecycle.start({
      sessionID,
      inputID: input.id,
      turnID,
      attemptID,
      assistantMessageID,
      processIncarnation,
    })
    if (!claimExecutionOwnership(lease))
      return yield* Effect.die(`Kernel execution already has a different process-local owner: ${sessionID}`)

    // The complete owned turn is interruptible, including retry backoff and
    // model/history preparation. Durable writes are already atomic and
    // uninterruptible at EventV2's transaction boundary; keeping the rest of
    // the turn masked would make the stop button wait for retry timers or a
    // blocked dependency before the cancellation finalizer can settle.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        let currentAttempt = attemptID
        let currentAssistantMessageID = assistantMessageID
        let overflowCompacted = false
        while (true) {
          let attemptNumber = 1
          let actor: PublicationActor.Interface | undefined
          let result: ProviderReader.ProviderTurnResult = { kind: "completed" }
          let materialization: ToolRegistry.Materialization | undefined
          let pluginHost: KernelPluginHost.Interface | undefined
          let exposedToolNames = new Set<string>()
          let agent = AgentV2.defaultID

          // One bounded retry for Task 5; later tasks generalize the retry budget.
          for (let round = 0; round < 2; round++) {
            const prepared = yield* Effect.gen(function* () {
              const models = yield* SessionRunnerModel.Service
              const model = yield* models.resolve(session)
              const agents = yield* Effect.serviceOption(AgentV2.Service)
              const selected = Option.isSome(agents)
                ? yield* agents.value.select(session.agent)
                : { id: AgentV2.ID.make(session.agent ?? AgentV2.defaultID), info: undefined }
              const registry = yield* Effect.serviceOption(ToolRegistry.Service)
              const host = yield* Effect.serviceOption(KernelPluginHost.Service)
              const prompt = yield* store.latestPrompt(sessionID)
              const sessionPermissions = yield* store.permissions(sessionID)
              const permissions = selected.info
                ? PermissionV2.merge(
                    selected.info.permissions,
                    sessionPermissions,
                    PermissionV2.fromToolOverrides(prompt?.tools),
                  )
                : PermissionV2.missingAgentPermissions
              const tools = Option.isSome(registry)
                ? yield* registry.value.materialize(permissions, prompt?.tools, {
                    model: {
                      providerID: ProviderV2.ID.make(model.provider),
                      modelID: ModelV2.ID.make(model.id),
                    },
                  })
                : undefined
              const systemContext = yield* Effect.serviceOption(SystemContextRegistry.Service)
              const skillGuidance = yield* Effect.serviceOption(SkillGuidance.Service)
              const referenceGuidance = yield* Effect.serviceOption(ReferenceGuidance.Service)
              const nestedInstructionContext = yield* Effect.serviceOption(InstructionContext.NestedService)
              const context = SystemContext.combine(
                yield* Effect.all(
                  [
                    Option.isSome(systemContext) ? systemContext.value.load() : Effect.succeed(SystemContext.empty),
                    Option.isSome(skillGuidance)
                      ? skillGuidance.value.load(selected)
                      : Effect.succeed(SystemContext.empty),
                    Option.isSome(referenceGuidance)
                      ? referenceGuidance.value.load()
                      : Effect.succeed(SystemContext.empty),
                    Option.isSome(nestedInstructionContext)
                      ? store
                          .context(sessionID)
                          .pipe(Effect.orDie, Effect.flatMap(nestedInstructionContext.value.load))
                      : Effect.succeed(SystemContext.empty),
                  ],
                  { concurrency: "unbounded" },
                ),
              )
              const preparedContext = yield* SessionContextEpoch.prepare(db, events, Effect.succeed(context), sessionID)
              const mcp = yield* Effect.serviceOption(MCP.Service)
              const mcpInstructions = Option.isSome(mcp)
                ? SessionRunnerSystem.mcp(yield* mcp.value.instructions(), permissions)
                : undefined
              const system = [
                selected.info?.system ?? SessionRunnerSystem.provider(model),
                SessionRunnerSystem.identity(model),
                preparedContext.baseline,
                mcpInstructions,
                prompt?.system,
              ].filter((part): part is string => part !== undefined && part.length > 0)
              return { model, selected, tools, system, host: Option.getOrUndefined(host) }
            }).pipe(Effect.provide(locations.get(session.location)), Effect.orDie)
            const model = prepared.model
            materialization = prepared.tools
            pluginHost = prepared.host
            agent = prepared.selected.id
            const history = yield* store.context(sessionID)
            const approvedDefinitions = materialization?.definitions ?? []
            const exposure = pluginHost
              ? yield* pluginHost.seams
                  .run(KernelPluginHost.SeamName.toolExposureTransform, {
                    sessionID,
                    definitions: approvedDefinitions,
                    deferred: materialization?.deferred ?? [],
                    catalog: materialization?.catalog,
                  })
                  .pipe(Effect.orDie)
              : { definitions: approvedDefinitions }
            const definitions = selectExposedDefinitions(exposure, approvedDefinitions)
            exposedToolNames = new Set(definitions.map((definition) => definition.name))
            const baseRequest = LLM.request({
              model,
              system: prepared.system.map(SystemPart.make),
              messages: toLLMMessages(history, model),
              tools: definitions,
            })
            const transformedRequest = pluginHost
              ? yield* pluginHost.seams
                  .run(KernelPluginHost.SeamName.requestTransform, { sessionID, request: baseRequest })
                  .pipe(Effect.orDie)
              : baseRequest
            const request = selectRequest(transformedRequest, baseRequest, definitions)
            const turnActor = yield* PublicationActor.make(events, {
              sessionID,
              attemptID: currentAttempt,
              assistantMessageID: currentAssistantMessageID,
              agent,
              model:
                session.model ??
                ModelV2.Ref.make({ id: ModelV2.ID.make(model.id), providerID: ProviderV2.ID.make(model.provider) }),
              location: session.location,
              // Incremental durable checkpoints commit under the current lease.
              // Once the interrupt fence fires, the lease is stale: the remaining
              // incremental content is dropped — the fenced settle publishes the
              // authoritative Ended full value instead.
              flush: (items) =>
                lifecycle.checkpoint({ lease, events: items }).pipe(
                  Effect.tap(() =>
                    items.some(
                      (item) =>
                        item.definition.type === SessionEvent.Text.Checkpoint.type ||
                        item.definition.type === SessionEvent.Reasoning.Checkpoint.type ||
                        item.definition.type === SessionEvent.Tool.Input.Checkpoint.type,
                    )
                      ? diagnostics.increment("checkpoint.committed")
                      : Effect.void,
                  ),
                  Effect.as(true),
                  Effect.catchTag("StaleExecutionError", () =>
                    Effect.logWarning("Stopping publication for fenced lease", {
                      sessionID,
                      generation: lease.generation,
                    }).pipe(Effect.as(false)),
                  ),
                ),
              responseStarted: (item) =>
                lifecycle
                  .transition({
                    lease,
                    expectedState: "active",
                    state: "active",
                    phase: "responding",
                    events: [item],
                  })
                  .pipe(
                    Effect.as(true),
                    Effect.catchTag("StaleExecutionError", () => Effect.succeed(false)),
                  ),
            }).pipe(Effect.provideService(Scope.Scope, scope))
            actor = turnActor
            yield* Ref.update(currentActors, (map) => new Map(map).set(sessionID, turnActor))
            result = yield* reader.run({ actor: turnActor, request })
            if (pluginHost)
              yield* pluginHost.seams
                .run(KernelPluginHost.SeamName.responseObserve, { sessionID, result })
                .pipe(Effect.orDie)
            if (result.kind !== "error" || !result.retryable) break
            yield* turnActor.barrier
            const retryTerminalEvents = yield* turnActor.close("error")

            const now = yield* Clock.currentTimeMillis
            const delay = retryDelayMs(attemptNumber)
            yield* lifecycle.transition({
              lease,
              expectedState: "active",
              state: "retry_wait",
              retryAt: DateTime.makeUnsafe(now + delay),
              events: [
                ...retryTerminalEvents,
                // Each provider attempt is terminal before the next starts:
                // attempt-1 closes here, the row switches to attempt-2 below,
                // and the final terminalize closes attempt-2 exactly once.
                {
                  definition: SessionEvent.ProviderAttempt.Ended,
                  data: {
                    sessionID,
                    timestamp: DateTime.makeUnsafe(now),
                    attemptID: currentAttempt,
                    assistantMessageID: currentAssistantMessageID,
                    outcome: "failed",
                    continuation: false,
                  },
                },
                {
                  definition: SessionEvent.Retried,
                  data: {
                    sessionID,
                    timestamp: DateTime.makeUnsafe(now),
                    attemptID: currentAttempt,
                    attempt: attemptNumber + 1,
                    next: DateTime.makeUnsafe(now + delay),
                    error: {
                      message: String(
                        (result.error.data as { message?: unknown } | undefined)?.message ?? result.error.name,
                      ),
                      isRetryable: true,
                    },
                  },
                },
              ],
            })
            yield* Ref.update(currentActors, (map) => {
              const next = new Map(map)
              next.delete(sessionID)
              return next
            })
            yield* Effect.sleep(Duration.millis(delay))
            const nextAttempt = EventV2.ID.create()
            yield* lifecycle.transition({
              lease,
              expectedState: "retry_wait",
              state: "active",
              phase: "dispatching",
              attemptID: nextAttempt,
              events: [
                {
                  definition: SessionEvent.ProviderAttempt.Started,
                  data: {
                    sessionID,
                    timestamp: yield* DateTime.now,
                    attemptID: nextAttempt,
                    assistantMessageID: currentAssistantMessageID,
                    attempt: attemptNumber + 1,
                    retryOf: currentAttempt,
                  },
                },
              ],
            })
            currentAttempt = nextAttempt
            attemptNumber += 1
          }

          const finalActor = actor
          if (finalActor) yield* finalActor.barrier
          if (result.kind === "interrupted") {
            const terminalEvents = finalActor ? yield* finalActor.close("cancelled") : []
            yield* settleAfterInterrupt(sessionID, terminalEvents)
            if (pluginHost)
              yield* pluginHost.seams
                .run(KernelPluginHost.SeamName.turnObserve, { sessionID, outcome: "cancelled", result })
                .pipe(Effect.orDie)
            return yield* morePending(sessionID)
          }
          if (result.kind === "error") {
            const terminalEvents = finalActor ? yield* finalActor.close("error") : []
            if (result.contextOverflow && !overflowCompacted) {
              yield* lifecycle.transition({
                lease,
                expectedState: "active",
                state: "active",
                phase: "compacting",
                events: terminalEvents,
              })
              yield* Ref.update(currentActors, (map) => {
                const next = new Map(map)
                next.delete(sessionID)
                return next
              })
              const compacted = yield* compactSession({ session, reason: "auto" }).pipe(
                Effect.map(Option.some),
                Effect.catchCause((cause) =>
                  Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.logWarning("Kernel overflow compaction failed", { sessionID, cause }).pipe(
                        Effect.as(Option.none<SessionCompaction.Result>()),
                      ),
                ),
              )
              if (Option.isSome(compacted) && compacted.value.compacted && compacted.value.shouldContinue) {
                const nextAttempt = EventV2.ID.create()
                const nextAssistantMessageID = SessionMessage.ID.create()
                const timestamp = yield* DateTime.now
                yield* lifecycle.transition({
                  lease,
                  expectedState: "active",
                  state: "active",
                  phase: "dispatching",
                  attemptID: nextAttempt,
                  assistantMessageID: nextAssistantMessageID,
                  events: [
                    {
                      definition: SessionEvent.ProviderAttempt.Ended,
                      data: {
                        sessionID,
                        timestamp,
                        attemptID: currentAttempt,
                        assistantMessageID: currentAssistantMessageID,
                        outcome: "failed",
                        continuation: true,
                      },
                    },
                    {
                      definition: SessionEvent.ProviderAttempt.Started,
                      data: {
                        sessionID,
                        timestamp,
                        attemptID: nextAttempt,
                        assistantMessageID: nextAssistantMessageID,
                        attempt: 1,
                      },
                    },
                  ],
                })
                currentAttempt = nextAttempt
                currentAssistantMessageID = nextAssistantMessageID
                overflowCompacted = true
                continue
              }
              yield* lifecycle.terminalize({
                lease,
                events: [],
                outcome: "error",
                error: result.error,
              })
              if (pluginHost)
                yield* pluginHost.seams
                  .run(KernelPluginHost.SeamName.turnObserve, { sessionID, outcome: "error", result })
                  .pipe(Effect.orDie)
              return false
            }
            yield* lifecycle.terminalize({
              lease,
              events: terminalEvents,
              outcome: "error",
              error: result.error,
            })
            if (pluginHost)
              yield* pluginHost.seams
                .run(KernelPluginHost.SeamName.turnObserve, { sessionID, outcome: "error", result })
                .pipe(Effect.orDie)
            return false
          }
          const toolCalls = finalActor
            ? (yield* finalActor.toolCalls).filter((call) => call.providerExecuted !== true)
            : []
          if (finalActor && toolCalls.length > 0) {
            const deadline = yield* DateTime.now
            const toolsForTurn = materialization
            const preparedTools = yield* Effect.forEach(toolCalls, (call, index) =>
              Effect.gen(function* () {
                const baseConcurrency = toolsForTurn?.concurrency?.get(call.name) ?? "exclusive"
                const baseDecision = {
                  sessionID,
                  call,
                  permitted: exposedToolNames.has(call.name),
                  concurrency: baseConcurrency,
                }
                const decided = pluginHost
                  ? yield* pluginHost.seams
                      .run(KernelPluginHost.SeamName.toolPrepareDecide, baseDecision)
                      .pipe(Effect.orDie)
                  : baseDecision
                const decision = asRecord(decided)
                const permitted = baseDecision.permitted && decision?.permitted !== false
                const concurrency: ToolScheduler.ToolConcurrency =
                  baseConcurrency === "parallel" && decision?.concurrency === "parallel" ? "parallel" : "exclusive"
                const core = () =>
                  permitted && toolsForTurn
                    ? toolsForTurn
                        .settle({
                          sessionID,
                          agent,
                          assistantMessageID: currentAssistantMessageID,
                          generation: lease.generation,
                          call,
                        })
                        .pipe(
                          Effect.catch((error) =>
                            Effect.succeed(toolError(error instanceof Error ? error.message : String(error))),
                          ),
                        )
                    : Effect.succeed(
                        toolError(
                          permitted ? `Unknown tool: ${call.name}` : `Tool blocked by plugin policy: ${call.name}`,
                        ),
                      )
                const execute = () =>
                  Effect.gen(function* () {
                    const dispatched = pluginHost
                      ? yield* pluginHost.seams
                          .run(KernelPluginHost.SeamName.toolDispatchAround, { sessionID, call }, core)
                          .pipe(Effect.catchTag("NextCalledError", (error) => Effect.succeed(toolError(error.message))))
                      : yield* core()
                    const settlement = selectSettlement(
                      dispatched,
                      toolError(`Plugin returned an invalid tool settlement: ${call.name}`),
                    )
                    if (!pluginHost) return settlement
                    const finalized = yield* pluginHost.seams
                      .run(KernelPluginHost.SeamName.toolFinalizeTransform, { sessionID, call, settlement })
                      .pipe(Effect.orDie)
                    return selectSettlement(finalized, settlement)
                  })
                return {
                  index,
                  call,
                  onStart: finalActor.toolStarted(call.id),
                  onInterrupt: (outcome: "cancelled" | "abandoned") => finalActor.toolInterrupted(call.id, outcome),
                  concurrency,
                  deadline,
                  execute,
                }
              }),
            )
            const settlements = yield* ToolScheduler.make().run(preparedTools)
            yield* finalActor.publishSettlements(settlements)
            yield* finalActor.barrier
            const terminalEvents = yield* finalActor.close("completed")
            const nextAttempt = EventV2.ID.create()
            const nextAssistantMessageID = SessionMessage.ID.create()
            const timestamp = yield* DateTime.now
            yield* lifecycle.transition({
              lease,
              expectedState: "active",
              state: "active",
              phase: "dispatching",
              attemptID: nextAttempt,
              assistantMessageID: nextAssistantMessageID,
              events: [
                ...terminalEvents,
                {
                  definition: SessionEvent.ProviderAttempt.Ended,
                  data: {
                    sessionID,
                    timestamp,
                    attemptID: currentAttempt,
                    assistantMessageID: currentAssistantMessageID,
                    outcome: "completed",
                    continuation: true,
                  },
                },
                {
                  definition: SessionEvent.ProviderAttempt.Started,
                  data: {
                    sessionID,
                    timestamp,
                    attemptID: nextAttempt,
                    assistantMessageID: nextAssistantMessageID,
                    attempt: 1,
                  },
                },
              ],
            })
            yield* Ref.update(currentActors, (map) => {
              const next = new Map(map)
              next.delete(sessionID)
              return next
            })
            currentAttempt = nextAttempt
            currentAssistantMessageID = nextAssistantMessageID
            continue
          }
          const terminalEvents = finalActor ? yield* finalActor.close("completed") : []
          yield* lifecycle.terminalize({
            lease,
            events: terminalEvents,
            outcome: "completed",
            resultMessageID: currentAssistantMessageID,
          })
          if (pluginHost)
            yield* pluginHost.seams
              .run(KernelPluginHost.SeamName.turnObserve, { sessionID, outcome: "completed", result })
              .pipe(Effect.orDie)
          return yield* morePending(sessionID)
        }
      }).pipe(
        restore,
        // Fiber interruption skips the ordinary return path from any phase of
        // the turn. Settle the durable fence once, then always release the
        // process-local actor ownership entry.
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            const owned = (yield* Ref.get(currentActors)).get(sessionID)
            const terminalEvents = owned ? yield* owned.close("cancelled") : []
            yield* settleAfterInterrupt(sessionID, terminalEvents)
          }).pipe(
            Effect.catchCause((cause) => Effect.logWarning("Kernel interrupt settlement failed", { sessionID, cause })),
          ),
        ),
        Effect.ensuring(
          Ref.update(currentActors, (map) => {
            const next = new Map(map)
            next.delete(sessionID)
            return next
          }),
        ),
        Effect.ensuring(Effect.sync(() => releaseExecutionOwnership(lease))),
      ),
    )
  })

  const settleAfterInterrupt = Effect.fn("TurnCoordinator.settleAfterInterrupt")(function* (
    sessionID: SessionSchema.ID,
    events: readonly EventV2.BatchItem[] = [],
  ) {
    const current = yield* lifecycle.get(sessionID)
    if (current.state === "idle") return
    // The durable fence cleared the lease and moved the row to cancelling;
    // settle under the fenced generation.
    yield* lifecycle.settle({
      sessionID,
      expectedGeneration: current.generation,
      events,
      outcome: "cancelled",
    })
  })

  const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, never>({
    drain: (sessionID) =>
      // The drain absorbs its own interruption: the interrupt fence is
      // accepted by the store first, the reader stops interruptibly, the
      // settlement runs uninterruptibly (inside runTurn), and the drained
      // cause is consumed so the drain completes successfully.
      Effect.uninterruptibleMask((restore) =>
        restore(
          Effect.gen(function* () {
            // A pass returns whether it safely observed more work after
            // settlement. Re-reading pending input after a failed lease
            // acquisition would spin forever while the row is cancelling.
            let pending = yield* morePending(sessionID)
            while (pending) {
              pending = yield* runTurn(sessionID)
            }
          }),
        ).pipe(
          // The catch runs uninterruptibly so a pending interrupt from the
          // drain is consumed here and the drain completes successfully.
          Effect.catchCause((cause) =>
            Effect.logWarning("Kernel turn failed", { sessionID, cause }).pipe(Effect.asVoid),
          ),
        ),
      ),
  })

  const compact = Effect.fn("TurnCoordinator.compact")(function* (input: CompactInput) {
    const session = yield* store.get(input.sessionID)
    if (!session || session.engine !== "kernel")
      return yield* Effect.die(`Kernel compaction requires a Kernel Session: ${input.sessionID}`)
    const completed = yield* Deferred.make<SessionCompaction.Result>()
    const work = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const lease = yield* lifecycle.acquireIdle(session.id, "compacting").pipe(Effect.orDie)
        if (!claimExecutionOwnership(lease))
          return yield* Effect.die(`Kernel execution already has a different process-local owner: ${session.id}`)
        return yield* restore(compactSession({ session, prompt: input.prompt, reason: input.reason })).pipe(
          Effect.onInterrupt(() =>
            settleAfterInterrupt(session.id).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Kernel compaction interrupt settlement failed", {
                  sessionID: session.id,
                  cause,
                }),
              ),
            ),
          ),
          Effect.ensuring(
            lifecycle.releaseIdle(lease).pipe(
              // The interrupt fence advances the generation and clears the
              // lease before cancellation; the fenced generation settles
              // independently, so releasing the old lease is then stale.
              Effect.catchTag("StaleExecutionError", () => Effect.void),
            ),
          ),
          Effect.ensuring(Effect.sync(() => releaseExecutionOwnership(lease))),
        )
      }),
    )
    yield* coordinator.exclusive(
      session.id,
      work.pipe(
        Effect.tap((outcome) => Deferred.succeed(completed, outcome)),
        Effect.asVoid,
      ),
    )
    return yield* Deferred.await(completed)
  })

  const interrupt = Effect.fn("TurnCoordinator.interrupt")(function* (sessionID: SessionSchema.ID) {
    const startedAt = yield* Clock.currentTimeMillis
    // Durable fence before any cancellation work; the UI may only claim the
    // interrupt accepted after this commits. Persistence failure surfaces as a
    // defect so acceptance is never claimed silently.
    const snapshot = yield* lifecycle
      .get(sessionID)
      .pipe(Effect.catchTag("Session.NotFoundError", () => Effect.die(`Session execution not found: ${sessionID}`)))
    yield* lifecycle
      .acceptInterrupt({
        sessionID,
        expectedGeneration: snapshot.generation,
        reason: "user",
      })
      .pipe(Effect.catchTag("PersistenceError", (error) => Effect.die(error)))
    yield* Clock.currentTimeMillis.pipe(
      Effect.flatMap((acceptedAt) => diagnostics.add("interrupt.acceptance", acceptedAt - startedAt)),
    )
    // Signal the actor (high-priority ingress) so the provider reader stops at
    // its next event, and interrupt the session's own drain fiber so a
    // provider stream blocked on the network is cancelled without waiting for
    // the next event. Accepted returns after the fence, not settlement; the
    // reader's own interrupt is consumed by the drain's uninterruptible catch.
    const actors = yield* Ref.get(currentActors)
    const actor = actors.get(sessionID)
    if (actor) yield* actor.interrupt("user")
    yield* coordinator.interrupt(sessionID)
    yield* Clock.currentTimeMillis.pipe(
      Effect.flatMap((settledAt) => diagnostics.add("interrupt.terminal", settledAt - startedAt)),
    )
  })

  return {
    active: coordinator.active,
    run: coordinator.run,
    wake: coordinator.wake,
    wait: coordinator.wait,
    interrupt,
    compact,
  } satisfies Interface
})

const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [
    Database.node,
    EventV2.node,
    LifecycleStore.node,
    KernelDiagnostics.node,
    ProviderReader.node,
    SessionStore.node,
    LocationServiceMap.node,
  ],
})
