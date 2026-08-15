import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"

interface WorkerResult {
  readonly mode: "discover" | "resume"
  readonly pid: number
  readonly semanticDiscoveryCount: number
  readonly selectedToolNames: ReadonlyArray<string>
  readonly nativeSearchCallIDs: ReadonlyArray<string>
  readonly nativeSearchOutputIDs: ReadonlyArray<string>
  readonly nativeSearchOutputNames: ReadonlyArray<string>
  readonly advertisedFunctionNames: ReadonlyArray<string>
}

const worker = path.join(import.meta.dir, "fixture", "native-tool-search-process.ts")

test(
  "native Tool Search survives a child OS process restart",
  async () => {
    await using tmp = await tmpdir()
    const database = path.join(tmp.path, "native-tool-search.sqlite")
    const runtime = path.join(tmp.path, "runtime")
    const discoverOutput = path.join(tmp.path, "discover.json")
    const resumeOutput = path.join(tmp.path, "resume.json")
    const run = (mode: WorkerResult["mode"], output: string) =>
      Bun.spawnSync([process.execPath, worker, mode, database, output], {
        cwd: path.resolve(import.meta.dir, ".."),
        env: {
          ...process.env,
          OPENCODE_TEST_HOME: runtime,
          XDG_DATA_HOME: path.join(runtime, "data"),
          XDG_CACHE_HOME: path.join(runtime, "cache"),
          XDG_CONFIG_HOME: path.join(runtime, "config"),
          XDG_STATE_HOME: path.join(runtime, "state"),
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      })

    const discover = run("discover", discoverOutput)
    expect(discover.exitedDueToTimeout).toBe(false)
    expect(discover.stderr.toString()).toBe("")
    expect(discover.exitCode).toBe(0)

    const resume = run("resume", resumeOutput)
    expect(resume.exitedDueToTimeout).toBe(false)
    expect(resume.stderr.toString()).toBe("")
    expect(resume.exitCode).toBe(0)

    const first = (await Bun.file(discoverOutput).json()) as WorkerResult
    const second = (await Bun.file(resumeOutput).json()) as WorkerResult
    expect(first).toMatchObject({ mode: "discover", semanticDiscoveryCount: 1 })
    expect(second).toMatchObject({ mode: "resume", semanticDiscoveryCount: 1 })
    expect(first.pid).not.toBe(process.pid)
    expect(second.pid).not.toBe(process.pid)
    expect(first.selectedToolNames).toContain("deferred_echo")
    expect(second.selectedToolNames).toContain("deferred_echo")
    expect(second.nativeSearchCallIDs).toContain("process-search")
    expect(second.nativeSearchOutputIDs).toContain("process-search")
    expect(second.nativeSearchOutputNames).toContain("deferred_echo")
    expect(second.advertisedFunctionNames).not.toContain("deferred_echo")
  },
  30_000,
)
