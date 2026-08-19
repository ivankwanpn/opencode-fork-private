export * as BashTool from "./bash"

import os from "node:os"
import path from "node:path"
import { ToolFailure } from "@opencode-ai/llm"
import { Cause, Clock, Duration, Effect, Exit, Layer, Ref, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { BackgroundJob } from "../background-job"
import { Config } from "../config"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Identifier } from "../id/id"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { PluginRuntime } from "../plugin/runtime"
import { PositiveInt } from "../schema"
import { SessionCommand } from "../session/command"
import { SessionExecution } from "../session/execution"
import { SessionInput } from "../session/input"
import { SessionMessage } from "../session/message"
import { Shell } from "../shell"
import { ToolRegistry } from "./registry"
import { ShellCommand } from "./shell-command"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 3 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024
export const MAX_PROGRESS_BYTES = 32 * 1024
export const MAX_RUNNING_PER_SESSION = 10

export const Input = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Foreground wait in milliseconds. Defaults to and is capped at ${DEFAULT_TIMEOUT_MS}; larger values up to ${MAX_TIMEOUT_MS} are accepted for compatibility but clamped. A command still running afterward continues as a background task.`,
    }),
  run_in_background: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Start the command as a background task and return its task ID immediately",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  task_id: Schema.String.pipe(Schema.optional),
  status: Schema.Literals(["running", "completed"]).pipe(Schema.optional),
  background_reason: Schema.Literals(["requested", "timeout", "steer", "manual"]).pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.task_id)
    return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command is running in the background with task ID ${output.task_id}. Use get_task_output to inspect it or stop_task to stop it.`
  if (output.exit === undefined) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command completed.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

const processCommand = (shell: string, input: string, cwd: string, env: Record<string, string>) => {
  if (process.platform === "win32" && Shell.ps(shell))
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", input], {
      cwd,
      extendEnv: true,
      env,
      stdin: "ignore",
      detached: false,
      forceKillAfter: Duration.seconds(3),
    })
  return ChildProcess.make(input, [], {
    cwd,
    extendEnv: true,
    env,
    shell,
    stdin: "ignore",
    detached: process.platform !== "win32",
    forceKillAfter: Duration.seconds(3),
  })
}

/**
 * V2 shell boundary. A process-local owner keeps execution independent from
 * the foreground tool waiter so user steering can release the agent without
 * terminating the command.
 */
// TODO: Persist shell task status and output manifests if cross-restart process adoption is implemented.
// TODO: Add HTTP background-job observation only after durable status, restart recovery, and authorization are defined.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// Full shell output is retained by ToolOutputStore after execution; revisit streaming
// capture if unbounded process memory becomes a concern for hostile commands.

type ScannerToken = {
  readonly value: string
  readonly home: boolean
  readonly kind: ShellCommand.PathCandidate["kind"]
}

const shellTokens = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")
const bashWords = (command: string) =>
  command.match(/(?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'[^']*'|[^\s"'\\;|&<>()])+/g) ?? []

// Decode complete literal words or retain the stable parent before expansion.
function bashLiteral(word: string): ScannerToken | undefined {
  let value = ""
  let quote: "plain" | "single" | "double" = "plain"
  const home = word.startsWith("~")
  for (let index = 0; index < word.length; index++) {
    const character = word[index]
    if (quote === "single") {
      if (character === "'") quote = "plain"
      else value += character
      continue
    }
    if (quote === "double") {
      if (character === '"') {
        quote = "plain"
        continue
      }
      if (character === "$" || character === "`") {
        const boundary = bashStaticDirectory(value)
        return boundary ? { value: boundary, home, kind: "directory" } : undefined
      }
      if (character !== "\\") {
        value += character
        continue
      }
      const next = word[index + 1]
      if (next === undefined) return undefined
      if (next === "\n") {
        index++
        continue
      }
      if ('$`"\\'.includes(next)) {
        value += next
        index++
        continue
      }
      value += character
      continue
    }
    if (character === "'") {
      quote = "single"
      continue
    }
    if (character === '"') {
      quote = "double"
      continue
    }
    if (character === "$" || character === "`" || "*?[]{}".includes(character)) {
      const boundary = bashStaticDirectory(value)
      return boundary ? { value: boundary, home, kind: "directory" } : undefined
    }
    if (character !== "\\") {
      value += character
      continue
    }
    const next = word[index + 1]
    if (next === undefined) return undefined
    index++
    if (next !== "\n") value += next
  }
  if (quote !== "plain" || !value) return undefined
  return { value, home, kind: "file" }
}

