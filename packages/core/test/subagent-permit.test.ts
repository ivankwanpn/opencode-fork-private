import { expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SubagentLimitReached, SubagentPermit } from "@opencode-ai/core/session/subagent-permit"
import { testEffect } from "./lib/effect"

const permitIt = testEffect(AppNodeBuilder.build(LayerNode.group([SubagentPermit.node])))
const limitedPermitIt = testEffect(SubagentPermit.layer(2))

limitedPermitIt.effect("rejects a new subagent beyond the concurrency limit", () =>
  Effect.gen(function* () {
    const permits = yield* SubagentPermit.Service
    const first = yield* permits.acquire("ses_child_1")
    const second = yield* permits.acquire("ses_child_2")
    const error = yield* permits.acquire("ses_child_3").pipe(Effect.flip)
    expect(error).toBeInstanceOf(SubagentLimitReached)
    yield* permits.release(first.key)
    yield* permits.release(second.key)
  }),
)

permitIt.effect("deduplicates re-acquire for the same child id", () =>
  Effect.gen(function* () {
    const permits = yield* SubagentPermit.Service
    const first = yield* permits.acquire("ses_child_1")
    const again = yield* permits.acquire("ses_child_1")
    expect(again.kind).toBe("existing")
    yield* permits.release(first.key)
  }),
)
