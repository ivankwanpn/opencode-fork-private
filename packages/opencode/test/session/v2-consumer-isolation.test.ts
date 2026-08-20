import { expect, test } from "bun:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const migrated = [
  "cli/cmd/session.ts",
  "cli/cmd/stats.ts",
  "cli/cmd/github.handler.ts",
  "control-plane/workspace.ts",
  "server/routes/instance/httpapi/handlers/experimental.ts",
  "server/routes/instance/httpapi/handlers/tui.ts",
  "server/routes/instance/httpapi/handlers/sync.ts",
  "share/share-next.ts",
  "share/session.ts",
  "session/legacy-session-execution.ts",
]

test("migrated Session consumers do not import the legacy Session service", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const offenders = (
    await Promise.all(
      migrated.map(async (file) => ({
        file,
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter((entry) => entry.source.includes('from "@/session/session"') || entry.source.includes("Session.Service"))
    .map((entry) => entry.file)

  expect(offenders).toEqual([])
})

test("production runtime does not resolve or mount the legacy Session service", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter((entry) => /\bSession\.(?:Service|node)\b/.test(entry.source))
    .map((entry) => entry.file)
    .sort()

  expect(offenders).toEqual([])
})

test("legacy Session service module is deleted", async () => {
  expect(await Bun.file(new URL("../../src/session/session.ts", import.meta.url)).exists()).toBe(false)
})

test("legacy Agent service is deleted and cannot be mounted by production runtime", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter(
      (entry) =>
        entry.source.includes("@/agent/agent") ||
        entry.source.includes("Agent.Service") ||
        entry.source.includes("Agent.node"),
    )
    .map((entry) => entry.file)
    .sort()

  expect(await Bun.file(new URL("../../src/agent/agent.ts", import.meta.url)).exists()).toBe(false)
  expect(await Bun.file(new URL("../../src/agent/subagent-permissions.ts", import.meta.url)).exists()).toBe(false)
  expect(offenders).toEqual([])
})

test("production runtime does not resolve or mount the legacy Provider service", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const repositoryRoot = path.resolve(root, "../../..")
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter((entry) => /\bProvider\.(?:Service|node)\b/.test(entry.source))
    .map((entry) => entry.file)
    .sort()

  const provider = await Bun.file(path.join(root, "provider/provider.ts")).text()
  const deleted = [
    "packages/opencode/test/provider/provider.test.ts",
    "packages/opencode/test/provider/provider-live-models.test.ts",
    "packages/opencode/test/provider/header-timeout.test.ts",
    "packages/opencode/test/provider/digitalocean.test.ts",
    "packages/opencode/test/provider/amazon-bedrock.test.ts",
    "packages/opencode/test/fake/provider.ts",
  ]
  expect(provider).not.toMatch(/export class Service|export const node|export const use/)
  expect(
    await Promise.all(deleted.map(async (file) => [file, await Bun.file(path.join(repositoryRoot, file)).exists()])),
  ).toEqual(deleted.map((file) => [file, false]))
  expect(offenders).toEqual([])
})

test("legacy Auth service is deleted and cannot be mounted by production runtime", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter(
      (entry) =>
        entry.source.includes('from "@/auth"') ||
        entry.source.includes('from "../auth"') ||
        /\bAuth\.(?:Service|node)\b/.test(entry.source),
    )
    .map((entry) => entry.file)
    .sort()

  expect(await Bun.file(new URL("../../src/auth/index.ts", import.meta.url)).exists()).toBe(false)
  expect(offenders).toEqual([])
})

test("legacy Permission service is deleted and cannot be mounted by production runtime", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter(
      (entry) =>
        entry.source.includes('from "@/permission"') ||
        entry.source.includes("Permission.Service") ||
        entry.source.includes("Permission.node"),
    )
    .map((entry) => entry.file)
    .sort()

  expect(await Bun.file(new URL("../../src/permission/index.ts", import.meta.url)).exists()).toBe(false)
  expect(await Bun.file(new URL("../../src/permission/evaluate.ts", import.meta.url)).exists()).toBe(false)
  expect(offenders).toEqual([])
})

test("legacy OpenCode ToolRegistry root is deleted and not mounted by production source", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter(
      (entry) =>
        entry.source.includes("@/tool/registry") ||
        entry.source.includes("@opencode/ToolRegistry") ||
        entry.source.includes('from "./registry"'),
    )
    .map((entry) => entry.file)
    .sort()

  expect(await Bun.file(new URL("../../src/tool/registry.ts", import.meta.url)).exists()).toBe(false)
  expect(offenders).toEqual([])
})

test("legacy shell parser and arity closure is deleted and cannot be imported", async () => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const repositoryRoot = path.resolve(sourceRoot, "../../..")
  const deleted = [
    "packages/opencode/src/tool/shell.ts",
    "packages/opencode/src/tool/shell/id.ts",
    "packages/opencode/src/tool/shell/prompt.ts",
    "packages/opencode/src/tool/shell/shell.txt",
    "packages/opencode/src/permission/arity.ts",
    "packages/opencode/test/tool/shell.test.ts",
    "packages/opencode/test/permission/arity.test.ts",
  ]
  const aliases = new Set(["@/tool/shell", "@/tool/shell/id", "@/tool/shell/prompt", "@/permission/arity"])
  const modules = new Set(
    deleted
      .filter((file) => file.startsWith("packages/opencode/src/") && file.endsWith(".ts"))
      .map((file) => path.resolve(repositoryRoot, file).slice(0, -3).replaceAll("\\", "/")),
  )
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("packages/**/*.{ts,tsx}").scanSync(repositoryRoot)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(repositoryRoot, file)).text(),
      })),
    )
  )
    .flatMap((entry) =>
      [...entry.source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].flatMap((match) => {
        const specifier = match[1]!
        if (aliases.has(specifier)) return [entry.file]
        if (!specifier.startsWith(".")) return []
        const resolved = path
          .resolve(repositoryRoot, path.dirname(entry.file), specifier.replace(/\.ts$/, ""))
          .replaceAll("\\", "/")
        return modules.has(resolved) ? [entry.file] : []
      }),
    )
    .sort()

  expect(
    await Promise.all(deleted.map(async (file) => [file, await Bun.file(path.join(repositoryRoot, file)).exists()])),
  ).toEqual(deleted.map((file) => [file, false]))
  expect(offenders).toEqual([])
})