function bashStaticDirectory(value: string): string | undefined {
  if (!value) return undefined
  const trimmed = value.replace(/\/+$/, "")
  if (trimmed !== value) {
    if (!trimmed) return "/"
    return /^[A-Za-z]:$/.test(trimmed) ? trimmed + "/" : trimmed
  }
  const separator = value.lastIndexOf("/")
  if (separator < 0) return undefined
  if (separator === 0) return "/"
  const directory = value.slice(0, separator)
  return /^[A-Za-z]:$/.test(directory) ? directory + "/" : directory
}

const scannerTokens = (command: string, kind: ShellCommand.Kind): ReadonlyArray<ScannerToken> =>
  kind === "bash"
    ? bashWords(command).flatMap((word) => {
        const token = bashLiteral(word)
        return token ? [token] : []
      })
    : shellTokens(command).map((token) => ({
        value: unquote(token).replace(/^[<>]+|[;,|&]+$/g, ""),
        home: !token.startsWith('"') && !token.startsWith("'"),
        kind: "file" as const,
      }))

const scannerPaths = (command: string, kind: ShellCommand.Kind) =>
  scannerTokens(command, kind).flatMap((token): ShellCommand.PathCandidate[] => {
    const value = token.value
    if (!value) return []
    const native =
      process.platform === "win32" &&
      (/^[A-Za-z]:[\\/]/.test(value) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(value))
    const absolute = kind === "bash" ? value.startsWith("/") || native : path.isAbsolute(FSUtil.windowsPath(value))
    const relative = kind === "bash" ? /^\.{1,2}(?:\/|$)/.test(value) : /^\.\.?[\\/]/.test(value)
    const home = token.home && (value === "~" || value.startsWith("~/") || (kind !== "bash" && value.startsWith("~\\")))
    if (!absolute && !relative && !home) return []
    return [{ value, kind: token.kind }]
  })

const shellKind = (shell: string): ShellCommand.Kind | undefined => {
  if (Shell.ps(shell)) return "powershell"
  if (Shell.posix(shell)) return "bash"
  if (Shell.name(shell) === "cmd") return "cmd"
}

const foregroundOutput = (info: BackgroundJob.Info) => {
  if (info.status === "error")
    return Effect.fail(new ToolFailure({ message: info.error ?? "Shell command failed without an error detail" }))
  if (info.status === "cancelled")
    return Effect.fail(new ToolFailure({ message: "Shell command was stopped before completion" }))
  if (info.status !== "completed")
    return Effect.fail(new ToolFailure({ message: `Shell command has unexpected status: ${info.status}` }))
  return Effect.succeed({
    ...(typeof info.metadata?.exit === "number" ? { exit: info.metadata.exit } : {}),
    output: info.output ?? "(no output)",
    truncated: info.metadata?.truncated === true,
  } satisfies Output)
}

