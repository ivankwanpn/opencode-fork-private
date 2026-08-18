/**
 * Regression test for the same bug class as #26574 (sibling of #26566 and
 * #26553). The Desktop app calls GET /session/<id>/diff; before #26574
 * the response was Schema-encoded against `Snapshot.FileDiff` with
 * `patch: Schema.String` (required), so any session whose stored
 * `summary_diffs` had a row without `patch` returned HTTP 400 and the
 * session never loaded. Legacy session-level diffs are no longer surfaced,
 * but the endpoint remains compatible and must still return successfully.
 *
 * This test inserts a session row with a missing-patch diff entry and
 * asserts that GET /session/<id>/diff returns 200 with empty data.
 */
import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { DateTime, Effect, Layer } from "effect"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { LocationServiceMap, locationServiceMapV2Layer } from "@opencode-ai/core/location-services"
import { Storage } from "@/storage/storage"
import { MessageID } from "@/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { RelativePath } from "@opencode-ai/core/schema"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import { TestSessionV2, type Input as TestSessionInput } from "../fixture/session-v2"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([SessionV2.node, Storage.node, Database.node]), [
      [LocationServiceMap.node, locationServiceMapV2Layer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ]),
    httpApiLayer,
  ),
)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

const withSession = (input?: TestSessionInput) =>
  Effect.acquireRelease(
    TestSessionV2.create(input),
    (created) => SessionV2.Service.use((session) => session.remove(created.id).pipe(Effect.ignore)),
  )

describe("session diff with missing patch (#26574)", () => {
  it.instance(
    "GET /session/<id>/diff ignores legacy session-level diff storage",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "missing-patch" })

        // Mimic legacy/imported on-disk shape: a diff entry with no
        // `patch` text. Pre-fix the typed response encoder rejects
        // this and returns 400.
        yield* Storage.Service.use((storage) =>
          storage.write(["session_diff", session.id], [{ file: "legacy.txt", additions: 1, deletions: 0 }]),
        )

        const response = yield* requestInDirectory(
          pathFor(SessionPaths.diff, { sessionID: session.id }),
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "GET /session/<id>/diff returns requested canonical turn diffs",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* withSession({ title: "turn-diff" })
        const messageID = MessageID.ascending()
        const assistantID = MessageID.ascending()
        const model = { providerID: ProviderV2.ID.make("test"), id: ModelV2.ID.make("model") }
        const user = SessionMessage.User.make({
          id: SessionMessage.ID.make(messageID),
          type: "user",
          text: "change the file",
          time: { created: DateTime.makeUnsafe(1) },
        })
        const assistant = SessionMessage.Assistant.make({
          id: SessionMessage.ID.make(assistantID),
          type: "assistant",
          agent: "build",
          model,
          content: [],
          snapshot: {
            patch: [
              {
                path: RelativePath.make('"turn.ts"'),
                additions: 1,
                deletions: 0,
                status: "modified",
                patch: "@@ -0,0 +1 @@\n+change",
              },
            ],
          },
          time: { created: DateTime.makeUnsafe(2), completed: DateTime.makeUnsafe(3) },
        })
        yield* Database.Service.use(({ db }) =>
          db
            .insert(SessionMessageTable)
            .values([
              {
                id: user.id,
                session_id: session.id,
                type: user.type,
                seq: 1,
                time_created: 1,
                data: { text: user.text, time: { created: 1 } } as NonNullable<
                  (typeof SessionMessageTable.$inferInsert)["data"]
                >,
              },
              {
                id: assistant.id,
                session_id: session.id,
                type: assistant.type,
                seq: 2,
                time_created: 2,
                data: {
                  agent: assistant.agent,
                  model: assistant.model,
                  content: assistant.content,
                  snapshot: assistant.snapshot,
                  time: { created: 2, completed: 3 },
                } as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
              },
            ])
            .run()
            .pipe(Effect.orDie),
        )

        const response = yield* requestInDirectory(
          `${pathFor(SessionPaths.diff, { sessionID: session.id })}?messageID=${messageID}`,
          test.directory,
        )

        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual([
          {
            file: "turn.ts",
            additions: 1,
            deletions: 0,
            status: "modified",
            patch: "@@ -0,0 +1 @@\n+change",
          },
        ])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
