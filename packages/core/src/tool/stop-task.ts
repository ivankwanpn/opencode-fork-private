export * as StopTaskTool from "./stop-task"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { BackgroundJob } from "../background-job"
import { makeLocationNode } from "../effect/app-node"
import { SessionExecution } from "../session/execution"
import { SessionSchema } from "../session/schema"
import { TaskCancellation } from "../session/task-cancellation"
import { TaskSubmission } from "../session/task-submission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "stop_task"

export const Input = Schema.Struct({
  task_id: Schema.String.annotate({ description: "Owned task ID returned by the task or bash tool" }),
})

export const Output = Schema.Struct({
  taskID: Schema.String,
  kind: Schema.Literals(["agent", "shell"]),
  status: Schema.Literals(["completed", "error", "cancelled", "recovery-required"]),
  message: Schema.String,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service
    const submissions = yield* TaskSubmission.Service
    const cancellation = yield* TaskCancellation.Service
    const execution = yield* SessionExecution.Service
    const tools = yield* Tools.Service

    yield* tools
      .register({
        [name]: Tool.withPermissions(
          Tool.make({
            description:
              "Stop one owned running shell or subagent task. Completed tasks are reported without being changed. Use this only for an explicit cancellation decision; use get_task_output to inspect status and output first.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [
              {
                type: "text",
                text: `<task id="${output.taskID}" type="${output.kind}" state="${output.status}">\n${output.message}\n</task>`,
              },
            ],
            execute: (input, context) =>
              Effect.gen(function* () {
                const taskID = input.task_id.trim()
                if (/^job_[A-Za-z0-9]+$/.test(taskID)) {
                  const info = yield* jobs.get(taskID)
                  if (info?.type !== "shell" || info.metadata?.sessionID !== context.sessionID)
                    return yield* new ToolFailure({ message: "Task not found or not owned" })
                  if (info.status !== "running") return terminalShell(info)
                  yield* jobs.update({ id: taskID, metadata: { suppressNotification: true } })
                  const stopped = yield* jobs.cancel(taskID)
                  if (!stopped) return yield* new ToolFailure({ message: "Task not found or not owned" })
                  return terminalShell(stopped)
                }

                const childSessionID = yield* Schema.decodeUnknownEffect(SessionSchema.ID)(taskID).pipe(
                  Effect.mapError(() => new ToolFailure({ message: "Invalid task ID" })),
                )
                const submission = yield* submissions.latestByChild({
                  parentSessionID: context.sessionID,
                  childSessionID,
                })
                if (!submission) return yield* new ToolFailure({ message: "Task not found or not owned" })
                if (submission.outcome !== undefined) return terminalAgent(submission)
                yield* cancellation
                  .cancelTree({
                    rootSessionID: childSessionID,
                    interrupt: execution.interrupt,
                    wait: execution.wait,
                  })
                  .pipe(Effect.mapError(() => new ToolFailure({ message: "Task not found or not owned" })))
                const stopped = yield* submissions.latestByChild({
                  parentSessionID: context.sessionID,
                  childSessionID,
                })
                if (!stopped) return yield* new ToolFailure({ message: "Task not found or not owned" })
                return terminalAgent(stopped)
              }),
          }),
          ["task", "bash"],
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/stop-task",
  layer,
  deps: [
    BackgroundJob.node,
    TaskSubmission.node,
    TaskCancellation.node,
    SessionExecution.node,
    ToolRegistry.node,
  ],
})

function terminalShell(info: BackgroundJob.Info): typeof Output.Type {
  const status = info.status === "running" ? "cancelled" : info.status
  return {
    taskID: info.id,
    kind: "shell",
    status,
    message: status === "cancelled" ? "Shell task stopped." : `Shell task already ${status}.`,
  }
}

function terminalAgent(info: TaskSubmission.Info): typeof Output.Type {
  const status = info.outcome ?? "cancelled"
  return {
    taskID: info.childSessionID,
    kind: "agent",
    status,
    message: status === "cancelled" ? "Subagent task stopped." : `Subagent task already ${status}.`,
  }
}
