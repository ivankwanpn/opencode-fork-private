import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
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
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Effect, Exit, Layer } from "effect"
import { SessionArchive } from "../../src/cli/cmd/session-archive"
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

describe("V2 session import", () => {
  it.effect("imports canonical messages in order without changing their IDs", () =>
    Effect.gen(function* () {
      const sessionID = SessionSchema.ID.make(`ses_import_${crypto.randomUUID().replaceAll("-", "")}`)
      const first = SessionMessage.User.make({
        id: SessionMessage.ID.make(`msg_import_user_${crypto.randomUUID().replaceAll("-", "")}`),
        type: "user",
        text: "first",
        time: { created: DateTime.makeUnsafe(1) },
      })
      const second = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make(`msg_import_assistant_${crypto.randomUUID().replaceAll("-", "")}`),
        type: "assistant",
        agent: "build",
        model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("model") },
        content: [{ type: "text", id: "text_import", text: "second" }],
        time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
      })
      const source = SessionArchive.Envelope.make({
        version: 2,
        session: {
          id: sessionID,
          parentID: SessionSchema.ID.make("ses_import_parent"),
          projectID: ProjectV2.ID.make("source-project"),
          agent: AgentV2.ID.make("build"),
          model: {
            providerID: ProviderV2.ID.make("test"),
            id: ModelV2.ID.make("model"),
            variant: ModelV2.VariantID.make("default"),
          },
          cost: 12.5,
          tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 3, write: 4 } },
          time: {
            created: DateTime.makeUnsafe(10),
            updated: DateTime.makeUnsafe(20),
            compacting: DateTime.makeUnsafe(30),
            archived: DateTime.makeUnsafe(40),
          },
          title: "Imported canonical archive",
          share: { url: "https://example.test/share/import" },
          location: Location.Ref.make({ directory: AbsolutePath.make("/archive/source") }),
          subpath: RelativePath.make("source/subpath"),
          revert: { messageID: first.id, partID: "text_import", removedMessageIDs: [second.id] },
        },
        messages: [first, second],
      })
      const target = Location.Ref.make({ directory: AbsolutePath.make("/archive/target") })

      const imported = yield* SessionArchive.write(source, target)
      const stored = yield* (yield* SessionV2.Service).messages({ sessionID: imported.id, order: "asc" })

      expect(imported).toMatchObject({
        ...source.session,
        projectID: ProjectV2.ID.global,
        location: target,
        subpath: undefined,
      })
      expect(imported.subpath).toBeUndefined()
      expect(stored).toEqual([first, second])
    }),
  )

  it.effect("rejects a conflicting retry of an imported message ID", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({
        location: Location.Ref.make({ directory: AbsolutePath.make("/archive/conflict") }),
      })
      const message = SessionMessage.User.make({
        id: SessionMessage.ID.make(`msg_import_conflict_${crypto.randomUUID().replaceAll("-", "")}`),
        type: "user",
        text: "original",
        time: { created: DateTime.makeUnsafe(1) },
      })
      yield* sessions.transcript.importMessage({ sessionID: session.id, message })

      const conflict = yield* sessions.transcript
        .importMessage({ sessionID: session.id, message: { ...message, text: "replacement" } })
        .pipe(Effect.exit)

      expect(Exit.isFailure(conflict)).toBeTrue()
      expect(yield* sessions.message({ sessionID: session.id, messageID: message.id })).toEqual(message)
    }),
  )

  it.effect("rejects a conflicting retry of an imported session ID", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const session = yield* sessions.create({
        title: "original",
        location: Location.Ref.make({ directory: AbsolutePath.make("/archive/session-conflict") }),
      })
      const archive = SessionArchive.Envelope.make({ version: 2, session: { ...session, title: "replacement" }, messages: [] })

      const conflict = yield* SessionArchive.write(archive, session.location).pipe(Effect.exit)

      expect(Exit.isFailure(conflict)).toBeTrue()
      expect(yield* sessions.get(session.id)).toEqual(session)
    }),
  )

  it.effect("accepts an exact retry after canonical session defaults are projected", () =>
    Effect.gen(function* () {
      const session = SessionArchive.Envelope.make({
        version: 2,
        session: {
          id: SessionSchema.ID.make(`ses_import_retry_${crypto.randomUUID().replaceAll("-", "")}`),
          projectID: ProjectV2.ID.global,
          model: { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("model") },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: DateTime.makeUnsafe(1), updated: DateTime.makeUnsafe(1) },
          title: "retry",
          location: Location.Ref.make({ directory: AbsolutePath.make("/archive/source") }),
        },
        messages: [],
      })
      const target = Location.Ref.make({ directory: AbsolutePath.make("/archive/retry") })

      const first = yield* SessionArchive.write(session, target)
      const retried = yield* SessionArchive.write(session, target)

      expect(retried).toEqual(first)
    }),
  )

  it.effect("rejects versionless V1 exports and flat share payloads", () =>
    Effect.gen(function* () {
      const versionless = yield* SessionArchive.decode({ info: { id: "ses_old" }, messages: [] }).pipe(Effect.exit)
      const flatShare = yield* SessionArchive.decode([
        { type: "session", data: { id: "ses_old" } },
        { type: "message", data: { id: "msg_old" } },
      ]).pipe(Effect.exit)

      expect(Exit.isFailure(versionless)).toBeTrue()
      expect(Exit.isFailure(flatShare)).toBeTrue()
    }),
  )
})
