import fs from "fs/promises"
import { realpathSync } from "node:fs"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Scope } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess } from "effect/unstable/process"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AppProcess } from "@opencode-ai/core/process"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Shell } from "@opencode-ai/core/shell"
import { BashTool } from "@opencode-ai/core/tool/bash"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_bash_tool_test")
const assertions: PermissionV2.AssertInput[] = []
const runs: Array<{
  readonly command: string
  readonly cwd?: string
  readonly shell?: string | boolean
  readonly options?: AppProcess.RunOptions
}> = []
let denyAction: string | undefined
let configuredShell: string | undefined
let result: AppProcess.RunResult = {
  command: "mock",
  exitCode: 0,
  output: Buffer.from("hello\n"),
  stdout: Buffer.from("hello\n"),
  stderr: Buffer.alloc(0),
  outputTruncated: false,
  stdoutTruncated: false,
  stderrTruncated: false,
}
let runFailure: AppProcess.AppProcessError | undefined
let runHandler:
  | ((
      command: ChildProcess.Command,
      options?: AppProcess.RunOptions,
    ) => Effect.Effect<AppProcess.RunResult, AppProcess.AppProcessError>)
  | undefined
let afterPermission = (_input: PermissionV2.AssertInput): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(Effect.suspend(() => afterPermission(input))),
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const appProcess = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({
    run: (command: ChildProcess.Command, options?: AppProcess.RunOptions) =>
      Effect.suspend(() => {
        if (command._tag !== "StandardCommand") throw new Error("expected standard command")
        runs.push({ command: command.command, cwd: command.options.cwd, shell: command.options.shell, options })
        if (runHandler) return runHandler(command, options)
        return runFailure ? Effect.fail(runFailure) : Effect.succeed(result)
      }),
  } as unknown as AppProcess.Interface),
)
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed(
        configuredShell
          ? [new Config.Document({ type: "document", info: new Config.Info({ shell: configuredShell }) })]
          : [],
      ),
  }),
)

const reset = () => {
  assertions.length = 0
  runs.length = 0
  denyAction = undefined
  configuredShell = undefined
  runFailure = undefined
  runHandler = undefined
  afterPermission = () => Effect.void
  result = {
    command: "mock",
    exitCode: 0,
    output: Buffer.from("hello\n"),
    stdout: Buffer.from("hello\n"),
    stderr: Buffer.alloc(0),
    outputTruncated: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

const withTool = <A, E>(
  directory: string,
  body: (
    registry: ToolRegistry.Interface,
    jobs: BackgroundJob.Interface,
    database: Database.Interface,
    events: EventV2.Interface,
  ) => Effect.Effect<A, E, Scope.Scope>,
  processLayer: Layer.Layer<AppProcess.Service> = appProcess,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(
      yield* ToolRegistry.Service,
      yield* BackgroundJob.Service,
      yield* Database.Service,
      yield* EventV2.Service,
    )
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          EventV2.node,
          BackgroundJob.node,
          ToolRegistry.node,
          ToolRegistry.toolsNode,
          LocationMutation.node,
          BashTool.node,
        ]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [AppProcess.node, processLayer],
          [Config.node, config],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const call = (input: typeof BashTool.Input.Type, id = "call-bash") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "bash", input },
})

const it = testEffect(Layer.empty)

const setupSession = (db: Database.Interface["db"], directory: string) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "bash-tool-test",
        directory,
        title: "bash tool test",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

