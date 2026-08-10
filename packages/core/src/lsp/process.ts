import type { ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process"
import launch from "cross-spawn"

export type Child = ChildProcessWithoutNullStreams

export function spawn(command: string, args: string[], options?: SpawnOptions): Child
export function spawn(command: string, options?: SpawnOptions): Child
export function spawn(command: string, argsOrOptions?: string[] | SpawnOptions, options?: SpawnOptions) {
  const args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : []
  const config = Array.isArray(argsOrOptions) ? options : argsOrOptions
  const child = launch(command, args, {
    ...config,
    stdio: ["pipe", "pipe", "pipe"],
  })
  if (!child.stdin || !child.stdout || !child.stderr) throw new Error("Process output not available")
  return child as Child
}

export async function stop(process: Child) {
  if (process.exitCode !== null || process.signalCode !== null) return
  if (globalThis.process.platform !== "win32" || !process.pid) {
    process.kill()
    return
  }
  const result = Bun.spawnSync(["taskkill", "/pid", String(process.pid), "/T", "/F"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  if (result.exitCode !== 0) process.kill()
}

export * as LSPProcess from "./process"
