import { describe, expect } from "bun:test"
import { Deferred, Effect } from "effect"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { TaskCancellation } from "@opencode-ai/core/session/task-cancellation"
import { TaskNotification } from "@opencode-ai/core/session/task-notification"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { StopTaskTool } from "@opencode-ai/core/tool/stop-task"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolIdentity } from "./lib/tool"

const parentID = SessionSchema.ID.make("ses_stop_task_parent")
const otherParentID = SessionSchema.ID.make("ses_stop_task_other_parent")
const childID = SessionSchema.ID.make("ses_stop_task_child")
const NOT_FOUND = "Task not found or not owned"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      TaskNotification.node,
      TaskSubmission.node,
      TaskCancellation.node,
      BackgroundJob.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      StopTaskTool.node,
    ]),
    [
      [SessionExecution.node, SessionExecution.noopLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

const call = (taskID: string, sessionID = parentID, id = "call-stop-task") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: StopTaskTool.name, input: { task_id: taskID } },
})

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: parentID,
        project_id: Project.ID.global,
        slug: "stop-task-parent",
        directory: "/project",
        title: "stop task parent",
        version: "test",
      },
      {
        id: otherParentID,
        project_id: Project.ID.global,
        slug: "stop-task-other-parent",
        directory: "/project",
        title: "stop task other parent",
        version: "test",
      },
      {
        id: childID,
        project_id: Project.ID.global,
        parent_id: parentID,
        slug: "stop-task-child",
        directory: "/project",
        title: "stop task child",
        version: "test",
      },
    ])
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("StopTaskTool", () => {
  it.effect("stops an owned shell task and is idempotent", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const interrupted = yield* Deferred.make<void>()
      const taskID = "job_stopshell1"
      yield* jobs.start({
        id: taskID,
        type: "shell",
        title: "stuck build",
        metadata: { sessionID: parentID, background: true },
        run: Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
      })
      const registry = yield* ToolRegistry.Service

      expect((yield* settleTool(registry, call(taskID))).output?.structured).toEqual({
        taskID,
        kind: "shell",
        status: "cancelled",
        message: "Shell task stopped.",
      })
      yield* Deferred.await(interrupted)
      expect(yield* jobs.get(taskID)).toMatchObject({
        status: "cancelled",
        metadata: { suppressNotification: true },
      })
      expect(
        (yield* settleTool(registry, call(taskID, parentID, "call-stop-shell-again"))).output?.structured,
      ).toMatchObject({ status: "cancelled" })
    }),
  )

  it.effect("does not expose a shell task owned by another session", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const taskID = "job_privateowner1"
      yield* jobs.start({
        id: taskID,
        type: "shell",
        metadata: { sessionID: otherParentID, background: true },
        run: Effect.never,
      })
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call(taskID))).toEqual({ type: "error", value: NOT_FOUND })
      expect((yield* jobs.get(taskID))?.status).toBe("running")
      yield* jobs.cancel(taskID)
    }),
  )

  it.effect("cancels an owned subagent through the durable cancellation tree", () =>
    Effect.gen(function* () {
      yield* setup
      const submissions = yield* TaskSubmission.Service
      const submission = yield* submissions.submit({
        parentSessionID: parentID,
        assistantMessageID: SessionMessage.ID.make("msg_stop_task_parent_assistant"),
        toolCallID: "call-stop-task-child",
        childSessionID: childID,
        description: "Inspect cancellation",
        prompt: Prompt.make({ text: "Wait for cancellation" }),
        agent: "general",
        completionDelivery: "parent",
      })
      yield* submissions.claim(submission.id)
      const registry = yield* ToolRegistry.Service

      expect((yield* settleTool(registry, call(childID))).output?.structured).toEqual({
        taskID: childID,
        kind: "agent",
        status: "cancelled",
        message: "Subagent task stopped.",
      })
      expect(yield* submissions.latestByChild({ parentSessionID: parentID, childSessionID: childID })).toMatchObject({
        outcome: "cancelled",
      })
    }),
  )

  it.effect("rejects malformed and unknown task IDs", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(yield* executeTool(registry, call("bad"))).toEqual({ type: "error", value: "Invalid task ID" })
      expect(yield* executeTool(registry, call("job_missingtask1"))).toEqual({ type: "error", value: NOT_FOUND })
    }),
  )
})
