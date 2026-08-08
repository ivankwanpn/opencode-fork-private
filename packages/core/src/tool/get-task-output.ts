export * as GetTaskOutputTool from "./get-task-output"

import { ToolFailure } from "@opencode-ai/llm"
import { Clock, Effect, Layer, Queue, Schema, Stream } from "effect"
import { BackgroundJob } from "../background-job"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
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
    .annotate({ description: "Task IDs returned by the task or bash tool" }),
  timeout_ms: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 600_000 })).annotate({
      description: "Maximum time to wait for all running tasks; omitted or zero returns an immediate snapshot",
    }),
  ),
})

export const StatusRecord = Schema.Struct({
  taskID: Schema.String,
  status: Schema.Literals(["accepted", "running", "completed", "error", "cancelled", "recovery-required"]),
  description: Schema.String,
  agent: Schema.String,
  kind: Schema.Literal("shell").pipe(Schema.optional),
  timeCreated: Schema.Number,
  timeCompleted: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Unknown),
  outputBytes: Schema.optional(Schema.Number),
  lastOutputAt: Schema.optional(Schema.Number),
  runningForMs: Schema.optional(Schema.Number),
  idleForMs: Schema.optional(Schema.Number),
  timedOut: Schema.optional(Schema.Boolean),
})

export const Output = Schema.Array(StatusRecord)

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const submissions = yield* TaskSubmission.Service
    const jobs = yield* BackgroundJob.Service
    const tools = yield* Tools.Service

    const resolve = Effect.fn("GetTaskOutputTool.resolve")(function* (
      parentSessionID: SessionSchema.ID,
      taskID: string,
    ) {
      if (taskID.startsWith("job_")) {
        const job = yield* jobs.get(taskID)
        if (job?.type !== "shell" || job.metadata?.sessionID !== parentSessionID)
          return yield* new ToolFailure({ message: "Task not found or not owned" })
        return { type: "shell" as const, info: job }
      }
      const childSessionID = yield* Schema.decodeUnknownEffect(SessionSchema.ID)(taskID).pipe(
        Effect.mapError(() => new ToolFailure({ message: "Invalid task ID" })),
      )
      const submission = yield* submissions.latestByChild({ parentSessionID, childSessionID })
      if (!submission) return yield* new ToolFailure({ message: "Task not found or not owned" })
      return { type: "agent" as const, info: submission }
    })

    yield* tools
      .register({
        [name]: Tool.withPermissions(
          Tool.make({
            description:
              "Return status and output snapshots for owned subagent and shell tasks. Shell snapshots include recent live output and activity metadata. A positive timeout waits up to one shared deadline; use bounded waits deliberately rather than polling. Process-local shell tasks become unavailable after a runtime restart and are never reported as still running without a live owner.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => output.map((record) => ({ type: "text", text: render(record) })),
            execute: (input, context) =>
              Effect.gen(function* () {
                const taskIDs = Array.from(
                  new Set(
                    yield* Effect.forEach(input.task_ids, (taskID) => {
                      const normalized = taskID.trim()
                      if (/^job_[A-Za-z0-9]+$/.test(normalized)) return Effect.succeed(normalized)
                      return Schema.decodeUnknownEffect(SessionSchema.ID)(normalized).pipe(
                        Effect.map(String),
                        Effect.mapError(() => new ToolFailure({ message: "Invalid task ID" })),
                      )
                    }),
                  ),
                )
                const current = yield* Effect.forEach(taskIDs, (taskID) => resolve(context.sessionID, taskID))
                const timeout = input.timeout_ms ?? 0
                const observedAt = yield* Clock.currentTimeMillis
                const deadline = timeout === 0 ? undefined : observedAt + timeout
                if (deadline === undefined || current.every(terminal))
                  return current.map((snapshot) => toRecord(snapshot, false, observedAt))

                const settled = yield* Effect.scoped(
                  Effect.gen(function* () {
                    const activity = yield* Queue.sliding<void>(1)
                    yield* submissions
                      .subscribe()
                      .pipe(
                        Stream.runForEach(() => Queue.offer(activity, undefined)),
                        Effect.forkScoped({ startImmediately: true }),
                      )
                    yield* Effect.forEach(
                      current.filter((snapshot) => snapshot.type === "shell" && snapshot.info.status === "running"),
                      (snapshot) =>
                        jobs.wait({ id: snapshot.info.id }).pipe(
                          Effect.andThen(Queue.offer(activity, undefined)),
                          Effect.forkScoped({ startImmediately: true }),
                        ),
                      { discard: true },
                    )
                    yield* SessionInput.waitForPending(db, events, {
                      sessionID: context.sessionID,
                      delivery: "steer",
                    }).pipe(
                      Effect.andThen(Queue.offer(activity, undefined)),
                      Effect.forkScoped({ startImmediately: true }),
                    )
                    const observe = () =>
                      Effect.gen(function* () {
                        const snapshots = yield* Effect.forEach(taskIDs, (taskID) => resolve(context.sessionID, taskID))
                        if (snapshots.every(terminal))
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
                const completedAt = yield* Clock.currentTimeMillis
                return settled.snapshots.map((snapshot) =>
                  toRecord(snapshot, settled.timedOut && !terminal(snapshot), completedAt),
                )
              }),
          }),
          ["task", "bash"],
        ),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/get-task-output",
  layer,
  deps: [Database.node, EventV2.node, TaskSubmission.node, BackgroundJob.node, ToolRegistry.node],
})

type Snapshot =
  | { readonly type: "agent"; readonly info: TaskSubmission.Info }
  | { readonly type: "shell"; readonly info: BackgroundJob.Info }

function terminal(snapshot: Snapshot) {
  if (snapshot.type === "shell") return snapshot.info.status !== "running"
  return snapshot.info.outcome !== undefined
}

function toRecord(snapshot: Snapshot, timedOut: boolean, observedAt: number): typeof StatusRecord.Type {
  if (snapshot.type === "shell") {
    const outputBytes = snapshot.info.metadata?.outputBytes
    const lastOutputAt = snapshot.info.metadata?.lastOutputAt
    const running = snapshot.info.status === "running"
    return {
      taskID: snapshot.info.id,
      status: snapshot.info.status,
      description:
        snapshot.info.title ??
        (typeof snapshot.info.metadata?.command === "string" ? snapshot.info.metadata.command : "Shell command"),
      agent: typeof snapshot.info.metadata?.agent === "string" ? snapshot.info.metadata.agent : "shell",
      kind: "shell",
      timeCreated: snapshot.info.started_at,
      ...(snapshot.info.completed_at === undefined ? {} : { timeCompleted: snapshot.info.completed_at }),
      ...(snapshot.info.output === undefined ? {} : { result: snapshot.info.output }),
      ...(snapshot.info.error === undefined ? {} : { error: snapshot.info.error }),
      ...(typeof outputBytes === "number" ? { outputBytes } : {}),
      ...(typeof lastOutputAt === "number" ? { lastOutputAt } : {}),
      ...(running ? { runningForMs: Math.max(0, observedAt - snapshot.info.started_at) } : {}),
      ...(running
        ? { idleForMs: Math.max(0, observedAt - (typeof lastOutputAt === "number" ? lastOutputAt : snapshot.info.started_at)) }
        : {}),
      ...(timedOut ? { timedOut: true } : {}),
    }
  }
  const submission = snapshot.info
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
  if (record.kind === "shell") {
    const activity =
      record.outputBytes === undefined || record.outputBytes === 0
        ? `No output has been captured yet. The process is still owned and running${record.runningForMs === undefined ? "." : `; it has run silently for ${duration(record.runningForMs)}.`}`
        : `Captured ${record.outputBytes} output bytes${record.idleForMs === undefined ? "." : `; the process is still owned and its last output was ${duration(record.idleForMs)} ago.`}`
    const body =
      record.status === "completed"
        ? ["<task_result>", record.result ?? "", "</task_result>"]
        : record.status === "running"
          ? [
              "<task_status>",
              activity,
              ...(record.result === undefined ? [] : ["<task_output>", record.result, "</task_output>"]),
              "</task_status>",
            ]
          : ["<task_error>", errorText(record.error), "</task_error>"]
    return [
      `<task id="${record.taskID}" type="shell" state="${record.status}">`,
      `<summary>${record.description}</summary>`,
      ...body,
      "</task>",
    ].join("\n")
  }
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

function duration(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds} ms`
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)} s`
  return `${Math.floor(milliseconds / 60_000)} min ${Math.floor((milliseconds % 60_000) / 1_000)} s`
}
