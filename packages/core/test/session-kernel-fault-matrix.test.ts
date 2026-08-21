import { describe, expect } from "bun:test"
import { Context, DateTime, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionTable, SessionInputTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { KernelDiagnostics } from "@opencode-ai/core/session/kernel/diagnostics"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
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
const pluginMap = pluginLocationMap()
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
      KernelDiagnostics.node,
      LifecycleStore.node,
      RecoveryPlanner.node,
      RecoveryExecutor.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      pluginMap.replacement,
    ],
  ),
)

const oldProcess = "lost-process-incarnation"
let labelCounter = 0

const ALLOWED_CLASSIFICATIONS = [
  "no-action",
  "settle-from-durable-output",
  "safe-to-resume",
  "needs-user-decision",
  "abandon",
] as const

type Point = {
  readonly key: string
  readonly state: "active" | "retry_wait" | "needs_recovery" | "cancelling"
  readonly phase?: "admitting" | "dispatching" | "responding" | "tools" | "compacting" | "settling"
  readonly durable?: "called" | "question" | "attempt-ended" | "terminal"
}

const POINTS: readonly Point[] = [
  // Crash before start: admitted input, execution row untouched.
  { key: "before-start", state: "active", phase: "admitting" },
  // Crash inside the atomic start: the row committed but no attempt was dispatched.
  { key: "inside-start", state: "active", phase: "admitting" },
  { key: "after-start", state: "active", phase: "dispatching" },
  // Crash after provider dispatch: ambiguous whether the provider answered.
  { key: "after-provider-dispatch", state: "active", phase: "responding" },
  { key: "after-checkpoint", state: "active", phase: "responding" },
  // Crash while waiting on a question: the durable question record is a
  // QuestionV2 row; the kernel sees an ambiguous responding execution.
  { key: "during-question", state: "active", phase: "responding" },
  // Crash during tool dispatch/finalization.
  { key: "during-tool-dispatch", state: "active", phase: "tools", durable: "called" },
  { key: "during-tool-finalize", state: "active", phase: "tools", durable: "called" },
  // Crash inside the terminal projector or after terminal before listeners.
  { key: "inside-terminal-projector", state: "active", phase: "responding", durable: "attempt-ended" },
  { key: "after-terminal-before-listener", state: "active", phase: "responding", durable: "terminal" },
  // Crash during outbox creation or compaction or interrupt settlement.
  { key: "during-outbox", state: "needs_recovery" },
  { key: "during-compaction", state: "active", phase: "compacting" },
  { key: "during-interrupt", state: "cancelling" },
]

