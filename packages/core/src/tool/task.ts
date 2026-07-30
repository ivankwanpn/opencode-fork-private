export * as TaskTool from "./task"

import { ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { BackgroundJob } from "../background-job"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { ModelV2 } from "../model"
import { PermissionV2 } from "../permission"
import { SessionCommand } from "../session/command"
import { SessionExecution } from "../session/execution"
import { SessionAttempt } from "../session/attempt"
import { SessionMessage } from "../session/message"
import { Prompt } from "../session/prompt"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { TaskNotification } from "../session/task-notification"
import { TaskCancellation } from "../session/task-cancellation"
import { TaskSubmission } from "../session/task-submission"
import { ToolProgress } from "./progress"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { Flag } from "../flag/flag"

export const name = "task"

const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")

const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work.",
].join("\n")

const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work.",
].join("\n")

export const description = `Launch a new agent to handle complex, multistep tasks autonomously.

Use task_id only to continue an existing child session. Each fresh invocation otherwise creates a durable child session.

Do not delegate a specific file read or a narrow symbol search; use direct read, glob, or grep tools instead. Clearly state whether the subagent should write code or only research, and include enough context for it to work autonomously.`

const InputFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "A prior task ID to continue the same child session",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const ForegroundInput = Schema.Struct(InputFields)

export const Input = Schema.Struct({
  ...InputFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run asynchronously and notify the parent session when complete",
  }),
})

const ModelMetadata = Schema.Struct({
  modelID: Schema.String,
  providerID: Schema.String,
  variant: Schema.optional(Schema.String),
})

export const Metadata = Schema.Struct({
  parentSessionId: SessionSchema.ID,
  sessionId: SessionSchema.ID,
  agent: AgentV2.ID,
  model: Schema.optional(ModelMetadata),
  background: Schema.optional(Schema.Boolean),
  jobId: Schema.optional(Schema.String),
})

export const Output = Schema.Struct({
  title: Schema.String,
  metadata: Metadata,
  output: Schema.String,
})