test("legacy OpenCode tool leaves are deleted and cannot be imported", async () => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const repositoryRoot = path.resolve(sourceRoot, "../../..")
  const modules = [
    "apply_patch",
    "code-mode",
    "edit",
    "external-directory",
    "glob",
    "grep",
    "invalid",
    "json-schema",
    "lsp",
    "mcp-websearch",
    "plan",
    "question",
    "read",
    "skill",
    "task",
    "todo",
    "tool",
    "webfetch",
    "websearch",
    "write",
  ]
  const deleted = modules.map((module) => `packages/opencode/src/tool/${module}.ts`)
  const aliases = new Set(modules.map((module) => `@/tool/${module}`))
  const resolvedModules = new Set(
    deleted.map((file) => path.resolve(repositoryRoot, file).slice(0, -3).replaceAll("\\", "/")),
  )
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("packages/**/*.{ts,tsx}").scanSync(repositoryRoot)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(repositoryRoot, file)).text(),
      })),
    )
  )
    .flatMap((entry) =>
      [...entry.source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].flatMap((match) => {
        const specifier = match[1]!
        if (aliases.has(specifier)) return [entry.file]
        if (!specifier.startsWith(".")) return []
        const resolved = path
          .resolve(repositoryRoot, path.dirname(entry.file), specifier.replace(/\.ts$/, ""))
          .replaceAll("\\", "/")
        return resolvedModules.has(resolved) ? [entry.file] : []
      }),
    )
    .sort()

  expect(
    await Promise.all(deleted.map(async (file) => [file, await Bun.file(path.join(repositoryRoot, file)).exists()])),
  ).toEqual(deleted.map((file) => [file, false]))
  expect(offenders).toEqual([])
})

test("production status publishers do not emit the deprecated Session Idle event", async () => {
  const sources = await Promise.all(
    [
      new URL("../../../core/src/session.ts", import.meta.url),
      new URL("../../../core/src/session/execution/local.ts", import.meta.url),
      new URL("../../src/session/status.ts", import.meta.url),
    ].map(async (file) => ({ file: file.pathname, source: await Bun.file(file).text() })),
  )
  const offenders = sources
    .filter(
      (entry) => entry.source.includes("SessionStatusEvent.Idle") || entry.source.includes("events.publish(Event.Idle"),
    )
    .map((entry) => entry.file)

  expect(offenders).toEqual([])
})

test("legacy wire helpers do not re-export V1 Session events", async () => {
  const sources = await Promise.all(
    [
      new URL("../../src/compat/session-wire.ts", import.meta.url),
      new URL("../../src/session/message-v2.ts", import.meta.url),
    ].map(async (file) => ({ file: file.pathname, source: await Bun.file(file).text() })),
  )

  expect(sources.filter((entry) => entry.source.includes("SessionV1.Event.")).map((entry) => entry.file)).toEqual([])
})

test("production request lifecycles do not publish or consume V1 event names", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const pattern = /\b(?:permission\.(?:asked|replied)|question\.(?:asked|replied|rejected))\b/
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter((entry) => pattern.test(entry.source))
    .map((entry) => entry.file)
    .sort()

  expect(offenders).toEqual([])
})

test("production Session lifecycle consumers use canonical V2 event names", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src")
  const pattern = /\bsession\.(?:created|updated|deleted)\b/
  const offenders = (
    await Promise.all(
      [...new Bun.Glob("**/*.ts").scanSync(root)].map(async (file) => ({
        file: file.replaceAll("\\", "/"),
        source: await Bun.file(path.join(root, file)).text(),
      })),
    )
  )
    .filter((entry) => pattern.test(entry.source))
    .map((entry) => entry.file)
    .sort()

  expect(offenders).toEqual([])
})

test("production consumers do not reintroduce V1 message snapshot events", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const roots = [
    ["opencode", path.resolve(here, "../../src")],
    ["app", path.resolve(here, "../../../app/src")],
    ["tui", path.resolve(here, "../../../tui/src")],
    ["plugin", path.resolve(here, "../../../plugin/src")],
    ["slack", path.resolve(here, "../../../slack/src")],
    ["session-ui", path.resolve(here, "../../../session-ui/src")],
  ] as const
  const pattern = /["'](?:message\.updated|message\.removed|message\.part\.updated|message\.part\.removed)["']/
  const offenders = (
    await Promise.all(
      roots.flatMap(([name, root]) =>
        [...new Bun.Glob("**/*.{ts,tsx}").scanSync(root)].map(async (file) => ({
          file: `${name}/${file.replaceAll("\\", "/")}`,
          source: await Bun.file(path.join(root, file)).text(),
        })),
      ),
    )
  )
    .filter((entry) => pattern.test(entry.source))
    .map((entry) => entry.file)
    .sort()

  expect(offenders).toEqual([])
})
