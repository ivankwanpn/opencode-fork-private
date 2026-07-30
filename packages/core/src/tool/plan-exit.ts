export * as PlanExitTool from "./plan-exit"

import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { makeLocationNode } from "../effect/app-node"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { SessionCommand } from "../session/command"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "plan_exit"

export const description = `Use this tool when you have completed the planning phase and are ready to exit plan agent.

This tool will ask the user if they want to switch to build agent to start implementing the plan.

Call this tool:
- After you have written a complete plan to the plan file
- After you have clarified any questions with the user
- When you are confident the plan is ready for implementation

Do NOT call this tool:
- Before you have created or finalized the plan
- If you still have unanswered questions about the implementation
- If the user has indicated they want to continue planning`

export const Input = Schema.Struct({})
export const Output = Schema.Struct({
  title: Schema.String,
  output: Schema.String,
  metadata: Schema.Struct({}),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const question = yield* QuestionV2.Service
    const commands = yield* SessionCommand.Service
    const location = yield* Location.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }],
          execute: (_input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: plan_exit" })),
                Effect.andThen(
                  Effect.gen(function* () {
                    const absolutePlan = yield* commands.plan(context.sessionID)
                    const plan = path.relative(location.directory, absolutePlan)
                    const answers = yield* question.ask({
                      sessionID: context.sessionID,
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
                      tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    if (answers[0]?.[0] === "No") return yield* new QuestionV2.RejectedError()

                    yield* Effect.uninterruptible(
                      Effect.gen(function* () {
                        yield* commands.switchAgent({ sessionID: context.sessionID, agent: AgentV2.defaultID })
                        yield* commands.synthetic({
                          sessionID: context.sessionID,
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
                ),
              ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/plan-exit",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node, SessionCommand.node, Location.node],
})