function renderOutput(input: {
  sessionID: SessionSchema.ID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

const modelMetadata = (model: ModelV2.Ref | undefined) =>
  model
    ? {
        modelID: model.id,
        providerID: model.providerID,
        ...(model.variant === undefined ? {} : { variant: model.variant }),
      }
    : undefined

export interface LayerOptions {
  readonly background?: boolean
}

export const layerWithOptions = (options: LayerOptions = {}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const agents = yield* AgentV2.Service
      const background = yield* BackgroundJob.Service
      const commands = yield* SessionCommand.Service
      const config = yield* Config.Service
      const execution = yield* SessionExecution.Service
      const permission = yield* PermissionV2.Service
      const progress = yield* ToolProgress.Service
      const sessions = yield* SessionStore.Service
      const notifications = yield* TaskNotification.Service
      const cancellation = yield* TaskCancellation.Service
      const submissions = yield* TaskSubmission.Service
      const tools = yield* Tools.Service
      const allowBackground = options.background ?? Flag.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS

      const execute = Effect.fn("TaskTool.execute")(function* (input: typeof Input.Type, context: Tool.Context) {
        const runInBackground = input.background === true
        if (runInBackground && !allowBackground)
          return yield* new ToolFailure({
            message: "Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true",
          })

        const parent = yield* sessions.get(context.sessionID)
        if (!parent) return yield* new ToolFailure({ message: `Session not found: ${context.sessionID}` })

        let current = parent
        let depth = 0
        while (current.parentID) {
          depth++
          const ancestor = yield* sessions.get(current.parentID)
          if (!ancestor) return yield* new ToolFailure({ message: `Session not found: ${current.parentID}` })
          current = ancestor
        }
        const maxDepth = Config.latest(yield* config.entries(), "subagent_depth") ?? 1
        if (depth >= maxDepth)
          return yield* new ToolFailure({
            message: `Subagent depth limit reached (${maxDepth}). Increase "subagent_depth" to allow nested subagents.`,
          })

        const source = {
          type: "tool" as const,
          messageID: context.assistantMessageID,
          callID: context.toolCallID,
        }
        yield* permission
          .assert({
            action: name,
            resources: [input.subagent_type],
            save: ["*"],
            metadata: { description: input.description, subagent_type: input.subagent_type },
            sessionID: context.sessionID,
            agent: context.agent,
            source,
          })
          .pipe(Effect.mapError(() => new ToolFailure({ message: `Permission denied: task ${input.subagent_type}` })))

        const caller = yield* agents.resolve(context.agent)
        if (parent.parentID && caller?.mode === "subagent" && !caller.permissions.some((rule) => rule.action === name))
          return yield* new ToolFailure({ message: `Permission denied: task ${input.subagent_type}` })

        const agentID = AgentV2.ID.make(input.subagent_type)
        const agent = yield* agents.get(agentID)
        if (!agent)
          return yield* new ToolFailure({
            message: `Unknown agent type: ${input.subagent_type} is not a valid agent type`,
          })

        const requested = input.task_id ? SessionSchema.ID.make(input.task_id) : undefined
        const resumed = requested ? yield* sessions.get(requested) : undefined
        const model = agent.model ?? parent.model
        const child =
          resumed ??
          (yield* commands.create({
            parentID: context.sessionID,
            title: `${input.description} (@${agent.id} subagent)`,
            agent: agent.id,
            model,
            location: parent.location,
          }))
        if (resumed?.agent !== agent.id) yield* commands.switchAgent({ sessionID: child.id, agent: agent.id })
        if (model) yield* commands.switchModel({ sessionID: child.id, model })

        const baseMetadata = {
          parentSessionId: context.sessionID,
          sessionId: child.id,
          agent: agent.id,
          model: modelMetadata(model),
        }
        const metadata = {
          ...baseMetadata,
          ...(runInBackground ? { background: true as const } : {}),
        }

        const checkpoint = (next: typeof Metadata.Type, text?: string) =>
          progress.publish(context, {
            structured: { title: input.description, metadata: next },
            content: text ? [{ type: "text", text }] : [],
          })
        yield* checkpoint(metadata)

        const submission = yield* submissions
          .submit({
            parentSessionID: context.sessionID,
            assistantMessageID: context.assistantMessageID,
            toolCallID: context.toolCallID,
            childSessionID: child.id,
            description: input.description,
            prompt: Prompt.make({ text: input.prompt }),
            agent: agent.id,
            model,
          })
          .pipe(
            Effect.catchTag("TaskSubmission.InvocationConflict", (error) =>
              Effect.fail(new ToolFailure({ message: `Task invocation conflict: ${error.toolCallID}` })),
            ),
          )

        const runTask = Effect.gen(function* () {
          const claim = yield* submissions.claim(submission.id)
          if (!claim.acquired) {
            yield* execution.wait(child.id)
            const existing = yield* submissions.get(submission.id)
            if (existing?.outcome === "completed") return existing.resultText ?? ""
            if (existing?.outcome === "cancelled") return yield* new ToolFailure({ message: "Task cancelled" })
            return yield* new ToolFailure({ message: String(existing?.error ?? "Task did not complete") })
          }

          yield* execution.resume(child.id)
          yield* execution.wait(child.id)
          const messages = yield* sessions.context(child.id)
          const inputIndex = messages.findIndex((message) => message.id === submission.childInputID)
          if (inputIndex < 0) return yield* Effect.fail(new Error(`Child input not visible: ${submission.childInputID}`))
          const assistant = messages.slice(inputIndex + 1).find((message) => {
            return message.type === "assistant" && message.time.completed !== undefined
          })
          if (!assistant || assistant.type !== "assistant")
            return yield* Effect.fail(new Error(`Child input has no completed assistant result: ${submission.childInputID}`))
          const text = assistant.content
            .filter((part): part is SessionMessage.AssistantText => part.type === "text")
            .map((part) => part.text)
            .join("")
          const outcome: TaskSubmission.Outcome = assistant.error || assistant.finish === "error" ? "error" : "completed"
          const settled = yield* submissions.terminalize({
            submissionID: submission.id,
            outcome,
            resultMessageID: assistant.id,
            resultText: text,
            error: assistant.error,
          })
          if (!settled) return yield* Effect.fail(new Error(`Task submission disappeared: ${submission.id}`))
          yield* notifications.drain({ admit: (notification) => commands.admitSynthetic(notification).pipe(Effect.asVoid), wake: execution.wake })
          if (outcome === "error") return yield* new ToolFailure({ message: text || "Task failed" })
          return text
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.uninterruptible(
              submissions
                .terminalize({
                  submissionID: submission.id,
                  outcome: Cause.hasInterrupts(cause)
                    ? "cancelled"
                    : Cause.squash(cause) instanceof SessionAttempt.RecoveryRequiredError
                      ? "recovery-required"
                      : "error",
                  error: { message: String(Cause.squash(cause)) },
                })
                .pipe(
                  Effect.andThen(
                    notifications.drain({
                      admit: (notification) => commands.admitSynthetic(notification).pipe(Effect.asVoid),
                      wake: execution.wake,
                    }),
                  ),
                  Effect.ignore,
                ),
            ).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          Effect.onInterrupt(() =>
            cancellation.cancelTree({
              rootSessionID: child.id,
              interrupt: execution.interrupt,
              wait: execution.wait,
            }).pipe(Effect.asVoid),
          ),
        )

        const backgroundMetadata = {
          ...baseMetadata,
          background: true as const,
          jobId: child.id,
        }

        const info = yield* background.start({
          id: child.id,
          type: name,
          title: input.description,
          metadata,
          onPromote: checkpoint(backgroundMetadata),
          run: runTask,
        })

        const runningResult = (mode: "started" | "updated") => {
          const output = renderOutput({
            sessionID: child.id,
            state: "running" as const,
            summary: mode === "updated" ? "Background task updated" : "Background task started",
            text: mode === "updated" ? BACKGROUND_UPDATED : BACKGROUND_STARTED,
          })
          return { title: input.description, metadata: { ...backgroundMetadata, jobId: info.id }, output }
        }

        if (runInBackground) {
          const result = runningResult("started")
          yield* checkpoint(result.metadata, result.output)
          return result
        }

        if (info.metadata?.background === true) {
          const result = runningResult("updated")
          yield* checkpoint(result.metadata, result.output)
          return result
        }

        const waitForCompletion: Effect.Effect<BackgroundJob.WaitResult | BackgroundJob.Info> = Effect.raceFirst(
          background.wait({ id: child.id }),
          background.waitForPromotion(child.id).pipe(
            Effect.flatMap((result): Effect.Effect<BackgroundJob.WaitResult | BackgroundJob.Info> =>
              result === undefined ? background.wait({ id: child.id }) : Effect.succeed(result),
            ),
          ),
        )

        return yield* waitForCompletion.pipe(
          Effect.flatMap((result) => {
            if ("timedOut" in result) {
              if (result.outcome === "missing")
                return Effect.fail(new ToolFailure({ message: `Task lifecycle observation missing: ${child.id}` }))
              if (result.timedOut || result.outcome === "timed-out")
                return Effect.fail(new ToolFailure({ message: `Task lifecycle observation timed out: ${child.id}` }))
              if (!result.info)
                return Effect.fail(new ToolFailure({ message: `Task lifecycle observation missing result: ${child.id}` }))
              if (result.info.status === "error")
                return Effect.fail(new ToolFailure({ message: result.info.error ?? "Task failed" }))
              if (result.info.status === "cancelled")
                return Effect.fail(new ToolFailure({ message: "Task cancelled" }))
              if (result.info.status !== "completed")
                return Effect.fail(new ToolFailure({ message: "Task did not complete" }))
              return Effect.succeed({
                title: input.description,
                metadata: baseMetadata,
                output: renderOutput({
                  sessionID: child.id,
                  state: "completed",
                  text: result.info.output ?? "",
                }),
              })
            }
            if (result.metadata?.background === true) {
              const running = runningResult("started")
              return checkpoint(running.metadata, running.output).pipe(Effect.as(running))
            }
            if (result.status === "error")
              return Effect.fail(new ToolFailure({ message: result.error ?? "Task failed" }))
            if (result.status === "cancelled") return Effect.fail(new ToolFailure({ message: "Task cancelled" }))
            if (result.status !== "completed") return Effect.fail(new ToolFailure({ message: "Task did not complete" }))
            return Effect.succeed({
              title: input.description,
              metadata: baseMetadata,
              output: renderOutput({
                sessionID: child.id,
                state: "completed",
                text: result.output ?? "",
              }),
            })
          }),
          Effect.onInterrupt(() => background.cancel(child.id).pipe(Effect.asVoid)),
        )
      })

      yield* tools
        .register({
          [name]: Tool.make({
            description: allowBackground ? `${description}\n\n${BACKGROUND_DESCRIPTION}` : description,
            input: Input,
            output: Output,
            jsonSchema: allowBackground
              ? undefined
              : {
                  input: Schema.toJsonSchemaDocument(ForegroundInput).schema,
                  output: Schema.toJsonSchemaDocument(Output).schema,
                },
            toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
            execute: (input, context) =>
              execute(input, context).pipe(
                Effect.mapError((error) =>
                  error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to run task", error }),
                ),
              ),
          }),
        })
        .pipe(Effect.orDie)
    }),
  )

const deps = [
  AgentV2.node,
  BackgroundJob.node,
  Config.node,
  PermissionV2.node,
  SessionCommand.node,
  SessionExecution.node,
  SessionStore.node,
  TaskCancellation.node,
  TaskNotification.node,
  TaskSubmission.node,
  ToolProgress.node,
  ToolRegistry.node,
] as const

export const nodeWithOptions = (options: LayerOptions = {}) =>
  makeLocationNode({
    name: "tool/task",
    layer: layerWithOptions(options),
    deps,
  })

export const node = nodeWithOptions()
