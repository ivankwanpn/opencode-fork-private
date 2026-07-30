import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Cause, Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionStatus } from "@/session/status"
import { TaskNotification } from "@opencode-ai/core/session/task-notification"
import { TaskCancellation } from "@opencode-ai/core/session/task-cancellation"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
].join(" ")
const BACKGROUND_STARTED = [
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameterFields = {
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
}

const BaseParameters = Schema.Struct(BaseParameterFields)

export const Parameters = Schema.Struct({
  ...BaseParameterFields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
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

function promptModel(value: unknown) {
  if (typeof value !== "object" || value === null) return undefined
  if (!("id" in value) || !("providerID" in value)) return undefined
  if (typeof value.id !== "string" || typeof value.providerID !== "string") return undefined
  return {
    modelID: ModelV2.ID.make(value.id),
    providerID: ProviderV2.ID.make(value.providerID),
  }
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const flags = yield* RuntimeFlags.Service
    const status = yield* SessionStatus.Service
    const database = yield* Database.Service
    const notifications = yield* TaskNotification.Service
    const cancellation = yield* TaskCancellation.Service
    const submissions = yield* TaskSubmission.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            `Subagent depth limit reached (${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.`,
          ),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const submission = yield* submissions.submit({
        parentSessionID: SessionSchema.ID.make(ctx.sessionID),
        assistantMessageID: SessionMessage.ID.make(ctx.messageID),
        toolCallID:
          ctx.callID ?? `legacy-task:${nextSession.id}:${params.description}:${params.prompt}:${params.subagent_type}`,
        childSessionID: SessionSchema.ID.make(nextSession.id),
        description: params.description,
        prompt: Prompt.make({ text: params.prompt }),
        agent: next.name,
        model,
      })

      const admitNotification = (input: TaskNotification.Admission) =>
        Effect.gen(function* () {
          const currentParent = yield* sessions.get(ctx.sessionID)
          const model =
            promptModel(ctx.extra?.model) ??
            (currentParent.model
              ? { modelID: currentParent.model.id, providerID: currentParent.model.providerID }
              : undefined)
          yield* ops.prompt({
            messageID: MessageID.make(input.id),
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            model,
            variant,
            noReply: true,
            parts: [{ type: "text", synthetic: true, text: input.text }],
          })
        })

      const drainNotifications = Effect.fn("TaskTool.drainNotifications")(function* () {
        if ((yield* status.get(ctx.sessionID)).type !== "idle") return
        yield* notifications.drain({ admit: admitNotification, wake: () => Effect.void })
      })

      const runTask = Effect.gen(function* () {
        const claim = yield* submissions.claim(submission.id)
        if (!claim.acquired) {
          const existing = yield* submissions.get(submission.id)
          if (existing?.outcome === "completed") return existing.resultText ?? ""
          if (existing?.outcome === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
          return yield* Effect.fail(new Error(existing?.error ? String(existing.error) : "Task did not complete"))
        }
        const parts = yield* ops.resolvePromptParts(params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.make(submission.childInputID),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          parts,
        })
        const text = result.parts.findLast((item) => item.type === "text")?.text ?? ""
        const outcome: TaskSubmission.Outcome =
          result.info.role === "assistant" && result.info.error ? "error" : "completed"
        const settled = yield* submissions.terminalize({
          submissionID: submission.id,
          outcome,
          resultMessageID: SessionMessage.ID.make(result.info.id),
          resultText: text,
          error: result.info.role === "assistant" ? result.info.error : undefined,
        })
        if (!settled) return yield* Effect.fail(new Error(`Task submission disappeared: ${submission.id}`))
        yield* drainNotifications()
        if (outcome === "error") return yield* Effect.fail(new Error(text || "Task failed"))
        return text
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.uninterruptible(
            submissions
              .terminalize({
                submissionID: submission.id,
                outcome: Cause.hasInterrupts(cause) ? "cancelled" : "error",
                error: { message: String(Cause.squash(cause)) },
              })
              .pipe(Effect.andThen(drainNotifications()), Effect.ignore),
          ).pipe(Effect.andThen(Effect.failCause(cause))),
        ),
        Effect.onInterrupt(() =>
          cancellation
            .cancelTree({
              rootSessionID: SessionSchema.ID.make(nextSession.id),
              interrupt: ops.cancel,
              wait: (sessionID) => background.wait({ id: sessionID }).pipe(Effect.asVoid),
            })
            .pipe(Effect.asVoid),
        ),
      )

      const existingJob = yield* background.get(nextSession.id)

      const info = yield* background.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
        ]),
        run: runTask,
      })
      function backgroundResult(mode: "started" | "updated") {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: info.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: mode === "updated" ? "Background task updated" : "Background task started",
            text: mode === "updated" ? BACKGROUND_UPDATED : BACKGROUND_STARTED,
          }),
        }
      }

      if (runInBackground) {
        return backgroundResult("started")
      }

      if (existingJob?.status === "running" && existingJob.metadata?.background === true) {
        return backgroundResult("updated")
      }

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(background.wait({ id: nextSession.id }), background.waitForPromotion(nextSession.id))
            if (result === undefined)
              return yield* Effect.fail(new Error(`Task lifecycle observation missing: ${nextSession.id}`))
            if ("timedOut" in result) {
              if (result.outcome === "missing")
                return yield* Effect.fail(new Error(`Task lifecycle observation missing: ${nextSession.id}`))
              if (result.timedOut || result.outcome === "timed-out")
                return yield* Effect.fail(new Error(`Task lifecycle observation timed out: ${nextSession.id}`))
              if (!result.info)
                return yield* Effect.fail(new Error(`Task lifecycle observation missing result: ${nextSession.id}`))
              if (result.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Task failed"))
              if (result.info.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
              if (result.info.status !== "completed") return yield* Effect.fail(new Error("Task did not complete"))
              return {
                title: params.description,
                metadata,
                output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result.info.output ?? "" }),
              }
            }
            if (result.metadata?.background === true) return backgroundResult("started")
            if (result.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result.output ?? "" }),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit))
              yield* Effect.all([cancel, background.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
