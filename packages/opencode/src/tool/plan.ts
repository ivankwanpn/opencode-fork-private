import path from "path"
import { AgentV2 } from "@opencode-ai/core/agent"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { InstanceState } from "@/effect/instance-state"
import EXIT_DESCRIPTION from "./plan-exit.txt"

export const Parameters = Schema.Struct({})

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const question = yield* Question.Service
    const commands = yield* SessionCommand.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const absolutePlan = yield* commands.plan(ctx.sessionID)
          const plan = path.relative(instance.worktree, absolutePlan)
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                header: "Build Agent",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                  { label: "No", description: "Stay with plan agent to continue refining the plan" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* commands.switchAgent({ sessionID: ctx.sessionID, agent: AgentV2.defaultID })
              yield* commands.synthetic({
                sessionID: ctx.sessionID,
                text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
                kind: "plan-approved",
              })
            }),
          )

          return {
            title: "Switching to build agent",
            output: "User approved switching to build agent. Wait for further instructions.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
