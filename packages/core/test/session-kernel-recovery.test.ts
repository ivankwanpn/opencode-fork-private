import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecutionTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import {
  claimExecutionOwnership,
  processIncarnation,
  releaseExecutionOwnership,
} from "@opencode-ai/core/session/kernel/incarnation"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { KernelPluginHost } from "@opencode-ai/core/session/kernel/plugin-host"
import { RecoveryExecutor } from "@opencode-ai/core/session/kernel/recovery-executor"
import { RecoveryPlanner } from "@opencode-ai/core/session/kernel/recovery-planner"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const recoveryObservations: unknown[] = []
const pluginHost = Layer.succeed(
  KernelPluginHost.Service,
  KernelPluginHost.Service.of({
    install: () => Effect.die("unused"),
    disable: () => Effect.void,
    dispose: () => Effect.void,
    has: () => Effect.succeed(false),
    snapshot: () => Effect.succeed([]),
    ownedContributions: () => Effect.succeed([]),
    ui: { list: () => Effect.succeed([]) },
    services: {
      provide: () => Effect.void,
      retract: () => Effect.void,
      has: () => Effect.succeed(false),
      get: () => Effect.die("unused"),
      list: () => Effect.succeed([]),
    },
    seams: {
      register: () => Effect.succeed(Effect.void),
      active: () => Effect.succeed(0),
      run: (name, event) =>
        name === KernelPluginHost.SeamName.recoveryAdvice
          ? Effect.sync(() => {
              recoveryObservations.push(event)
              return event
            })
          : Effect.succeed(event),
    },
  }),
)
const pluginMap = pluginLocationMap(undefined, undefined, undefined, pluginHost)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      Kernel.node,
      LifecycleStore.node,
      RecoveryPlanner.node,
      RecoveryExecutor.node,
    ]),
    [[ProjectV2.node, projects], [SessionExecution.node, SessionExecution.noopLayer], pluginMap.replacement],
  ),
)

const oldProcess = "old-process-incarnation"
let labelCounter = 0

// Creates a kernel Session with an admitted prompt and drives its execution row
// into the given state, simulating a crashed owner from another process.
const seedExecution = Effect.fn("test.seedExecution")(function* (
  sessions: SessionV2.Interface,
  db: Database.Interface["db"],
  input: {
    readonly state: "active" | "retry_wait" | "needs_recovery" | "cancelling"
    readonly phase?: "admitting" | "dispatching" | "responding" | "tools" | "compacting" | "settling"
    readonly incarnation?: string
  },
) {
  labelCounter += 1
  const session = yield* sessions.create({ location, engine: "kernel" })
  const admitted = yield* sessions.prompt({
    sessionID: session.id,
    prompt: Prompt.make({ text: `Recovery ${labelCounter}` }),
    resume: false,
  })
  const turnID = SessionMessage.ID.create()
  const attemptID = EventV2.ID.create()
  const assistantMessageID = SessionMessage.ID.create()
  yield* db
    .update(SessionExecutionTable)
    .set({
      generation: 1,
      lease_token: "stale-lease",
      process_incarnation: input.incarnation ?? oldProcess,
      state: input.state,
      phase: input.phase ?? null,
      turn_id: turnID,
      input_id: admitted.id,
      attempt_id: attemptID,
      assistant_message_id: assistantMessageID,
      started_seq: 2,
      updated_seq: 4,
      time_updated: 1,
    })
    .where(eq(SessionExecutionTable.session_id, session.id))
    .run()
    .pipe(Effect.orDie)
  return { session, admitted, turnID, attemptID, assistantMessageID, inputID: admitted.id }
})

