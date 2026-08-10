import { expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

cliIt.live(
  "debug agent uses the V2 registry and executes a durable V2 tool call",
  ({ opencode }) =>
    Effect.gen(function* () {
      const listed = yield* opencode.spawn(["debug", "agent", "build"])
      opencode.expectExit(listed, 0, "debug agent list")
      expect(JSON.parse(listed.stdout)).toMatchObject({
        id: "build",
        tools: { glob: true, task: true, get_task_output: true },
      })

      const executed = yield* opencode.spawn([
        "debug",
        "agent",
        "build",
        "--tool",
        "glob",
        "--params",
        JSON.stringify({ pattern: "*" }),
      ])
      opencode.expectExit(executed, 0, "debug agent tool")
      expect(JSON.parse(executed.stdout)).toMatchObject({
        tool: "glob",
        input: { pattern: "*" },
        result: {
          result: { type: "text" },
          output: { content: expect.any(Array) },
        },
      })
    }),
  60_000,
)
