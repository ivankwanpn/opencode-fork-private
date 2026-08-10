#!/usr/bin/env bun

import { Effect } from "effect"
import { parseArgs } from "util"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionRepair } from "@opencode-ai/core/session/repair"
import { SessionSchema } from "@opencode-ai/core/session/schema"

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    session: { type: "string" },
  },
})

const session = args.values.session
if (!session) {
  console.error("Usage: bun script/repair-projections.ts --session <sessionID>")
  process.exit(1)
}

await Effect.gen(function* () {
  const { db } = yield* Database.Service
  const events = yield* EventV2.Service
  const result = yield* SessionRepair.repairSession(db, events, SessionSchema.ID.make(session))
  console.log(result.repaired ? "repaired" : "up-to-date")
}).pipe(
  Effect.provide(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node]))),
  Effect.runPromise,
)
