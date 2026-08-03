export * as GetTaskOutputTool from "./get-task-output"

import { ToolFailure } from "@opencode-ai/llm"
import { Clock, Effect, Layer, Schema } from "effect"
import { BackgroundJob } from "../background-job"
import { makeLocationNode } from "../effect/app-node"
import { SessionSchema } from "../session/schema"
import { TaskSubmission } from "../session/task-submission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "get_task_output"

export const Input = Schema.Struct({
  task_ids: Schema.Array(Schema.String)
    .check(Schema.isLengthBetween(1, 20))
    .annotate({ description: "Task IDs returned by the task tool" }),
  timeout_ms: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 600_000 })).annotate({
      description: "Maximum time to wait for all running tasks; omitted or zero returns an immediate snapshot",
    }),
  ),
})

export const StatusRecord = Schema.Struct({
  taskID: SessionSchema.ID,
  status: Schema.Literals(["accepted", "running", "completed", "error", "cancelled", "recovery-required"]),
  description: Schema.String,
  agent: Schema.String,
  timeCreated: Schema.Number,
  timeCompleted: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Unknown),
})

export const Output = Schema.Array(StatusRecord)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const submissions = yield* TaskSubmission.Service
    const tools = yield* Tools.Service

    const resolve = Effect.fn("GetTaskOutputTool.resolve")(function* (
      parentSessionID: SessionSchema.ID,
      childSessionID: SessionSchema.ID,
    ) {
      const submission = yield* submissions.latestByChild({ parentSessionID, childSessionID })
      if (!submission) return yield* new ToolFailure({ message: "Task not found or not owned" })
      return submission
    })

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Return durable status snapshots for owned tasks. A positive timeout waits up to one shared deadline; use bounded waits deliberately rather than polling.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => output.map((record) => ({ type: "text", text: render(record) })),
            execute: (input, context) =>
              Effect.gen(function* () {
                const taskIDs = Array.from(
                  new Set(input.task_ids.map((taskID) => SessionSchema.ID.make(taskID.trim()))),
                )
                const current = yield* Effect.forEach(taskIDs, (taskID) => resolve(context.sessionID, taskID))
                if ((input.timeout_ms ?? 0) > 0) {
                  const deadline = (yield* Clock.currentTimeMillis) + input.timeout_ms!
                  yield* Effect.forEach(
                    current.filter((submission) => submission.outcome === undefined),
                    (submission) =>
                      Effect.gen(function* () {
                        const job = yield* background.get(submission.childSessionID)
                        if (job?.status !== "running") return
                        yield* background.wait({
                          id: submission.childSessionID,
                          timeout: Math.max(0, deadline - (yield* Clock.currentTimeMillis)),
                        })
                      }),
                    { concurrency: "unbounded", discard: true },
                  )
                }
                return (yield* Effect.forEach(taskIDs, (taskID) => resolve(context.sessionID, taskID))).map(toRecord)
              }),
          }),
          "task",
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/get-task-output",
  layer,
  deps: [BackgroundJob.node, TaskSubmission.node, ToolRegistry.node],
})

function toRecord(submission: TaskSubmission.Info): typeof StatusRecord.Type {
  return {
    taskID: submission.childSessionID,
    status: submission.status,
    description: submission.description,
    agent: submission.agent,
    timeCreated: submission.timeCreated,
    ...(submission.timeCompleted === undefined ? {} : { timeCompleted: submission.timeCompleted }),
    ...(submission.resultText === undefined ? {} : { result: submission.resultText }),
    ...(submission.error === undefined ? {} : { error: submission.error }),
  }
}

function render(record: typeof StatusRecord.Encoded) {
  const body =
    record.status === "completed"
      ? ["<task_result>", record.result ?? "", "</task_result>"]
      : record.status === "accepted" || record.status === "running"
        ? ["<task_status>", `Task is ${record.status}.`, "</task_status>"]
        : ["<task_error>", errorText(record.error), "</task_error>"]
  return [
    `<task id="${record.taskID}" state="${record.status}">`,
    `<summary>${record.description}</summary>`,
    ...body,
    "</task>",
  ].join("\n")
}

function errorText(error: unknown) {
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
  return error === undefined ? "Task ended without an error detail." : String(error)
}
