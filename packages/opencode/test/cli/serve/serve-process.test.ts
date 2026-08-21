// Subprocess integration tests for `opencode serve`. Spawns the real CLI in
// headless mode and exercises it over HTTP — this is the only test tier that
// catches bugs spanning argv → server boot → routing → instance loading.
//
// `serve` is long-lived: the harness returns a handle (url/port/kill/exited)
// and kills the process when the test scope closes. The OS-assigned port is
// parsed off the "listening on http://..." line.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import { copyFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { cliIt } from "../../lib/cli-process"
import { createGeneratedLifecycleClient, runV2LifecycleContract } from "../../server/v2-lifecycle-contract"

const previousReleaseDatabase = process.env.OPENCODE_PREVIOUS_RELEASE_DB

describe("opencode serve (subprocess)", () => {
  // Smoke test: server starts, binds a port, and the native V2 health endpoint responds.
  // If this fails, all other serve tests likely will too — debug here first.
  cliIt.live(
    "starts, binds a port, and serves /api/health",
    ({ opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        expect(server.port).toBeGreaterThan(0)
        expect(server.url).toMatch(/^http:\/\//)

        const client = yield* HttpClient.HttpClient
        const res = yield* client.get(`${server.url}/api/health`)
        expect(res.status).toBe(200)
        const body = yield* res.json
        expect(body).toEqual({ healthy: true, pid: expect.any(Number) })
      }),
    60_000,
  )

  // The scope-close finalizer must actually terminate the child. Without this
  // test a regression in the kill path (e.g. a future refactor that forgets
  // to wire the finalizer) would leak processes on every test run.
  cliIt.live(
    "kills the subprocess on scope close",
    ({ opencode }) =>
      Effect.gen(function* () {
        // Inner scope so we can observe `.exited` resolving after it closes.
        const exitedPromise = yield* Effect.scoped(
          Effect.gen(function* () {
            const server = yield* opencode.serve()
            // Capture the Promise, not the resolved value — scope closes after
            // this gen returns, at which point the finalizer kills the child.
            return server.exited
          }),
        )
        // After scope close: finalizer fired, process must have exited.
        const code = yield* Effect.promise(() => exitedPromise)
        // Bun reports the exit code; SIGTERM-killed processes return non-null
        // (typically 143 on POSIX). We just require resolution within a sane
        // window — anything else means the kill didn't take.
        expect(typeof code === "number" || code === null).toBe(true)
      }),
    60_000,
  )

  cliIt.live(
    "passes the shared V2 lifecycle contract over the real server process",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        yield* Effect.promise(() =>
          runV2LifecycleContract(
            createGeneratedLifecycleClient({ baseUrl: server.url, directory: home }),
            home,
            "serve-process",
          ),
        )
      }),
    60_000,
  )

  cliIt.live(
    "observes marketplace plugin registration through the request Location map",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const marketplace = "test-marketplace"
        const plugin = "runtime-probe"
        const pluginID = `${plugin}@${marketplace}`
        const cachePath = path.join(home, ".local", "share", "opencode", "claude-marketplaces", marketplace)
        const installPath = path.join(
          home,
          ".local",
          "share",
          "opencode",
          "claude-plugins",
          `${marketplace}__${plugin}`,
        )
        const stateFile = path.join(home, ".local", "state", "opencode", "claude-marketplaces.json")

        yield* Effect.promise(async () => {
          await Promise.all([
            mkdir(path.join(cachePath, ".claude-plugin"), { recursive: true }),
            mkdir(path.join(installPath, "skills", "runtime-probe"), { recursive: true }),
            mkdir(path.dirname(stateFile), { recursive: true }),
          ])
          await Promise.all([
            Bun.write(
              path.join(cachePath, ".claude-plugin", "marketplace.json"),
              JSON.stringify({ name: marketplace, plugins: [{ name: plugin, source: "./runtime-probe" }] }),
            ),
            Bun.write(
              path.join(installPath, "package.json"),
              JSON.stringify({ name: plugin, type: "module", main: "server.js" }),
            ),
            Bun.write(path.join(installPath, "server.js"), "export default async () => ({})\n"),
            Bun.write(
              path.join(installPath, "skills", "runtime-probe", "SKILL.md"),
              "---\nname: runtime-probe\ndescription: Runtime map probe\n---\nProbe.",
            ),
            Bun.write(
              stateFile,
              JSON.stringify({
                version: 1,
                marketplaces: {
                  [marketplace]: {
                    name: marketplace,
                    source: cachePath,
                    cachePath,
                    lastUpdated: "2026-08-20T00:00:00.000Z",
                  },
                },
                plugins: {
                  [pluginID]: {
                    id: pluginID,
                    name: plugin,
                    marketplace,
                    installPath,
                    installed: true,
                    enabled: true,
                    mcp: {},
                  },
                },
              }),
            ),
          ])
        })

        const server = yield* opencode.serve({
          env: { OPENCODE_PURE: "0", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1" },
        })
        const url = new URL("/api/plugins/runtime", server.url)
        url.searchParams.set("location[directory]", home)
        const response = yield* Effect.promise(() => fetch(url))
        const body = (yield* Effect.promise(() => response.json())) as {
          data: { plugins: Array<{ id: string; state: string; capabilities: Array<{ name: string; state: string }> }> }
        }
        const observed = body.data.plugins.find((item) => item.id === pluginID)

        expect(response.status).toBe(200)
        expect(observed).toEqual({
          id: pluginID,
          state: "ready",
          capabilities: [
            { name: "skills", state: "ready" },
            { name: "plugin", state: "ready" },
          ],
        })
      }),
    60_000,
  )

  cliIt.live(
    "forwards key method prompt inputs through the HTTP contract",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const plugin = path.join(home, "prompt-key-plugin.ts")
        const marker = path.join(home, "prompt-key-inputs.json")
        yield* Effect.promise(() =>
          Bun.write(
            plugin,
            [
              "export default async () => ({",
              "  auth: {",
              '    provider: "prompt-key",',
              "    methods: [{",
              '      type: "api",',
              '      label: "Prompt key",',
              "      prompts: [{",
              '        type: "text",',
              '        key: "tenant",',
              '        message: "Tenant",',
              "      }],",
              "      async authorize(inputs) {",
              `        await Bun.write(${JSON.stringify(marker)}, JSON.stringify(inputs))`,
              '        return { type: "success", key: "accepted" }',
              "      },",
              "    }],",
              "  },",
              "})",
              "",
            ].join("\n"),
          ),
        )
        const server = yield* opencode.serve({
          env: {
            OPENCODE_PURE: "0",
            OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
            OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pathToFileURL(plugin).href] }),
          },
        })
        const url = new URL("/api/integration/prompt-key/connect/key", server.url)
        url.searchParams.set("location[directory]", home)
        const response = yield* Effect.promise(() =>
          fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: "secret", inputs: { tenant: "acme" } }),
          }),
        )

        expect(response.status).toBe(204)
        expect(yield* Effect.promise(() => Bun.file(marker).json())).toEqual({ tenant: "acme" })
      }),
    60_000,
  )

  cliIt.live(
    "restores durable V2 session state after a server process restart",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const env = { OPENCODE_DB: "opencode-restart.db" }
        const first = yield* opencode.serve({ env })
        const firstClient = createGeneratedLifecycleClient({ baseUrl: first.url, directory: home })
        const sessionID = `ses_restart_${crypto.randomUUID().replaceAll("-", "")}`
        const queuedID = `msg_restart_queued_${crypto.randomUUID().replaceAll("-", "")}`

        yield* Effect.promise(async () => {
          const created = await firstClient.create({ id: sessionID, directory: home })
          const queued = await firstClient.prompt({
            sessionID,
            id: queuedID,
            text: "persist this queued prompt across restart",
            delivery: "queue",
          })
          expect(created.id).toBe(sessionID)
          expect(queued.id).toBe(queuedID)
          expect((await firstClient.get(sessionID)).id).toBe(sessionID)
        })

        first.kill()
        yield* Effect.promise(() => first.exited)

        const second = yield* opencode.serve({ env })
        const restoredClient = createGeneratedLifecycleClient({ baseUrl: second.url, directory: home })
        yield* Effect.promise(async () => {
          const restored = await restoredClient.get(sessionID)
          const pending = await restoredClient.inputList(sessionID)
          const history = await restoredClient.history(sessionID)
          expect(restored.id).toBe(sessionID)
          expect(pending.map((input) => input.id)).toEqual([queuedID])
          expect(history.data.some((event) => event.type === "session.next.prompt.admitted")).toBe(true)

          await restoredClient.inputCancel({ sessionID, inputID: queuedID })
          const afterCancel = await restoredClient.inputList(sessionID)
          expect(afterCancel).toEqual([])
          await restoredClient.interrupt(sessionID)
        })
      }),
    60_000,
  )
})

