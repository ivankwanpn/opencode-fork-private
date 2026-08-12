import { describe, expect } from "bun:test"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Effect, Layer } from "effect"
import path from "node:path"
import { SessionArchive } from "../../src/cli/cmd/session-archive"
import { cliIt } from "../lib/cli-process"
import { locationServiceMapLayer } from "../lib/location-service-map"
import { testEffect } from "../lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionV2.node]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      [LocationServiceMap.node, locationServiceMapLayer],
    ],
  ),
)

describe("V2 session export", () => {
  it.effect("exports a versioned canonical envelope", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({
        title: "Canonical archive",
        location: Location.Ref.make({ directory: AbsolutePath.make("/archive/source") }),
      })
      const user = SessionMessage.User.make({
        id: SessionMessage.ID.make(`msg_export_user_${crypto.randomUUID().replaceAll("-", "")}`),
        type: "user",
        text: "export this canonical prompt",
        time: { created: DateTime.makeUnsafe(1) },
      })
      const assistant = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make(`msg_export_assistant_${crypto.randomUUID().replaceAll("-", "")}`),
        type: "assistant",
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("model") },
        content: [{ type: "text", id: "text_export", text: "canonical answer" }],
        finish: "stop",
        time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
      })
      yield* sessions.transcript.importMessage({ sessionID: session.id, message: user })
      yield* sessions.transcript.importMessage({ sessionID: session.id, message: assistant })

      const encoded = SessionArchive.encode(yield* SessionArchive.read(session.id))
      const json = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>

      expect(json.version).toBe(2)
      expect(json).toHaveProperty("session")
      expect(json).not.toHaveProperty("info")
      expect(json.messages).toEqual([
        expect.objectContaining({ id: user.id, type: "user", text: user.text, time: { created: 1 } }),
        expect.objectContaining({ id: assistant.id, type: "assistant", content: assistant.content }),
      ])
      expect((yield* SessionArchive.decode(json)).messages.map((message) => message.id)).toEqual([
        user.id,
        assistant.id,
      ])
    }),
  )

  cliIt.live(
    "round-trips a canonical archive through the CLI and rejects versionless input",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const sourceEnv = { OPENCODE_DB: "archive-source.db" }
        const targetEnv = { OPENCODE_DB: "archive-target.db" }
        yield* llm.text("canonical archive answer")
        const run = yield* opencode.run("canonical archive prompt", { format: "json", env: sourceEnv })
        opencode.expectExit(run, 0, "create source session")
        const sessionID = opencode.parseJsonEvents(run.stdout)[0]?.sessionID
        expect(typeof sessionID).toBe("string")

        const exported = yield* opencode.spawn(["export", String(sessionID)], { env: sourceEnv })
        opencode.expectExit(exported, 0, "export source session")
        const archive = JSON.parse(exported.stdout) as Record<string, unknown>
        expect(archive.version).toBe(2)
        expect(archive).toHaveProperty("session")
        expect(archive).not.toHaveProperty("info")

        const sanitized = yield* opencode.spawn(["export", String(sessionID), "--sanitize"], { env: sourceEnv })
        opencode.expectExit(sanitized, 0, "sanitize source session")
        const sanitizedArchive = yield* SessionArchive.decode(JSON.parse(sanitized.stdout))
        expect(sanitizedArchive.session.title).toContain("[redacted:session-title:")
        expect(
          sanitizedArchive.messages.some(
            (message) => message.type === "user" && message.text.includes("[redacted:text:"),
          ),
        ).toBeTrue()

        const archiveFile = path.join(home, "canonical-archive.json")
        yield* Effect.promise(() => Bun.write(archiveFile, JSON.stringify(archive)))
        const imported = yield* opencode.spawn(["import", archiveFile], { env: targetEnv })
        opencode.expectExit(imported, 0, "import canonical archive")
        expect(imported.stdout).toContain(`Imported session: ${sessionID}`)

        const target = yield* opencode.spawn(["export", String(sessionID)], { env: targetEnv })
        opencode.expectExit(target, 0, "export imported session")
        const targetArchive = JSON.parse(target.stdout) as {
          session: { location: { directory: string } }
          messages: Array<{ id: string }>
        }
        expect(targetArchive.session.location.directory).toBe(home)
        expect(targetArchive.messages.map((message) => message.id)).toEqual(
          (archive.messages as Array<{ id: string }>).map((message) => message.id),
        )

        const versionlessFile = path.join(home, "versionless-archive.json")
        const { version: _, ...versionless } = archive
        yield* Effect.promise(() => Bun.write(versionlessFile, JSON.stringify(versionless)))
        const rejected = yield* opencode.spawn(["import", versionlessFile], {
          env: { OPENCODE_DB: "archive-rejected.db" },
        })
        expect(rejected.exitCode).not.toBe(0)
      }),
    120_000,
  )
})
