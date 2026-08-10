import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { PlanExitTool } from "@opencode-ai/core/tool/plan-exit"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_plan_exit_tool_test")
const directory = AbsolutePath.make(process.cwd())
const absolutePlan = path.join(directory, ".opencode", "plans", "1-plan.md")
const relativePlan = path.relative(directory, absolutePlan)
const assertions: PermissionV2.AssertInput[] = []
const questions: QuestionV2.AskInput[] = []
const calls: Array<
  | { readonly type: "plan" }
  | { readonly type: "switch"; readonly input: Parameters<SessionCommand.Interface["switchAgent"]>[0] }
  | { readonly type: "synthetic"; readonly input: Parameters<SessionCommand.Interface["synthetic"]>[0] }
> = []
let deny = false
let answer: "Yes" | "No" | "reject" = "Yes"

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(deny ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const question = Layer.succeed(
  QuestionV2.Service,
  QuestionV2.Service.of({
    ask: (input) =>
      Effect.sync(() => questions.push(input)).pipe(
        Effect.andThen(
          answer === "reject" ? Effect.fail(new QuestionV2.RejectedError()) : Effect.succeed([[answer]]),
        ),
      ),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const session = Layer.succeed(
  SessionCommand.Service,
  SessionCommand.Service.of({
    plan: () =>
      Effect.sync(() => {
        calls.push({ type: "plan" })
        return absolutePlan
      }),
    switchAgent: (input: Parameters<SessionCommand.Interface["switchAgent"]>[0]) =>
      Effect.sync(() => {
        calls.push({ type: "switch", input })
      }),
    synthetic: (input: Parameters<SessionCommand.Interface["synthetic"]>[0]) =>
      Effect.sync(() => {
        calls.push({ type: "synthetic", input })
      }),
  } as unknown as SessionCommand.Interface),
)

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory })),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, PlanExitTool.node]), [
    [PermissionV2.node, permission],
    [QuestionV2.node, question],
    [SessionCommand.node, session],
    [Location.node, locationLayer],
    [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
  ]),
)

const call = (id = "call-plan-exit") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: PlanExitTool.name, input: {} },
})

const reset = () => {
  assertions.length = 0
  questions.length = 0
  calls.length = 0
  deny = false
  answer = "Yes"
}

describe("PlanExitTool", () => {
  it.effect("asks for approval, switches agent, and records the approved plan as synthetic context", () =>
    Effect.gen(function* () {
      reset()
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual([PlanExitTool.name])
      expect(
        yield* toolDefinitions(registry, [{ action: PlanExitTool.name, resource: "*", effect: "deny" }]),
      ).toEqual([])
      expect(yield* settleTool(registry, call())).toEqual({
        result: {
          type: "text",
          value: "User approved switching to build agent. Wait for further instructions.",
        },
        output: {
          structured: {
            title: "Switching to build agent",
            output: "User approved switching to build agent. Wait for further instructions.",
            metadata: {},
          },
          content: [
            {
              type: "text",
              text: "User approved switching to build agent. Wait for further instructions.",
            },
          ],
        },
      })
      expect(assertions).toMatchObject([
        { sessionID, action: PlanExitTool.name, resources: ["*"], agent: toolIdentity.agent },
      ])
      expect(questions).toEqual([
        {
          sessionID,
          questions: [
            {
              question: `Plan at ${relativePlan} is complete. Would you like to switch to the build agent and start implementing?`,
              header: "Build Agent",
              custom: false,
              options: [
                { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                { label: "No", description: "Stay with plan agent to continue refining the plan" },
              ],
            },
          ],
          tool: { messageID: toolIdentity.assistantMessageID, callID: "call-plan-exit" },
        },
      ])
      expect(calls.map((call) => call.type)).toEqual(["plan", "switch", "synthetic"])
      expect(calls[1]).toEqual({ type: "switch", input: { sessionID, agent: "build" } })
      expect(calls[2]).toEqual({
        type: "synthetic",
        input: {
          sessionID,
          text: `The plan at ${relativePlan} has been approved, you can now edit files. Execute the plan`,
          kind: "plan-approved",
        },
      })
    }),
  )

  it.effect("keeps the plan agent when the user answers No or dismisses the question", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service

      for (const response of ["No", "reject"] as const) {
        reset()
        answer = response
        const exit = yield* executeTool(registry, call(`call-plan-exit-${response}`)).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(calls.map((call) => call.type)).toEqual(["plan"])
      }
    }),
  )

  it.effect("does not ask or mutate the session when permission is denied", () =>
    Effect.gen(function* () {
      reset()
      deny = true
      const registry = yield* ToolRegistry.Service

      expect(yield* executeTool(registry, call("call-plan-exit-denied"))).toEqual({
        type: "error",
        value: "Permission denied: plan_exit",
      })
      expect(questions).toEqual([])
      expect(calls).toEqual([])
    }),
  )
})