describe.skipIf(!previousReleaseDatabase)("previous-release session restore", () => {
  cliIt.live(
    "restores a stored session from the previous release database",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        if (!previousReleaseDatabase) return
        const database = path.join(home, "previous-release.db")
        yield* Effect.promise(() => copySqliteBundle(previousReleaseDatabase, database))

        const server = yield* opencode.serve({ env: { OPENCODE_DB: database } })
        const sdk = createOpencodeClient({ baseUrl: server.url })
        const listed = yield* Effect.promise(() => sdk.v2.session.list({ order: "desc", limit: 100 }))
        expect(listed.error).toBeUndefined()
        const session = listed.data?.data[0]
        expect(session?.id).toBeDefined()

        const client = createGeneratedLifecycleClient({ baseUrl: server.url, directory: home })
        const restored = yield* Effect.promise(() => client.get(session!.id))
        const history = yield* Effect.promise(() => client.history(session!.id))
        const inputs = yield* Effect.promise(() => client.inputList(session!.id))

        expect(restored.id).toBe(session!.id)
        expect(history.data).toBeInstanceOf(Array)
        expect(inputs).toBeInstanceOf(Array)
        yield* Effect.promise(() => client.interrupt(session!.id))
      }),
    60_000,
  )
})

async function copySqliteBundle(source: string, target: string) {
  await Promise.all(
    ["", "-wal", "-shm"].map(async (suffix) => {
      const sourcePath = `${source}${suffix}`
      if (!(await Bun.file(sourcePath).exists())) return
      await copyFile(sourcePath, `${target}${suffix}`)
    }),
  )
}