const publishTerminalEvents = Effect.fn("test.publishTerminalEvents")(function* (
  events: EventV2.Interface,
  sessionID: SessionV2.ID,
  input: {
    readonly turnID: SessionMessage.ID
    readonly attemptID: EventV2.ID
    readonly inputID: SessionMessage.ID
    readonly assistantMessageID: SessionMessage.ID
    readonly turnOutcome?: "completed" | "failed" | "interrupted" | "abandoned"
  },
) {
  const timestamp = yield* DateTime.now
  const turnOutcome = input.turnOutcome ?? "completed"
  yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
    sessionID,
    timestamp,
    attemptID: input.attemptID,
    assistantMessageID: input.assistantMessageID,
    outcome: turnOutcome,
    continuation: false,
  })
  yield* events.publish(SessionEvent.Turn.Ended, {
    sessionID,
    timestamp,
    turnID: input.turnID,
    outcome: turnOutcome,
  })
  yield* events.publish(SessionEvent.Input.Terminalized, {
    sessionID,
    timestamp,
    inputID: input.inputID,
    outcome: "completed",
    resultMessageID: input.assistantMessageID,
  })
})

describe("RecoveryPlanner", () => {
  it.effect("does not reconcile a non-Kernel execution row", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const kernel = yield* Kernel.Service
      const lifecycle = yield* LifecycleStore.Service
      recoveryObservations.length = 0
      const session = yield* sessions.create({ location, engine: "kernel" })
      yield* db
        .update(SessionTable)
        .set({ engine: "classic" })
        .where(eq(SessionTable.id, session.id))
        .run()
        .pipe(Effect.orDie)

      yield* db
        .update(SessionExecutionTable)
        .set({
          generation: 1,
          lease_token: "classic-lease",
          process_incarnation: oldProcess,
          state: "active",
          phase: "dispatching",
          time_updated: 1,
        })
        .where(eq(SessionExecutionTable.session_id, session.id))
        .run()
        .pipe(Effect.orDie)

      yield* kernel.reconcile()

      expect((yield* lifecycle.get(session.id)).state).toBe("active")
      expect(recoveryObservations).toHaveLength(0)
    }),
  )

  it.effect("classifies ambiguous dispatched work without running a provider", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const planner = yield* RecoveryPlanner.Service
      const lifecycle = yield* LifecycleStore.Service
      const { session } = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      const plan = yield* planner.plan(session.id)
      expect(plan.classification).toBe("needs-user-decision")
      expect(plan.actions).toMatchObject([{ type: "mark-recovery-required", reason: "provider-dispatch-ambiguous" }])
      // The planner is read-only and never runs provider work.
      expect((yield* lifecycle.get(session.id)).state).toBe("active")
    }),
  )

  it.effect("advises the Location host with the canonical recovery plan before fenced apply", () =>
    Effect.gen(function* () {
      recoveryObservations.length = 0
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const kernel = yield* Kernel.Service
      const lifecycle = yield* LifecycleStore.Service
      const { session } = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })

      yield* kernel.reconcile()

      expect(recoveryObservations).toHaveLength(1)
      expect(recoveryObservations[0]).toMatchObject({
        sessionID: session.id,
        plan: {
          sessionID: session.id,
          classification: "needs-user-decision",
          actions: [{ type: "mark-recovery-required", reason: "provider-dispatch-ambiguous" }],
        },
      })
      expect((yield* lifecycle.get(session.id)).state).toBe("needs_recovery")
    }),
  )
  it.effect("classifies an idle execution as no-action", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const planner = yield* RecoveryPlanner.Service
      const session = yield* sessions.create({ location, engine: "kernel" })
      const plan = yield* planner.plan(session.id)
      expect(plan.classification).toBe("no-action")
      expect(plan.actions).toEqual([])
    }),
  )

  it.effect("does not mistake a matching process incarnation for a live owner", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const planner = yield* RecoveryPlanner.Service
      const { session } = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      // A service graph can restart inside the same process. The durable
      // incarnation is therefore not proof that an execution fiber still owns
      // this Session.
      yield* db
        .update(SessionExecutionTable)
        .set({ process_incarnation: processIncarnation })
        .where(eq(SessionExecutionTable.session_id, session.id))
        .run()
        .pipe(Effect.orDie)
      const plan = yield* planner.plan(session.id)
      expect(plan.classification).toBe("needs-user-decision")
      expect(plan.evidence.ownerPresent).toBe(false)
    }),
  )

  it.effect("recognizes only an exact claimed process-local lease as a live owner", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const planner = yield* RecoveryPlanner.Service
      const lifecycle = yield* LifecycleStore.Service
      const { session } = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      yield* db
        .update(SessionExecutionTable)
        .set({ process_incarnation: processIncarnation })
        .where(eq(SessionExecutionTable.session_id, session.id))
        .run()
        .pipe(Effect.orDie)
      const snapshot = yield* lifecycle.get(session.id)
      if (!snapshot.lease) return yield* Effect.die("Seeded execution is missing its lease")
      if (!claimExecutionOwnership(snapshot.lease)) return yield* Effect.die("Failed to claim the seeded execution")
      const plan = yield* planner
        .plan(session.id)
        .pipe(Effect.ensuring(Effect.sync(() => releaseExecutionOwnership(snapshot.lease!))))

      expect(plan.classification).toBe("no-action")
      expect(plan.evidence.ownerPresent).toBe(true)
    }),
  )

  it.effect("classifies a dispatch without a response as ambiguous", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const planner = yield* RecoveryPlanner.Service
      const { session } = yield* seedExecution(sessions, db, { state: "active", phase: "dispatching" })
      const plan = yield* planner.plan(session.id)
      expect(plan.classification).toBe("needs-user-decision")
      expect(plan.actions).toMatchObject([{ type: "mark-recovery-required", reason: "provider-dispatch-ambiguous" }])
    }),
  )

  it.effect("settles from durable output when only read models are stale", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const planner = yield* RecoveryPlanner.Service
      const executor = yield* RecoveryExecutor.Service
      const lifecycle = yield* LifecycleStore.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      yield* publishTerminalEvents(events, seeded.session.id, seeded)
      const plan = yield* planner.plan(seeded.session.id)
      expect(plan.classification).toBe("settle-from-durable-output")
      yield* executor.apply(plan)
      // The row reconciled to idle without re-publishing terminal facts.
      expect((yield* lifecycle.get(seeded.session.id)).state).toBe("idle")
      expect((yield* lifecycle.get(seeded.session.id)).lease).toBeUndefined()
    }),
  )

  it.effect("classifies explicit abandonment as abandon", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const planner = yield* RecoveryPlanner.Service
      const executor = yield* RecoveryExecutor.Service
      const lifecycle = yield* LifecycleStore.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      yield* publishTerminalEvents(events, seeded.session.id, { ...seeded, turnOutcome: "abandoned" })
      const plan = yield* planner.plan(seeded.session.id)
      expect(plan.classification).toBe("abandon")
      yield* executor.apply(plan)
      expect((yield* lifecycle.get(seeded.session.id)).state).toBe("idle")
    }),
  )

  it.effect("classifies an unsettled question call as disconnected", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const planner = yield* RecoveryPlanner.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "tools" })
      yield* events.publish(SessionEvent.Tool.Called, {
        sessionID: seeded.session.id,
        timestamp: yield* DateTime.now,
        assistantMessageID: seeded.assistantMessageID,
        callID: "call_question_recovery",
        tool: "question",
        input: { questions: [] },
        provider: { executed: false },
      })

      const plan = yield* planner.plan(seeded.session.id)

      expect(plan.classification).toBe("needs-user-decision")
      expect(plan.actions).toMatchObject([{ type: "mark-recovery-required", reason: "question-disconnected" }])
    }),
  )
  it.effect("flags uncertain tool mutation and partial compaction", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const planner = yield* RecoveryPlanner.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "tools" })
      yield* events.publish(SessionEvent.Tool.Called, {
        sessionID: seeded.session.id,
        timestamp: yield* DateTime.now,
        assistantMessageID: seeded.assistantMessageID,
        callID: "call_recovery",
        tool: "echo",
        input: { text: "x" },
        provider: { executed: false },
      })
      const mutation = yield* planner.plan(seeded.session.id)
      expect(mutation.classification).toBe("needs-user-decision")
      expect(mutation.actions).toMatchObject([{ type: "mark-recovery-required", reason: "mutation-outcome-unknown" }])

      const { session: compacting } = yield* seedExecution(sessions, db, {
        state: "active",
        phase: "compacting",
      })
      const compaction = yield* planner.plan(compacting.id)
      expect(compaction.classification).toBe("needs-user-decision")
      expect(compaction.actions).toMatchObject([{ type: "mark-recovery-required", reason: "compaction-partial" }])
    }),
  )

  it.effect("does not treat a previous turn's terminal facts as compaction completion", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const planner = yield* RecoveryPlanner.Service
      const executor = yield* RecoveryExecutor.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      yield* publishTerminalEvents(events, seeded.session.id, seeded)
      yield* planner.plan(seeded.session.id).pipe(Effect.flatMap((plan) => executor.apply(plan)))

      yield* lifecycle.acquireIdle(seeded.session.id, "compacting")
      const compaction = yield* planner.plan(seeded.session.id)

      expect(compaction.classification).toBe("needs-user-decision")
      expect(compaction.actions).toMatchObject([{ type: "mark-recovery-required", reason: "compaction-partial" }])
    }),
  )

  it.effect("revalidates generation and sequence before applying a plan", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const planner = yield* RecoveryPlanner.Service
      const executor = yield* RecoveryExecutor.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      const plan = yield* planner.plan(seeded.session.id)
      // A concurrent commit advances the aggregate sequence.
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: seeded.session.id,
        messageID: SessionMessage.ID.create(),
        timestamp: yield* DateTime.now,
        text: "concurrent",
      })
      const error = yield* executor.apply(plan).pipe(Effect.flip)
      expect(error).toMatchObject({
        _tag: "RecoveryPlanStaleError",
        expectedGeneration: plan.generation,
        expectedSeq: plan.latestSeq,
      })
    }),
  )

  it.effect("applies mark-recovery-required idempotently", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const planner = yield* RecoveryPlanner.Service
      const executor = yield* RecoveryExecutor.Service
      const lifecycle = yield* LifecycleStore.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      const plan = yield* planner.plan(seeded.session.id)
      yield* executor.apply(plan)
      const snapshot = yield* lifecycle.get(seeded.session.id)
      expect(snapshot.state).toBe("needs_recovery")
      expect(snapshot.recoveryReason).toBe("provider-dispatch-ambiguous")
      expect(snapshot.lease).toBeUndefined()
    }),
  )

  it.effect("does not reclassify a recovery decision during a later reconcile", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const kernel = yield* Kernel.Service
      const lifecycle = yield* LifecycleStore.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      const plan = yield* RecoveryPlanner.Service.pipe(Effect.flatMap((planner) => planner.plan(seeded.session.id)))
      yield* RecoveryExecutor.Service.pipe(Effect.flatMap((executor) => executor.apply(plan)))
      const before = yield* EventV2.latestSequence(db, seeded.session.id)

      yield* kernel.reconcile()

      const after = yield* lifecycle.get(seeded.session.id)
      expect(after.state).toBe("needs_recovery")
      expect(after.recoveryReason).toBe("provider-dispatch-ambiguous")
      expect(yield* EventV2.latestSequence(db, seeded.session.id)).toBe(before)
    }),
  )

  it.effect("repair-outbox is an idempotent no-op while delivery is pending", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const executor = yield* RecoveryExecutor.Service
      const lifecycle = yield* LifecycleStore.Service
      const seeded = yield* seedExecution(sessions, db, { state: "active", phase: "responding" })
      const snapshot = yield* lifecycle.get(seeded.session.id)
      const latestSeq = yield* EventV2.latestSequence(db, seeded.session.id)
      // Hand-built plan carrying only the outbox repair action.
      yield* executor.apply({
        sessionID: seeded.session.id,
        generation: snapshot.generation,
        latestSeq,
        classification: "needs-user-decision",
        evidence: {
          execution: snapshot,
          latestSeq,
          durableTypes: [],
          ownerPresent: false,
          projectedOutputComplete: false,
          uncertainMutation: false,
        },
        actions: [{ type: "repair-outbox", outboxID: "outbox_missing" }],
      })
      // The plan applied without error and changed no durable state.
      expect((yield* lifecycle.get(seeded.session.id)).state).toBe("active")
    }),
  )
})
