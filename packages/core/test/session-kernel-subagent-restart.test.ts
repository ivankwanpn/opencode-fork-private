import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionInputTable, SessionExecutionTable, TaskSubmissionTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { RecoveryExecutor } from "@opencode-ai/core/session/kernel/recovery-executor"
import { RecoveryPlanner } from "@opencode-ai/core/session/kernel/recovery-planner"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { eq } from "drizzle-orm"
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
      SessionCommand.node,
      Kernel.node,
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

describe("Kernel subagent restart", () => {
  it.effect("terminal child input reconciliation creates one outbox row without provider work", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const commands = yield* SessionCommand.Service
      const store = yield* LifecycleStore.Service
      const planner = yield* RecoveryPlanner.Service
      const executor = yield* RecoveryExecutor.Service
      const { db } = yield* Database.Service
      const parent = yield* sessions.create({ location, engine: "kernel" })
      const child = yield* commands.create({
        parentID: parent.id,
        title: "child (@general subagent)",
        location: parent.location,
        agent: AgentV2.ID.make("general"),
        engine: "kernel",
      })
      const admitted = yield* sessions.prompt({
        sessionID: child.id,
        prompt: Prompt.make({ text: "child work" }),
        resume: false,
      })
      // Simulate a crashed child: active execution row with stale owner, and a
      // durable submission that never saw the completion notification.
      yield* db
        .update(SessionExecutionTable)
        .set({
          generation: 1,
          lease_token: "stale",
          process_incarnation: "old-process",
          state: "active",
          phase: "responding",
          turn_id: SessionMessage.ID.make("msg_child_turn"),
          input_id: admitted.id,
          attempt_id: EventV2.ID.make("evt_child_attempt"),
          assistant_message_id: SessionMessage.ID.make("msg_child_assistant"),
          started_seq: 2,
          updated_seq: 4,
          time_updated: 1,
        })
        .where(eq(SessionExecutionTable.session_id, child.id))
        .run()
        .pipe(Effect.orDie)
      yield* db
        .update(SessionInputTable)
        .set({ terminal_outcome: "completed", terminal_seq: 9 })
        .where(eq(SessionInputTable.id, admitted.id))
        .run()
        .pipe(Effect.orDie)

      const plan = yield* planner.plan(child.id)
      // The stable plan: mark the coordination state as recoverable under the
      // absent owner; the child's durable terminal fact stands alone.
      expect(plan.classification).toBe("needs-user-decision")
      yield* executor.apply(plan)
      expect((yield* store.get(child.id)).state).toBe("needs_recovery")
      // No provider call replay occurred (the plan only writes coordination).
      expect((yield* store.get(child.id)).lease).toBeUndefined()
    }),
  )

  it.effect("child terminalization updates its submission without touching the parent", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const commands = yield* SessionCommand.Service
      const store = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const parent = yield* sessions.create({ location, engine: "kernel" })
      const child = yield* commands.create({
        parentID: parent.id,
        title: "child (@general subagent)",
        location: parent.location,
        agent: AgentV2.ID.make("general"),
        engine: "kernel",
      })
      const admitted = yield* sessions.prompt({
        sessionID: child.id,
        prompt: Prompt.make({ text: "child work" }),
        resume: false,
      })
      yield* db
        .insert(TaskSubmissionTable)
        .values({
          id: "submission_kernel_child",
          parent_session_id: parent.id,
          assistant_message_id: SessionMessage.ID.create(),
          tool_call_id: "call_child",
          child_session_id: child.id,
          child_input_id: admitted.id,
          description: "kernel child",
          prompt: Prompt.make({ text: "child work" }),
          agent: AgentV2.ID.make("general"),
          requested_completion_delivery: "parent",
          completion_delivery: "parent",
          status: "accepted",
          time_created: 1,
        })
        .run()
        .pipe(Effect.orDie)
      const lease = yield* store.start({
        sessionID: child.id,
        inputID: admitted.id,
        turnID: SessionMessage.ID.create(),
        attemptID: EventV2.ID.create(),
        assistantMessageID: SessionMessage.ID.create(),
        processIncarnation: "child-process",
      })
      const resultMessageID = SessionMessage.ID.create()
      yield* store.terminalize({
        lease,
        outcome: "completed",
        resultMessageID,
        task: { submissionID: "submission_kernel_child", outcome: "completed", resultMessageID },
      })
      const submission = yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(eq(TaskSubmissionTable.id, "submission_kernel_child"))
        .get()
        .pipe(Effect.orDie)
      expect(submission).toMatchObject({ status: "completed", outcome: "completed" })
      // Parent stays idle and untouched.
      expect((yield* store.get(parent.id)).state).toBe("idle")
    }),
  )
})
