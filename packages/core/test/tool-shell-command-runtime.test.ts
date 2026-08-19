import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"

const node = Bun.which("node")
const nodeVersion = node
  ? Bun.spawnSync([node, "--version"], { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim()
  : ""
const nodeMajor = Number(nodeVersion.match(/^v(\d+)/)?.[1] ?? 0)
const nodeTest = node ? test : test.skip
const nodeSourceTest = nodeMajor >= 24 ? test : test.skip
const worker = path.join(import.meta.dir, "fixture", "shell-command-runtime.ts")

const expected = {
  bash: {
    resources: ["echo test", "redirect > output.txt"],
    save: ["echo *"],
    pathHints: [{ value: "output.txt", kind: "file" }],
  },
  powershell: {
    resources: ["Write-Host test", "redirect > output.txt"],
    save: [],
    pathHints: [{ value: "output.txt", kind: "file" }],
  },
}

nodeSourceTest("runs shell analysis directly from TypeScript source in Node 24+", async () => {
  expect(await runNode([worker])).toEqual(expected)
})

test("emits every parser WASM asset in a Bun node-target split bundle", async () => {
  await using tmp = await tmpdir()
  const build = await bundle(tmp.path)

  expect(build.success).toBe(true)
  expect(
    build.outputs
      .map((output) => path.basename(output.path))
      .filter((name) => name.endsWith(".wasm"))
      .sort(),
  ).toEqual([
    expect.stringMatching(/^tree-sitter-[a-z0-9]+\.wasm$/),
    expect.stringMatching(/^tree-sitter-bash-[a-z0-9]+\.wasm$/),
    expect.stringMatching(/^tree-sitter-powershell-[a-z0-9]+\.wasm$/),
  ])
})

nodeTest("runs shell analysis from a Bun node-target split bundle in Node", async () => {
  await using tmp = await tmpdir()
  const build = await bundle(tmp.path)
  expect(build.success).toBe(true)

  expect(await runNode([path.join(tmp.path, "shell-command-runtime.mjs")])).toEqual(expected)
})

async function bundle(outdir: string) {
  return Bun.build({
    entrypoints: [worker],
    format: "esm",
    target: "node",
    splitting: true,
    outdir,
    naming: {
      entry: "shell-command-runtime.mjs",
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
  })
}

async function runNode(args: ReadonlyArray<string>) {
  if (!node) throw new Error("Node is required for this runtime smoke test")
  const child = Bun.spawn([node, ...args], {
    cwd: path.resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => child.kill(), 30_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timeout))

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  return JSON.parse(stdout) as unknown
}
