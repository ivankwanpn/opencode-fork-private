import { describe, expect } from "bun:test"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolProgress } from "@opencode-ai/core/tool/progress"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

const published: Array<{ readonly type: string; readonly data: unknown }> = []
const events = Layer.succeed(
  EventV2.Service,
  EventV2.Service.of({
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
        return { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
      }),
    subscribe: () => Stream.empty,
    all: () => Stream.empty,
    durable: () => Stream.empty,
    listen: () => Effect.succeed(Effect.void),
    project: () => Effect.void,
    replay: () => Effect.void,
    replayAll: () => Effect.succeed(undefined),
    remove: () => Effect.void,
    claim: () => Effect.void,
  }),
)
const it = testEffect(LayerNode.compile(ToolProgress.node, [[EventV2.node, events]]))
const context = {
  sessionID: SessionV2.ID.make("ses_tool_progress_test"),
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_tool_progress_test"),
  toolCallID: "call-progress",
}

describe("ToolProgress", () => {
  it.effect("publishes bounded semantic progress with canonical tool identity", () =>
    Effect.gen(function* () {
      published.length = 0
      const progress = yield* ToolProgress.Service
      const structured = { phase: "indexing", completed: 3 }
      const content = [{ type: "text" as const, text: "Indexed 3 files" }]

      yield* progress.publish(context, { structured, content })
      structured.completed = 4
      content[0].text = "mutated"

      expect(published).toHaveLength(1)
      expect(published[0]).toMatchObject({
        type: "session.next.tool.progress",
        data: {
          sessionID: context.sessionID,
          assistantMessageID: context.assistantMessageID,
          callID: context.toolCallID,
          structured: { phase: "indexing", completed: 3 },
          content: [{ type: "text", text: "Indexed 3 files" }],
        },
      })
      expect(published[0]?.data).toHaveProperty("timestamp")
    }),
  )
})
