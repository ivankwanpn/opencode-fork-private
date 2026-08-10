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

limitedPermitIt.effect("rekeys a provisional reservation without consuming another slot", () =>
  Effect.gen(function* () {
    const permits = yield* SubagentPermit.Service
    const provisional = yield* permits.acquire("ses_provisional")
    if (provisional.kind !== "new") throw new Error("Expected a new provisional reservation")
    const transferred = yield* permits.rekey(provisional, "ses_child_1")
    yield* permits.acquire("ses_child_2")

    expect(transferred).toEqual({ kind: "new", key: "ses_child_1" })
    expect(yield* permits.active).toEqual(new Set(["ses_child_1", "ses_child_2"]))
    expect(yield* permits.acquire("ses_child_3").pipe(Effect.flip)).toBeInstanceOf(SubagentLimitReached)
  }),
)

limitedPermitIt.effect("drops a provisional slot when its final key is already reserved", () =>
  Effect.gen(function* () {
    const permits = yield* SubagentPermit.Service
    yield* permits.acquire("ses_child_1")
    const provisional = yield* permits.acquire("ses_provisional")
    if (provisional.kind !== "new") throw new Error("Expected a new provisional reservation")
    const transferred = yield* permits.rekey(provisional, "ses_child_1")

    expect(transferred).toEqual({ kind: "existing", key: "ses_child_1" })
    expect(yield* permits.active).toEqual(new Set(["ses_child_1"]))
  }),
)
