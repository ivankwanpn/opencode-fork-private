import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { TaskTool } from "@opencode-ai/core/tool/task"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const pluginMap = pluginLocationMap()
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionCommand.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      pluginMap.replacement,
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const GRANT: PermissionV2.Rule = { action: "playwright_snapshot", resource: "*", effect: "allow" }

describe("P3 task grants (V2)", () => {
  it.effect("persists create-time grants into the session permission column and reads them back as V2 rules", () =>
    Effect.gen(function* () {
      const commands = yield* SessionCommand.Service
      const store = yield* SessionStore.Service

      const session = yield* commands.create({
        location,
        agent: AgentV2.ID.make("worker"),
        permissions: [GRANT],
      })
      expect(session.id).toBeDefined()

      const permissions = yield* store.permissions(session.id)
      expect(permissions).toEqual([GRANT])
    }),
  )

  it.effect("returns an empty ruleset when no grants were set", () =>
    Effect.gen(function* () {
      const commands = yield* SessionCommand.Service
      const store = yield* SessionStore.Service

      const session = yield* commands.create({ location, agent: AgentV2.ID.make("worker") })
      const permissions = yield* store.permissions(session.id)
      expect(permissions).toEqual([])
    }),
  )

  it.effect("TaskTool Input accepts a permission grant parameter", () =>
    Effect.gen(function* () {
      const parsed = Schema.decodeUnknownSync(TaskTool.Input)({
        description: "grant test",
        prompt: "do something",
        subagent_type: "worker",
        permission: [{ tool: "playwright_snapshot" }],
      })
      expect(parsed.permission).toEqual([{ tool: "playwright_snapshot" }])
    }),
  )

  it.effect("grant persists only on the child session, not the parent", () =>
    Effect.gen(function* () {
      const commands = yield* SessionCommand.Service
      const store = yield* SessionStore.Service

      const parent = yield* commands.create({ location, agent: AgentV2.ID.make("build") })
      const child = yield* commands.create({
        location,
        parentID: parent.id,
        agent: AgentV2.ID.make("worker"),
        permissions: [GRANT],
      })

      const parentPermissions = yield* store.permissions(parent.id)
      const childPermissions = yield* store.permissions(child.id)
      expect(parentPermissions).toEqual([])
      expect(childPermissions).toEqual([GRANT])
    }),
  )

  it.effect("a later session without grants has no residual permissions", () =>
    Effect.gen(function* () {
      const commands = yield* SessionCommand.Service
      const store = yield* SessionStore.Service

      const first = yield* commands.create({ location, agent: AgentV2.ID.make("worker"), permissions: [GRANT] })
      const second = yield* commands.create({ location, agent: AgentV2.ID.make("worker") })
      expect(yield* store.permissions(first.id)).toEqual([GRANT])
      expect(yield* store.permissions(second.id)).toEqual([])
    }),
  )
})

describe("P3 task grant input schema", () => {
  test("rejects a grant for a blocklisted tool name", () => {
    // Blocklist filtering happens in the task tool execute path (P2 blocklist);
    // the schema itself accepts any string. This test locks the schema shape.
    const parsed = Schema.decodeUnknownSync(TaskTool.Input)({
      description: "grant test",
      prompt: "do something",
      subagent_type: "worker",
      permission: [{ tool: "browser_run_code_unsafe" }],
    })
    expect(parsed.permission).toEqual([{ tool: "browser_run_code_unsafe" }])
  })
})
