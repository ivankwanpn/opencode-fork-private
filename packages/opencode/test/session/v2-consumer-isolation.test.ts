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
  "tool/code-mode.ts",
  "tool/task.ts",
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