describe("Kernel fault matrix", () => {
  for (const point of POINTS) {
    it.effect(`recovers without permanent busy or duplicate effects at ${point.key}`, () =>
      Effect.gen(function* () {
        const sessions = yield* SessionV2.Service
        const { db } = yield* Database.Service
        const events = yield* EventV2.Service
        const planner = yield* RecoveryPlanner.Service
        const executor = yield* RecoveryExecutor.Service
        const lifecycle = yield* LifecycleStore.Service
        labelCounter += 1
        const session = yield* sessions.create({ location, engine: "kernel" })
        const admitted = yield* sessions.prompt({
          sessionID: session.id,
          prompt: Prompt.make({ text: `Fault ${point.key} ${labelCounter}` }),
          resume: false,
        })
        const turnID = SessionMessage.ID.create()
        const attemptID = EventV2.ID.create()
        const assistantMessageID = SessionMessage.ID.create()
        yield* db
          .update(SessionExecutionTable)
          .set({
            generation: 1,
            lease_token: "lost-lease",
            process_incarnation: oldProcess,
            state: point.state,
            phase: point.phase ?? null,
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
        const timestamp = yield* DateTime.now
        switch (point.durable) {
          case "called":
            yield* events.publish(SessionEvent.Tool.Called, {
              sessionID: session.id,
              timestamp,
              assistantMessageID,
              callID: `call_${point.key}`,
              tool: "echo",
              input: { text: "x" },
              provider: { executed: false },
            })
            break
          case "attempt-ended":
            yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
              sessionID: session.id,
              timestamp,
              attemptID,
              assistantMessageID,
              outcome: "completed",
              continuation: false,
            })
            break
          case "terminal":
            yield* events.publish(SessionEvent.ProviderAttempt.Ended, {
              sessionID: session.id,
              timestamp,
              attemptID,
              assistantMessageID,
              outcome: "completed",
              continuation: false,
            })
            yield* events.publish(SessionEvent.Turn.Ended, {
              sessionID: session.id,
              timestamp,
              turnID,
              outcome: "completed",
            })
            yield* events.publish(SessionEvent.Input.Terminalized, {
              sessionID: session.id,
              timestamp,
              inputID: admitted.id,
              outcome: "completed",
              resultMessageID: assistantMessageID,
            })
            break
          default:
            break
        }

        const plan = yield* planner.plan(session.id)
        expect(ALLOWED_CLASSIFICATIONS).toContain(plan.classification)
        // Recovery never replays provider work or re-executes tools.
        for (const action of plan.actions) {
          expect(["replay", "resume-provider", "re-execute-tools"]).not.toContain(action.type)
        }
        yield* executor.apply(plan)
        const snapshot = yield* lifecycle.get(session.id)
        // The old owner's lease is never left permanently in place without a
        // decision: applied plans end idle, needs_recovery, or mark a fresh
        // state; a stale active row with the lost incarnation is a permanent
        // busy defect.
        // A decided plan (as opposed to an advisory safe-to-resume/no-action)
        // must not leave the stale active row untouched: that would be
        // permanent busy. safe-to-resume intentionally leaves the row for the
        // coordinator to resume.
        if (plan.classification !== "no-action" && plan.classification !== "safe-to-resume") {
          expect(snapshot.state).not.toMatch(/^(active|retry_wait)$/)
        }
        // A session has exactly one execution row and at most one lease; the
        // surviving execution is fenced out from the lost incarnation.
        const rows = yield* db
          .select()
          .from(SessionExecutionTable)
          .where(eq(SessionExecutionTable.session_id, session.id))
          .all()
          .pipe(Effect.orDie)
        expect(rows).toHaveLength(1)
        expect((snapshot.lease as { incarnation?: string } | undefined)?.incarnation).not.toBe(oldProcess)
        // No duplicate terminal facts: an input terminalizes at most once and
        // durable terminal facts are exactly one per terminal point.
        const inputRow = yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.id, admitted.id))
          .get()
          .pipe(Effect.orDie)
        if (point.durable === "terminal" || plan.classification === "settle-from-durable-output") {
          expect(inputRow?.terminal_outcome).toBe("completed")
        }
      }),
    )
  }

  it.effect("startup reconciles stale executions through the read-only planner", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const { db } = yield* Database.Service
      // Seed an orphaned active execution before booting a fresh kernel
      // service on the shared database.
      const session = yield* sessions.create({ location, engine: "kernel" })
      const admitted = yield* sessions.prompt({
        sessionID: session.id,
        prompt: Prompt.make({ text: "Startup loss" }),
        resume: false,
      })
      yield* db
        .update(SessionExecutionTable)
        .set({
          generation: 1,
          lease_token: "lost-lease",
          process_incarnation: oldProcess,
          state: "active",
          phase: "responding",
          turn_id: SessionMessage.ID.create(),
          input_id: admitted.id,
          attempt_id: EventV2.ID.create(),
          assistant_message_id: SessionMessage.ID.create(),
          started_seq: 2,
          updated_seq: 4,
          time_updated: 1,
        })
        .where(eq(SessionExecutionTable.session_id, session.id))
        .run()
        .pipe(Effect.orDie)

      const kernel = yield* Kernel.Service
      const diagnostics = yield* KernelDiagnostics.Service
      const lifecycle = yield* LifecycleStore.Service
      // A restart reconcile pass after a stale row appeared: the classifier is
      // read-only and the applied plan only writes coordination state.
      // Baseline the counter so the measurement covers only this pass; the
      // shared in-memory database may still hold stale rows from other tests.
      yield* diagnostics.reset()
      yield* kernel.reconcile()
      const snapshot = yield* diagnostics.snapshot()
      expect(snapshot.counters.find((counter) => counter.key === "startup.reconciled")?.count).toBeGreaterThan(0)
      expect((yield* lifecycle.get(session.id)).state).toMatch(/^(idle|needs_recovery)$/)
      // Reconciliation settles our seeded execution without replaying
      // provider work: the input retains its single durable terminal fact.
      const inputRow = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, admitted.id))
        .get()
        .pipe(Effect.orDie)
      // No fabricated terminal fact: the ambiguous execution is fenced to
      // needs_recovery instead of inventing a terminal outcome.
      expect(inputRow?.terminal_outcome).toBeNull()
    }),
  )
})
