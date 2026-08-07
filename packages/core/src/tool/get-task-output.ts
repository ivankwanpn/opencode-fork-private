export * as GetTaskOutputTool from "./get-task-output"

import { ToolFailure } from "@opencode-ai/llm"
import { Clock, Effect, Layer, Queue, Schema, Stream } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { SessionEvent } from "../session/event"
import { SessionInput } from "../session/input"
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
  timedOut: Schema.optional(Schema.Boolean),
})

export const Output = Schema.Array(StatusRecord)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
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
                  new Set(
                    yield* Effect.forEach(input.task_ids, (taskID) =>
                      Schema.decodeUnknownEffect(SessionSchema.ID)(taskID.trim()).pipe(
                        Effect.mapError(() => new ToolFailure({ message: "Invalid task ID" })),
                      ),
                    ),
                  ),
                )
                const current = yield* Effect.forEach(taskIDs, (taskID) => resolve(context.sessionID, taskID))
                const timeout = input.timeout_ms ?? 0
                const deadline = timeout === 0 ? undefined : (yield* Clock.currentTimeMillis) + timeout
                if (deadline === undefined || current.every((submission) => submission.outcome !== undefined))
                  return current.map((submission) => toRecord(submission, false))

                const settled = yield* Effect.scoped(
                  Effect.gen(function* () {
                    const activity = yield* Queue.sliding<void>(1)
                    yield* submissions
                      .subscribe()
                      .pipe(
                        Stream.runForEach(() => Queue.offer(activity, undefined)),
                        Effect.forkScoped({ startImmediately: true }),
                      )
                    yield* events
                      .subscribe(SessionEvent.PromptAdmitted)
                      .pipe(
                        Stream.filter(
                          (event) => event.data.sessionID === context.sessionID && event.data.delivery === "steer",
                        ),
                        Stream.runForEach(() => Queue.offer(activity, undefined)),
                        Effect.forkScoped({ startImmediately: true }),
                      )
                    const observe = () =>
                      Effect.gen(function* () {
                        const snapshots = yield* Effect.forEach(taskIDs, (taskID) => resolve(context.sessionID, taskID))
                        if (snapshots.every((submission) => submission.outcome !== undefined))
                          return { done: true as const, snapshots, timedOut: false }
                        if (yield* SessionInput.hasPending(db, context.sessionID, "steer"))
                          return { done: true as const, snapshots, timedOut: false }

                        const remaining = deadline - (yield* Clock.currentTimeMillis)
                        if (remaining <= 0) return { done: true as const, snapshots, timedOut: true }
                        yield* Effect.raceFirst(Queue.take(activity), Effect.sleep(Math.min(1_000, remaining)))
                        return { done: false as const, snapshots, timedOut: false }
                      })
                    const wait = (): ReturnType<typeof observe> =>
                      observe().pipe(Effect.flatMap((state) => (state.done ? Effect.succeed(state) : wait())))
                    return yield* wait()
                  }),
                )
                return settled.snapshots.map((submission) =>
                  toRecord(submission, settled.timedOut && submission.outcome === undefined),
                )
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
  deps: [Database.node, EventV2.node, TaskSubmission.node, ToolRegistry.node],
})

function toRecord(submission: TaskSubmission.Info, timedOut: boolean): typeof StatusRecord.Type {
  return {
    taskID: submission.childSessionID,
    status: submission.status,
    description: submission.description,
    agent: submission.agent,
    timeCreated: submission.timeCreated,
    ...(submission.timeCompleted === undefined ? {} : { timeCompleted: submission.timeCompleted }),
    ...(submission.resultText === undefined ? {} : { result: submission.resultText }),
    ...(submission.error === undefined ? {} : { error: submission.error }),
    ...(timedOut ? { timedOut: true } : {}),
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
