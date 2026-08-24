import { describe, expect } from "bun:test"
import { Database as SqliteDatabase } from "bun:sqlite"
import { Effect } from "effect"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { cliIt } from "../../lib/cli-process"
import { testProviderConfig } from "../../lib/test-provider"
import { createGeneratedLifecycleClient } from "../../server/v2-lifecycle-contract"

describe("opencode Kernel restart (subprocess)", () => {
  cliIt.live(
    "reconciles an active Kernel execution after process loss without replaying provider work",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const adviceMarker = path.join(home, "kernel-recovery-advice.json")
        const plugin = path.join(home, "kernel-recovery-advice.ts")
        yield* Effect.promise(() =>
          Bun.write(
            plugin,
            [
              `import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))}`,
              "export default {",
              "  manifest: {",
              '    id: "kernel-recovery-advice",',
              '    version: "1.0.0",',
              '    targets: ["core"],',
              "    requires: [],",
              '    capabilities: ["hook"],',
              '    permissions: ["session.history.read"],',
              '    runtime: "trusted-in-process",',
              "  },",
              "  mount: () => Effect.succeed({",
              "    seams: [{",
              '      name: "recovery.advice",',
              `      handler: (event) => Effect.promise(() => Bun.write(${JSON.stringify(adviceMarker)}, JSON.stringify(event))).pipe(Effect.asVoid),`,
              "    }],",
              "  }),",
              "}",
              "",
            ].join("\n"),
          ),
        )
        const env = {
          OPENCODE_DB: "opencode-kernel-restart.db",
          OPENCODE_SESSION_ENGINE: "kernel",
          OPENCODE_PURE: "0",
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            ...testProviderConfig(llm.url),
            plugin: [pathToFileURL(plugin).href],
          }),
        }
        const first = yield* opencode.serve({ env })
        const client = createGeneratedLifecycleClient({ baseUrl: first.url, directory: home })
        const sessionID = `ses_kernel_restart_${crypto.randomUUID().replaceAll("-", "")}`
        const classicSessionID = `ses_classic_restart_${crypto.randomUUID().replaceAll("-", "")}`

        yield* llm.hang
        yield* Effect.promise(() =>
          client.create({
            id: classicSessionID,
            directory: home,
            engine: "classic",
            model: { providerID: "test", id: "test-model" },
          }),
        )
        const created = yield* Effect.promise(() =>
          client.create({
            id: sessionID,
            directory: home,
            engine: "kernel",
            model: { providerID: "test", id: "test-model" },
          }),
        )
        expect(created.engine).toBe("kernel")
        const prompt = client
          .prompt({
            sessionID,
            id: `msg_kernel_restart_${crypto.randomUUID().replaceAll("-", "")}`,
            text: "leave the provider turn active",
            resume: true,
          })
          .then(
            () => "completed" as const,
            () => "failed" as const,
          )
        expect(
          yield* Effect.promise(() => prompt).pipe(
            Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die("prompt admission timed out") }),
          ),
        ).toBe("completed")
        expect(yield* Effect.promise(() => client.active())).toHaveProperty(sessionID)
        yield* llm.wait(1).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die("provider request timed out") }),
        )
        first.crash()
        yield* Effect.promise(() => first.exited)

        const databasePath = path.join(home, ".local", "share", "opencode", env.OPENCODE_DB)
        const databaseBeforeRestart = new SqliteDatabase(databasePath)
        const executionBeforeRestart = databaseBeforeRestart
          .query("SELECT state, phase, recovery_reason, process_incarnation FROM session_execution WHERE session_id = ?")
          .get(sessionID) as {
          state: string
          phase: string | null
          recovery_reason: string | null
          process_incarnation: string | null
        }
        databaseBeforeRestart.close()

        const second = yield* opencode.serve({ env })
        const restored = createGeneratedLifecycleClient({ baseUrl: second.url, directory: home })
        expect(yield* Effect.promise(() => restored.active())).toEqual({})
        expect(yield* llm.calls).toBe(1)
        expect(yield* Effect.promise(() => Bun.file(adviceMarker).json())).toMatchObject({
          sessionID,
          plan: {
            sessionID,
            classification: "needs-user-decision",
            actions: [{ type: "mark-recovery-required", reason: "provider-dispatch-ambiguous" }],
          },
        })

        const database = new SqliteDatabase(databasePath)
        try {
          const execution = database
            .query(
              "SELECT state, phase, recovery_reason, lease_token, process_incarnation FROM session_execution WHERE session_id = ?",
            )
            .get(sessionID) as
            | {
                state: string
                phase: string | null
                recovery_reason: string | null
                lease_token: string | null
                process_incarnation: string | null
              }
            | null
          const classicExecution = database
            .query("SELECT session_id FROM session_execution WHERE session_id = ?")
            .get(classicSessionID)
          const events = database
            .query("SELECT type FROM event WHERE aggregate_id = ? ORDER BY seq ASC")
            .all(sessionID) as Array<{ type: string }>
          const types = events.map((event) => event.type)
          expect(executionBeforeRestart).toMatchObject({ state: "active", phase: "dispatching" })
          expect(execution).toMatchObject({ state: "needs_recovery", phase: null })
          expect(execution?.recovery_reason).toBe("provider-dispatch-ambiguous")
          expect(execution?.lease_token).toBeNull()
          expect(execution?.process_incarnation).toBe(executionBeforeRestart.process_incarnation)
          expect(classicExecution).toBeNull()
          expect(types.filter((type) => type === "session.next.provider.attempt.started.1")).toHaveLength(1)
          expect(types.filter((type) => type === "session.next.provider.attempt.response.started.1")).toHaveLength(0)
          expect(types.filter((type) => type === "session.next.provider.attempt.ended.1")).toHaveLength(0)
        } finally {
          database.close()
        }
      }),
    60_000,
  )

  cliIt.live(
    "reconciles process loss during compaction without replaying provider work",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const env = {
          OPENCODE_DB: "opencode-kernel-compaction-restart.db",
          OPENCODE_SESSION_ENGINE: "kernel",
          OPENCODE_PURE: "0",
          OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
          OPENCODE_CONFIG_CONTENT: JSON.stringify(testProviderConfig(llm.url)),
        }
        const first = yield* opencode.serve({ env })
        const client = createGeneratedLifecycleClient({ baseUrl: first.url, directory: home })
        const sessionID = `ses_kernel_compaction_restart_${crypto.randomUUID().replaceAll("-", "")}`
        const classicSessionID = `ses_classic_compaction_restart_${crypto.randomUUID().replaceAll("-", "")}`

        yield* llm.text("seed response")
        yield* Effect.promise(() =>
          client.create({
            id: classicSessionID,
            directory: home,
            engine: "classic",
            model: { providerID: "test", id: "test-model" },
          }),
        )
        yield* Effect.promise(() =>
          client.create({
            id: sessionID,
            directory: home,
            engine: "kernel",
            model: { providerID: "test", id: "test-model" },
          }),
        )
        yield* Effect.promise(() =>
          client.prompt({
            sessionID,
            id: `msg_kernel_compaction_seed_${crypto.randomUUID().replaceAll("-", "")}`,
            text: "seed history before compaction",
            resume: true,
          }),
        )
        yield* llm.wait(1).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die("seed provider request timed out") }),
        )
        yield* Effect.promise(async () => {
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            if (!(sessionID in (await client.active()))) return
            await Bun.sleep(25)
          }
          throw new Error("seed Kernel turn did not settle before compaction")
        })

        yield* llm.hang
        const compact = fetch(`${first.url}/api/session/${sessionID}/compact`, {
          method: "POST",
          headers: { "x-opencode-directory": home },
        }).then(
          () => "completed" as const,
          () => "failed" as const,
        )
        yield* llm.wait(2).pipe(
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die("compaction provider request timed out") }),
        )
        first.crash()
        yield* Effect.promise(() => first.exited)
        yield* Effect.promise(() => compact)

        const databasePath = path.join(home, ".local", "share", "opencode", env.OPENCODE_DB)
        const databaseBeforeRestart = new SqliteDatabase(databasePath)
        const executionBeforeRestart = databaseBeforeRestart
          .query("SELECT state, phase, process_incarnation FROM session_execution WHERE session_id = ?")
          .get(sessionID) as { state: string; phase: string | null; process_incarnation: string | null }
        databaseBeforeRestart.close()

        const second = yield* opencode.serve({ env })
        const restored = createGeneratedLifecycleClient({ baseUrl: second.url, directory: home })
        expect(yield* Effect.promise(() => restored.active())).toEqual({})
        expect(yield* llm.calls).toBe(2)

        const database = new SqliteDatabase(databasePath)
        try {
          const execution = database
            .query(
              "SELECT state, phase, recovery_reason, lease_token, process_incarnation FROM session_execution WHERE session_id = ?",
            )
            .get(sessionID) as
            | {
                state: string
                phase: string | null
                recovery_reason: string | null
                lease_token: string | null
                process_incarnation: string | null
              }
            | null
          const classicExecution = database
            .query("SELECT session_id FROM session_execution WHERE session_id = ?")
            .get(classicSessionID)
          const types = (
            database
              .query("SELECT type FROM event WHERE aggregate_id = ? ORDER BY seq ASC")
              .all(sessionID) as Array<{ type: string }>
          ).map((event) => event.type)

          expect(executionBeforeRestart).toMatchObject({ state: "active", phase: "compacting" })
          expect(execution).toMatchObject({ state: "needs_recovery", phase: null })
          expect(execution?.recovery_reason).toBe("compaction-partial")
          expect(execution?.lease_token).toBeNull()
          expect(execution?.process_incarnation).toBe(executionBeforeRestart.process_incarnation)
          expect(classicExecution).toBeNull()
          expect(types.filter((type) => type === "session.next.compaction.started.1")).toHaveLength(1)
          expect(types.filter((type) => type === "session.next.compaction.ended.1")).toHaveLength(0)
          expect(types.filter((type) => type === "session.next.compaction.failed.1")).toHaveLength(0)
        } finally {
          database.close()
        }
      }),
    60_000,
  )
})