describe("BashTool", () => {
  it.live("registers and returns structured successful output from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const definitions = yield* toolDefinitions(registry)
            expect(definitions.map((tool) => tool.name)).toEqual(["bash"])
            expect(definitions[0]?.inputSchema).not.toHaveProperty("properties.background")
            expect(definitions[0]?.inputSchema).toHaveProperty("properties.run_in_background")
            expect(definitions[0]?.inputSchema).not.toHaveProperty("properties.description")
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.output")
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.command")
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.cwd")
            expect(yield* toolDefinitions(registry, [{ action: "bash", resource: "*", effect: "deny" }])).toEqual([])
            expect(yield* settleTool(registry, call({ command: "pwd" }))).toEqual({
              result: {
                type: "content",
                value: [
                  { type: "text", text: "hello\n" },
                  { type: "text", text: "Command exited with code 0." },
                ],
              },
              output: {
                structured: {
                  exit: 0,
                  truncated: false,
                },
                content: [
                  { type: "text", text: "hello\n" },
                  { type: "text", text: "Command exited with code 0." },
                ],
              },
            })
            expect(runs).toMatchObject([{ cwd: realpathSync(tmp.path) }])
            const shell = Shell.acceptable()
            expect(runs[0]?.command).toBe(process.platform === "win32" && Shell.ps(shell) ? shell : "pwd")
            expect(runs[0]?.shell).toBe(process.platform === "win32" && Shell.ps(shell) ? undefined : shell)
            expect(runs[0]?.options).toMatchObject({
              combineOutput: true,
            })
            expect(runs[0]?.options).not.toHaveProperty("maxOutputBytes")
            expect(assertions).toMatchObject([{ sessionID, action: "bash", resources: ["pwd"], save: ["pwd"] }])
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("resolves a relative workdir from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return Effect.promise(() => fs.mkdir(path.join(tmp.path, "src"))).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) => executeTool(registry, call({ command: "pwd", workdir: "src" }))),
          ),
          Effect.andThen(
            Effect.sync(() => expect(runs).toMatchObject([{ cwd: realpathSync(path.join(tmp.path, "src")) }])),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects a workdir that stops being a directory during approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const workdir = path.join(tmp.path, "src")
        afterPermission = (input) =>
          input.action === "bash"
            ? Effect.promise(async () => {
                await fs.rm(workdir, { recursive: true })
                await fs.writeFile(workdir, "not a directory")
              }).pipe(Effect.orDie)
            : Effect.void
        return Effect.promise(() => fs.mkdir(workdir)).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) => executeTool(registry, call({ command: "pwd", workdir: "src" }))),
          ),
          Effect.andThen(
            Effect.sync(() => {
              expect(runs).toEqual([])
              expect(assertions.map((input) => input.action)).toEqual(["bash"])
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  if (process.platform !== "win32") {
    it.live("executes a real shell command through AppProcess", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withTool(
            tmp.path,
            (registry) => settleTool(registry, call({ command: "printf core-bash" })),
            LayerNode.compile(AppProcess.node),
          ).pipe(
            Effect.andThen((settled) =>
              Effect.sync(() => {
                expect(settled.result).toEqual({
                  type: "content",
                  value: [
                    { type: "text", text: "core-bash" },
                    { type: "text", text: "Command exited with code 0." },
                  ],
                })
                expect(settled.output?.structured).toMatchObject({
                  exit: 0,
                })
                expect(settled.output?.structured).not.toHaveProperty("output")
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }

  if (process.platform === "win32") {
    it.live("resolves configured bash through the official Windows shell selection", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          configuredShell = "bash"
          return withTool(tmp.path, (registry) => executeTool(registry, call({ command: "pwd" }))).pipe(
            Effect.andThen(
              Effect.sync(() => {
                expect(runs[0]?.shell).toBe(Shell.acceptable("bash"))
                if (Shell.gitbash()) expect(runs[0]?.shell).toBe(Shell.gitbash())
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }

  it.live("approves an explicit external workdir before bash execution", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        return withTool(active.path, (registry) =>
          executeTool(registry, call({ command: "pwd", workdir: outside.path })),
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["external_directory", "bash"])
              expect(assertions[0]).toMatchObject({
                resources: [path.join(realpathSync(outside.path), "*").replaceAll("\\", "/")],
              })
              expect(runs).toHaveLength(1)
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("does not execute after external-directory or bash denial", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) =>
        Effect.gen(function* () {
          reset()
          denyAction = "external_directory"
          yield* withTool(active.path, (registry) =>
            executeTool(registry, call({ command: "pwd", workdir: outside.path })),
          )
          expect(assertions.map((item) => item.action)).toEqual(["external_directory"])
          expect(runs).toEqual([])

          reset()
          denyAction = "bash"
          yield* withTool(active.path, (registry) => executeTool(registry, call({ command: "pwd" })))
          expect(assertions.map((item) => item.action)).toEqual(["bash"])
          expect(runs).toEqual([])
        }),
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("requires external-directory approval for command arguments", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        const target = path.join(outside.path, "secret.txt")
        return withTool(active.path, (registry) => settleTool(registry, call({ command: `cat ${target}` }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["external_directory", "bash"])
              expect(runs).toHaveLength(1)
              expect(settled.output?.structured).toMatchObject({
                truncated: false,
              })
              expect(assertions[0]).toMatchObject({
                resources: [path.join(realpathSync(outside.path), "*").replaceAll("\\", "/")],
              })
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("retains complete output through the managed output store", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        result = { ...result, output: Buffer.from("HEAD\n" + "x".repeat(BashTool.MAX_CAPTURE_BYTES + 64) + "\nTAIL") }
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "verbose" }))).pipe(
          Effect.andThen((settled) =>
            Effect.gen(function* () {
              expect(settled.outputPaths).toHaveLength(1)
              expect(yield* Effect.promise(() => fs.readFile(settled.outputPaths![0], "utf8"))).toContain("TAIL")
              expect(settled.output?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("full content saved to"),
              })
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("keeps non-zero exits useful", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        result = { ...result, exitCode: 7, output: Buffer.from("HEAD full output TAIL") }
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "false" }, "call-overflow"))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Command exited with code 7"),
              })
              expect(settled.output?.structured).toMatchObject({
                exit: 7,
                truncated: false,
              })
              expect(settled.output?.content[0]).toEqual({ type: "text", text: "HEAD full output TAIL" })
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("surfaces bounded process-capture truncation", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        result = { ...result, outputTruncated: true }
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "verbose" }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.structured).toMatchObject({ truncated: true })
              expect(settled.output?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("output capture truncated"),
              })
              expect(settled.output?.structured).not.toHaveProperty("resource")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("transfers a timed-out foreground command to the background without interrupting it", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry, jobs) =>
          Effect.gen(function* () {
            const interrupted = yield* Deferred.make<void>()
            runHandler = () => Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))
            const settled = yield* settleTool(registry, call({ command: "long build", timeout: 10 }))
            const structured = settled.output?.structured as Record<string, unknown>
            const taskID = String(structured.task_id)

            expect(structured).toMatchObject({
              status: "running",
              background_reason: "timeout",
              truncated: false,
            })
            expect(settled.output?.content[1]).toMatchObject({
              type: "text",
              text: expect.stringContaining(`task ID ${taskID}`),
            })
            expect((yield* jobs.get(taskID))?.status).toBe("running")
            expect((yield* Deferred.poll(interrupted))._tag).toBe("None")

            yield* jobs.cancel(taskID)
            yield* Deferred.await(interrupted)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("caps foreground waiting at three minutes when a larger timeout is requested", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry, jobs) =>
          Effect.gen(function* () {
            const started = yield* Deferred.make<void>()
            const interrupted = yield* Deferred.make<void>()
            runHandler = () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              )
            const running = yield* settleTool(
              registry,
              call({ command: "long build", timeout: BashTool.MAX_TIMEOUT_MS }, "call-clamped-timeout"),
            ).pipe(Effect.forkScoped)
            yield* Deferred.await(started)
            yield* Effect.yieldNow

            yield* TestClock.adjust(BashTool.DEFAULT_TIMEOUT_MS - 1)
            expect(running.pollUnsafe()).toBeUndefined()
            yield* TestClock.adjust(1)

            const settled = yield* Fiber.join(running)
            const structured = settled.output?.structured as Record<string, unknown>
            const taskID = String(structured.task_id)
            expect(structured).toMatchObject({ status: "running", background_reason: "timeout" })
            expect(yield* jobs.get(taskID)).toMatchObject({
              status: "running",
              metadata: { callID: "call-clamped-timeout", background: true, backgroundReason: "timeout" },
            })
            expect((yield* Deferred.poll(interrupted))._tag).toBe("None")

            yield* jobs.cancel(taskID)
            yield* Deferred.await(interrupted)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("releases a manually promoted shell without interrupting its process", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry, jobs) =>
          Effect.gen(function* () {
            const started = yield* Deferred.make<void>()
            const interrupted = yield* Deferred.make<void>()
            runHandler = () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              )
            const running = yield* settleTool(
              registry,
              call({ command: "long build" }, "call-manual-background"),
            ).pipe(Effect.forkScoped)
            yield* Deferred.await(started)

            const job = (yield* jobs.list()).find((item) => item.metadata?.callID === "call-manual-background")
            expect(job).toMatchObject({
              type: "shell",
              status: "running",
              metadata: { sessionID, callID: "call-manual-background" },
            })
            yield* jobs.update({ id: job!.id, metadata: { backgroundReason: "manual" } })
            yield* jobs.promote(job!.id)

            const settled = yield* Fiber.join(running)
            expect(settled.output?.structured).toMatchObject({
              task_id: job!.id,
              status: "running",
              background_reason: "manual",
            })
            expect((yield* jobs.get(job!.id))?.status).toBe("running")
            expect((yield* Deferred.poll(interrupted))._tag).toBe("None")

            yield* jobs.cancel(job!.id)
            yield* Deferred.await(interrupted)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("returns live output for an explicitly backgrounded command", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry, jobs) =>
          Effect.gen(function* () {
            const outputReported = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            runHandler = (_command, options) =>
              (options?.onOutput?.(Buffer.from("build step 1\n")) ?? Effect.void).pipe(
                Effect.andThen(Deferred.succeed(outputReported, undefined)),
                Effect.andThen(Deferred.await(release)),
                Effect.as(result),
              )
            const settled = yield* settleTool(
              registry,
              call({ command: "long build", run_in_background: true }, "call-explicit-background"),
            )
            const taskID = String((settled.output?.structured as Record<string, unknown>).task_id)
            yield* Deferred.await(outputReported)

            expect(yield* jobs.get(taskID)).toMatchObject({
              status: "running",
              output: "build step 1\n",
              metadata: { outputBytes: 13, background: true, backgroundReason: "requested" },
            })
            yield* Deferred.succeed(release, undefined)
            expect((yield* jobs.wait({ id: taskID })).outcome).toBe("completed")
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("backgrounds on user steering and later admits one session-scoped completion", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry, jobs, database, events) =>
          Effect.gen(function* () {
            yield* setupSession(database.db, tmp.path)
            const started = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const interrupted = yield* Deferred.make<void>()
            runHandler = () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(result),
                Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
              )
            const running = yield* settleTool(registry, call({ command: "watch build" }, "call-steered-background")).pipe(
              Effect.forkScoped,
            )
            yield* Deferred.await(started)
            yield* SessionInput.admit(database.db, events, {
              id: SessionMessage.ID.make("msg_bash_user_steer"),
              sessionID,
              prompt: Prompt.make({ text: "Inspect the command instead" }),
              delivery: "steer",
            })

            const settled = yield* Fiber.join(running)
            const structured = settled.output?.structured as Record<string, unknown>
            const taskID = String(structured.task_id)
            expect(structured.background_reason).toBe("steer")
            expect((yield* jobs.get(taskID))?.status).toBe("running")
            expect((yield* Deferred.poll(interrupted))._tag).toBe("None")

            yield* Deferred.succeed(release, undefined)
            expect((yield* jobs.wait({ id: taskID })).outcome).toBe("completed")
            const pending = yield* SessionInput.pending(database.db, sessionID)
            const completion = pending.find((input) => input.id === SessionMessage.ID.make(`msg_shell_${taskID.slice(4)}`))
            expect(completion).toMatchObject({
              synthetic: { scope: "session" },
              delivery: "steer",
            })
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

test("keeps remaining deferred parity TODOs visible", async () => {
  const source = await fs.readFile(new URL("../src/tool/bash.ts", import.meta.url), "utf8")
  for (const todo of [
    "Port tree-sitter bash / PowerShell parser-based approval reduction.",
    "Port BashArity reusable command-prefix approvals.",
    "Replace token-based command-argument path detection with parser-based detection.",
    "Add plugin shell.env environment augmentation once V2 plugin hooks exist.",
    "Persist shell task status and output manifests if cross-restart process adoption is implemented.",
    "Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.",
    "Revisit binary output handling if stdout/stderr decoding is text-only.",
  ]) {
    expect(source).toContain(`TODO: ${todo}`)
  }
})
