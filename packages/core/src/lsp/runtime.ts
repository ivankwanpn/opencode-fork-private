export * as LSPRuntime from "./runtime"

import type { ChildProcess } from "child_process"
import type { Stream } from "node:stream"
import path from "path"
import { buffer } from "node:stream/consumers"
import fs from "fs/promises"
import launch from "cross-spawn"

export namespace Filesystem {
  export const exists = async (input: string) =>
    fs
      .stat(input)
      .then(() => true)
      .catch(() => false)

  export async function write(input: string, content: Uint8Array) {
    await fs.mkdir(path.dirname(input), { recursive: true })
    await fs.writeFile(input, content)
  }

  export async function readText(input: string) {
    return fs.readFile(input, "utf8")
  }

  export async function writeStream(input: string, stream: ReadableStream<Uint8Array>) {
    await fs.mkdir(path.dirname(input), { recursive: true })
    const file = await fs.open(input, "w")
    const reader = stream.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        await file.write(chunk.value)
      }
    } finally {
      reader.releaseLock()
      await file.close()
    }
  }

  export async function findUp(target: string, start: string, stop?: string) {
    const result: string[] = []
    let current = start
    while (true) {
      const candidate = path.join(current, target)
      if (await exists(candidate)) result.push(candidate)
      if (stop === current) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    let current = options.start
    while (true) {
      for (const target of options.targets) {
        const candidate = path.join(current, target)
        if (await exists(candidate)) yield candidate
      }
      if (options.stop === current) break
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
}

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore" | number | Stream
  export type Shell = boolean | string

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv | null
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    shell?: Shell
    abort?: AbortSignal
    kill?: NodeJS.Signals | number
    timeout?: number
  }

  export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
    nothrow?: boolean
  }

  export interface Result {
    code: number
    stdout: Buffer
    stderr: Buffer
  }

  export interface TextResult extends Result {
    text: string
  }

  export type Child = ChildProcess & { exited: Promise<number> }

  export function spawn(cmd: string[], options: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    options.abort?.throwIfAborted()
    const child = launch(cmd[0], cmd.slice(1), {
      cwd: options.cwd,
      shell: options.shell,
      env: options.env === null ? {} : options.env ? { ...process.env, ...options.env } : undefined,
      stdio: [options.stdin ?? "ignore", options.stdout ?? "ignore", options.stderr ?? "ignore"],
      windowsHide: process.platform === "win32",
    })
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = () => {
      if (closed || child.exitCode !== null || child.signalCode !== null) return
      closed = true
      child.kill(options.kill ?? "SIGTERM")
      const timeout = options.timeout ?? 5_000
      if (timeout > 0) timer = setTimeout(() => child.kill("SIGKILL"), timeout)
    }
    const exited = new Promise<number>((resolve, reject) => {
      const done = () => {
        options.abort?.removeEventListener("abort", abort)
        if (timer) clearTimeout(timer)
      }
      child.once("exit", (code, signal) => {
        done()
        resolve(code ?? (signal ? 1 : 0))
      })
      child.once("error", (error) => {
        done()
        reject(error)
      })
    })
    void exited.catch(() => undefined)
    if (options.abort) {
      options.abort.addEventListener("abort", abort, { once: true })
      if (options.abort.aborted) abort()
    }
    return Object.assign(child, { exited })
  }

  export async function run(cmd: string[], options: RunOptions = {}): Promise<Result> {
    const child = spawn(cmd, {
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin,
      shell: options.shell,
      abort: options.abort,
      kill: options.kill,
      timeout: options.timeout,
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!child.stdout || !child.stderr) throw new Error("Process output not available")
    const result = await Promise.all([child.exited, buffer(child.stdout), buffer(child.stderr)])
      .then(([code, stdout, stderr]) => ({ code, stdout, stderr }))
      .catch((error: unknown) => {
        if (!options.nothrow) throw error
        return {
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(error instanceof Error ? error.message : String(error)),
        }
      })
    if (result.code === 0 || options.nothrow) return result
    throw new Error(`Command failed with code ${result.code}: ${cmd.join(" ")}\n${result.stderr.toString().trim()}`)
  }

  export async function text(cmd: string[], options: RunOptions = {}): Promise<TextResult> {
    const result = await run(cmd, options)
    return { ...result, text: result.stdout.toString() }
  }
}

export namespace Archive {
  export async function extractZip(zipPath: string, destination: string) {
    if (process.platform === "win32") {
      const archive = path.resolve(zipPath).replaceAll("'", "''")
      const target = path.resolve(destination).replaceAll("'", "''")
      const command = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '${archive}' -DestinationPath '${target}' -Force`
      await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", command])
      return
    }
    await Process.run(["unzip", "-o", "-q", zipPath, "-d", destination])
  }
}
