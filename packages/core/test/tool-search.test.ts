import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_search_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let denied: string | undefined

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(
          input.action === denied ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const withTools = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, GlobTool.node, GrepTool.node]),
        [
          [
            Location.node,
            Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
            ),
          ],
          [PermissionV2.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )

const call = (name: "glob" | "grep", input: Record<string, unknown>) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

const it = testEffect(Layer.empty)

describe("search tools", () => {
  it.live("finds and greps files through the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          assertions.length = 0
          denied = undefined
          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "src"), { recursive: true }))
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(path.join(tmp.path, "src", "a.ts"), "const needle = 1\n"),
              fs.writeFile(path.join(tmp.path, "src", "b.ts"), "const other = 2\n"),
              fs.writeFile(path.join(tmp.path, "README.md"), "needle\n"),
            ]),
          )

          yield* withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              expect((yield* toolDefinitions(registry)).map((tool) => tool.name).toSorted()).toEqual(["glob", "grep"])

              const glob = yield* settleTool(
                registry,
                call("glob", { pattern: "*.ts", path: "src", limit: 10 }),
              )
              expect((glob.output?.structured as { path: string; type: string }[]).toSorted((a, b) =>
                a.path.localeCompare(b.path),
              )).toEqual([
                { path: "src/a.ts", type: "file" },
                { path: "src/b.ts", type: "file" },
              ])
              expect(glob.result.type).toBe("text")
              if (glob.result.type === "text" && typeof glob.result.value === "string")
                expect(glob.result.value.split("\n").toSorted()).toEqual(
                  [path.join(tmp.path, "src", "a.ts"), path.join(tmp.path, "src", "b.ts")].toSorted(),
                )

              const grep = yield* settleTool(
                registry,
                call("grep", { pattern: "needle", path: "src/a.ts", include: "*.ts", limit: 10 }),
              )
              expect(grep.output?.structured).toMatchObject([
                {
                  entry: { path: "src/a.ts", type: "file" },
                  line: 1,
                  text: expect.stringContaining("const needle = 1"),
                },
              ])
              expect(grep.result).toMatchObject({
                type: "text",
                value: expect.stringContaining(`${path.join(tmp.path, "src", "a.ts")}:`),
              })
              expect(assertions).toMatchObject([
                { sessionID, action: "glob", resources: ["*.ts"] },
                { sessionID, action: "grep", resources: ["needle"] },
              ])
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("bounds results, rejects invalid regex, and stops after permission denial", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              fs.writeFile(path.join(tmp.path, "a.txt"), "needle\n"),
              fs.writeFile(path.join(tmp.path, "b.txt"), "needle\n"),
            ]),
          )

          yield* withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              assertions.length = 0
              denied = undefined
              const bounded = yield* settleTool(registry, call("grep", { pattern: "needle", limit: 1 }))
              expect(bounded.output?.structured).toHaveLength(1)

              const invalid = yield* executeTool(registry, call("grep", { pattern: "[" }))
              expect(invalid).toEqual({ type: "error", value: "Unable to grep for [" })

              denied = "glob"
              const blocked = yield* executeTool(registry, call("glob", { pattern: "*.txt" }))
              expect(blocked).toEqual({ type: "error", value: "Unable to find files matching *.txt" })
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