const backgroundOutput = (
  info: BackgroundJob.Info,
  reason: "requested" | "timeout" | "steer" | "manual",
): Output => ({
  task_id: info.id,
  status: "running",
  background_reason: reason,
  output: info.output ?? "(no output yet)",
  truncated: false,
})

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const jobs = yield* BackgroundJob.Service
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const commands = yield* SessionCommand.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service
    const plugins = yield* PluginRuntime.Service

    const nativePath = Effect.fn("BashTool.nativePath")(function* (
      value: string,
      shell: string,
      kind: ShellCommand.Kind,
    ) {
      const expanded =
        value === "~"
          ? os.homedir()
          : value.startsWith("~/") || value.startsWith("~\\")
            ? path.join(os.homedir(), value.slice(2))
            : value
      if (process.platform !== "win32") return expanded
      if (
        kind === "powershell" &&
        (/^[A-Za-z]:[^\\/]/.test(expanded) ||
          expanded.includes("::") ||
          (/^[A-Za-z][A-Za-z0-9.-]*:/.test(expanded) && !/^[A-Za-z]:[\\/]/.test(expanded)))
      )
        return yield* new ToolFailure({ message: `Unsupported PowerShell path: ${value}` })
      const translated = FSUtil.windowsPath(expanded)
      if (translated !== expanded) return translated
      if (/^[A-Za-z]:[\\/]/.test(expanded) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(expanded)) return expanded
      if (!expanded.startsWith("/")) return expanded
      if (Shell.name(shell) !== "bash")
        return yield* new ToolFailure({ message: `Cannot safely translate shell path: ${value}` })

      const converted = yield* appProcess
        .run(
          ChildProcess.make(shell, ["--noprofile", "--norc", "-c", 'cygpath -w -- "$1"', "opencode", expanded], {
            stdin: "ignore",
            detached: false,
            forceKillAfter: Duration.seconds(1),
          }),
          { maxOutputBytes: 4096, maxErrorBytes: 4096, timeout: Duration.seconds(2) },
        )
        .pipe(
          Effect.flatMap(AppProcess.requireSuccess),
          Effect.catchTag("AppProcessError", () =>
            Effect.fail(new ToolFailure({ message: `Cannot safely translate shell path: ${value}` })),
          ),
        )
      const output = converted.stdout.toString("utf8").replace(/\r?\n$/, "")
      const native = FSUtil.windowsPath(output)
      const absolute = /^[A-Za-z]:[\\/]/.test(native) || /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(native)
      if (
        converted.outputTruncated === true ||
        converted.stdoutTruncated ||
        converted.stderrTruncated ||
        !output ||
        /[\r\n\0]/.test(output) ||
        !absolute
      )
        return yield* new ToolFailure({ message: `Cannot safely translate shell path: ${value}` })
      return native
    })

    yield* tools
      .register({
        [name]: Tool.make({
          description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir and command-argument paths require external_directory approval. Commands return normally when they finish; after ${DEFAULT_TIMEOUT_MS} ms in the foreground they continue as owned background tasks instead of being killed. Set run_in_background to return a task ID immediately. Use get_task_output for status and recent output, and stop_task for explicit cancellation. A new user steer also transfers a still-running command to the background so the agent can respond without terminating it. Uses the configured shell when set and the same host-shell selection as the official runtime otherwise. On Windows, configured bash resolves to Git Bash instead of WSL bash; use Windows drive paths such as D:/path with Git Bash and native paths with PowerShell or cmd.`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => ({
            truncated: output.truncated,
            ...(output.exit === undefined ? {} : { exit: output.exit }),
            ...(output.task_id === undefined ? {} : { task_id: output.task_id }),
            ...(output.status === undefined ? {} : { status: output.status }),
            ...(output.background_reason === undefined ? {} : { background_reason: output.background_reason }),
          }),
          toModelOutput: ({ output }) => [
            { type: "text", text: output.output },
            { type: "text", text: modelOutput(output) },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const shell = Shell.acceptable(Config.latest(yield* config.entries(), "shell"))
              const kind = shellKind(shell)
              if (!kind)
                return yield* new ToolFailure({
                  message: `Unsupported configured shell: ${Shell.name(shell) || shell}`,
                })
              const analysis = yield* ShellCommand.analyze({ command: input.command, kind }).pipe(
                Effect.catchTag("ShellCommand.AnalysisError", (error) =>
                  Effect.fail(
                    new ToolFailure({
                      message: `Unable to safely analyze ${error.kind} command (${error.reason})`,
                    }),
                  ),
                ),
              )
              const workdir = yield* nativePath(input.workdir ?? ".", shell, kind)
              const target = yield* mutation.resolve({ path: workdir, kind: "directory" })
              const candidates = [...analysis.pathHints, ...scannerPaths(input.command, kind)]
              const resolved = yield* Effect.forEach(candidates, (candidate) =>
                nativePath(candidate.value, shell, kind).pipe(
                  Effect.map((value) => (path.isAbsolute(value) ? value : path.resolve(target.canonical, value))),
                  Effect.flatMap((value) => mutation.resolve({ path: value, kind: candidate.kind })),
                ),
              )
              const targets = new Map<string, LocationMutation.Target>()
              targets.set(target.canonical, target)
              for (const item of resolved) targets.set(item.canonical, item)
              const external = new Map<string, LocationMutation.ExternalDirectoryAuthorization>()
              for (const item of targets.values()) {
                if (!item.externalDirectory || external.has(item.externalDirectory.resource)) continue
                external.set(item.externalDirectory.resource, item.externalDirectory)
              }
              for (const item of external.values())
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(item),
                  metadata: { command: input.command, directory: item.directory },
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              yield* permission.assert({
                action: name,
                resources: analysis.resources.length > 0 ? analysis.resources : [input.command],
                save: Shell.name(shell) === "bash" ? analysis.save : [],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              if ((yield* fs.stat(target.canonical)).type !== "Directory")
                return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

              const running = (yield* jobs.list()).filter(
                (job) =>
                  job.type === "shell" &&
                  job.status === "running" &&
                  job.metadata?.sessionID === context.sessionID,
              )
              if (running.length >= MAX_RUNNING_PER_SESSION)
                return yield* new ToolFailure({
                  message: `Shell task limit reached (${MAX_RUNNING_PER_SESSION}); inspect or stop an existing task first`,
                })

              const environment = PluginRuntime.mutable<Record<string, string>>({})
              yield* plugins.run(PluginRuntime.HookName.shellEnv, {
                cwd: target.canonical,
                sessionID: context.sessionID,
                callID: context.toolCallID,
                env: environment.value,
              })
              const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
              const taskID = Identifier.ascending("job")
              const progress = yield* Ref.make({ tail: Buffer.alloc(0), bytes: 0, lastOutputAt: undefined as number | undefined })
              const execution = yield* SessionExecution.Current
              const onOutput = (chunk: Uint8Array) =>
                Effect.gen(function* () {
                  const now = yield* Clock.currentTimeMillis
                  const next = yield* Ref.modify(progress, (current) => {
                    const combined = Buffer.concat([current.tail, Buffer.from(chunk)])
                    const value = {
                      tail: combined.length > MAX_PROGRESS_BYTES ? combined.subarray(combined.length - MAX_PROGRESS_BYTES) : combined,
                      bytes: current.bytes + chunk.length,
                      lastOutputAt: now,
                    }
                    return [value, value]
                  })
                  yield* jobs.update({
                    id: taskID,
                    output: next.tail.toString("utf8"),
                    metadata: { outputBytes: next.bytes, lastOutputAt: next.lastOutputAt },
                  })
                })
              const notify = (exit: Exit.Exit<string, AppProcess.AppProcessError>) =>
                Effect.gen(function* () {
                  const info = yield* jobs.get(taskID)
                  if (info?.metadata?.background !== true || info.metadata.suppressNotification === true) return
                  const current = yield* Ref.get(progress)
                  const state = Exit.isSuccess(exit)
                    ? "completed"
                    : Cause.hasInterruptsOnly(exit.cause)
                      ? "cancelled"
                      : "error"
                  const detail = Exit.isSuccess(exit)
                    ? current.tail.toString("utf8") || "(no output)"
                    : String(Cause.squash(exit.cause))
                  yield* commands
                    .admitSynthetic({
                      id: SessionMessage.ID.make(`msg_shell_${taskID.slice(4)}`),
                      sessionID: context.sessionID,
                      text: [
                        `<task id="${taskID}" state="${state}">`,
                        `<summary>${escapeXml(input.command)}</summary>`,
                        state === "completed" ? "<task_result>" : "<task_error>",
                        detail,
                        state === "completed" ? "</task_result>" : "</task_error>",
                        "</task>",
                      ].join("\n"),
                      description: `Background shell ${state}: ${input.command}`,
                      delivery: "steer",
                      scope: "session",
                    })
                    .pipe(Effect.ignore)
                  if (execution) yield* execution.wake(context.sessionID).pipe(Effect.ignore)
                })
              const run = appProcess
                .run(processCommand(shell, input.command, target.canonical, { ...environment.get(), TERM: "dumb" }), {
                  combineOutput: true,
                  onOutput,
                })
                .pipe(
                  Effect.flatMap((result) => {
                    const output = result.output?.toString("utf8") || "(no output)"
                    const notice = result.outputTruncated
                      ? "[output capture truncated at the in-memory safety limit]"
                      : undefined
                    return jobs
                      .update({
                        id: taskID,
                        metadata: {
                          exit: result.exitCode,
                          truncated: result.outputTruncated === true,
                        },
                      })
                      .pipe(Effect.as(notice ? `${output}\n\n${notice}` : output))
                  }),
                  Effect.onExit(notify),
                )
              const background = Effect.fn("BashTool.background")(function* (
                reason: "requested" | "timeout" | "steer" | "manual",
              ) {
                yield* jobs.update({ id: taskID, metadata: { backgroundReason: reason } })
                const promoted = yield* jobs.promote(taskID)
                if (promoted) return backgroundOutput(promoted, reason)
                const current = yield* jobs.get(taskID)
                if (!current) return yield* new ToolFailure({ message: "Shell task disappeared before settlement" })
                return yield* foregroundOutput(current)
              })

              return yield* Effect.uninterruptibleMask((restore) =>
                Effect.gen(function* () {
                  yield* jobs.start({
                    id: taskID,
                    type: "shell",
                    title: input.command,
                    metadata: {
                      sessionID: context.sessionID,
                      agent: context.agent,
                      callID: context.toolCallID,
                      command: input.command,
                      workdir: target.canonical,
                      outputBytes: 0,
                    },
                    run,
                  })
                  if (input.run_in_background === true) return yield* background("requested")

                  const observation = yield* restore(
                    Effect.raceFirst(
                      jobs.wait({ id: taskID, timeout }).pipe(
                        Effect.map((result) => ({ type: "job" as const, result })),
                      ),
                      Effect.raceFirst(
                        SessionInput.waitForPending(db, events, {
                          sessionID: context.sessionID,
                          delivery: "steer",
                          includeSynthetic: false,
                        }).pipe(Effect.as({ type: "steer" as const })),
                        jobs
                          .waitForPromotion(taskID)
                          .pipe(Effect.map((info) => ({ type: "promotion" as const, info }))),
                      ),
                    ),
                  ).pipe(Effect.onInterrupt(() => jobs.cancel(taskID).pipe(Effect.asVoid)))
                  if (observation.type === "steer") return yield* background("steer")
                  if (observation.type === "promotion") {
                    if (observation.info) return backgroundOutput(observation.info, "manual")
                    const current = yield* jobs.get(taskID)
                    if (!current)
                      return yield* new ToolFailure({ message: "Shell task disappeared before settlement" })
                    return yield* foregroundOutput(current)
                  }
                  if (observation.result.timedOut) return yield* background("timeout")
                  if (!observation.result.info)
                    return yield* new ToolFailure({ message: "Shell task disappeared before settlement" })
                  return yield* foregroundOutput(observation.result.info)
                }),
              )
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to execute command: ${input.command}` }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/bash",
  layer,
  deps: [
    ToolRegistry.node,
    LocationMutation.node,
    FSUtil.node,
    AppProcess.node,
    BackgroundJob.node,
    Database.node,
    EventV2.node,
    SessionCommand.node,
    Config.node,
    PermissionV2.node,
    PluginRuntime.node,
  ],
})
