import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { DateTime, Effect, Option } from "effect"
import { Session } from "@/session/session"
import { MessageID, type SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage/storage"
import { locationServiceMapLayer } from "../lib/location-service-map"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
    ]),
    [
      [LocationServiceMap.node, locationServiceMapLayer],
      [SessionExecution.node, SessionExecution.noopLayer],
    ],
  ),
)

const model = {
  providerID: ProviderV2.ID.make("test"),
  id: ModelV2.ID.make("test-model"),
  variant: ModelV2.VariantID.make("xhigh"),
}

const withSession = <A, E, R>(
  run: (input: {
    session: Session.Interface
    canonical: SessionV2.Interface
    sessionID: SessionID
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const session = yield* Session.Service
      const canonical = yield* SessionV2.Service
      const created = yield* session.create({ title: "Canonical transcript", metadata: { source: "test" } })
      return { session, canonical, sessionID: created.id }
    }),
    run,
    (input) => input.session.remove(input.sessionID).pipe(Effect.ignore),
  )

const importUser = Effect.fn("Test.importUser")(function* (
  canonical: SessionV2.Interface,
  sessionID: SessionID,
  text: string,
  created: number,
) {
  const message = SessionMessage.User.make({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: DateTime.makeUnsafe(created) },
  })
  yield* canonical.transcript.importMessage({ sessionID: SessionV2.ID.make(sessionID), message })
  return message
})

describe("Session canonical transcript compatibility", () => {
  it.instance("projects canonical messages in chronological order and applies the legacy limit", () =>
    withSession(({ session, canonical, sessionID }) =>
      Effect.gen(function* () {
        const first = yield* importUser(canonical, sessionID, "first", 1)
        const second = yield* importUser(canonical, sessionID, "second", 2)
        const third = yield* importUser(canonical, sessionID, "third", 3)

        expect((yield* session.messages({ sessionID })).map((message) => message.info.id)).toEqual([
          MessageID.ascending(first.id),
          MessageID.ascending(second.id),
          MessageID.ascending(third.id),
        ])
        expect((yield* session.messages({ sessionID, limit: 2 })).map((message) => message.info.id)).toEqual([
          MessageID.ascending(second.id),
          MessageID.ascending(third.id),
        ])
      }),
    ),
  )

  it.instance("finds the newest projected canonical message", () =>
    withSession(({ session, canonical, sessionID }) =>
      Effect.gen(function* () {
        yield* importUser(canonical, sessionID, "skip", 1)
        const firstMatch = yield* importUser(canonical, sessionID, "match one", 2)
        const newestMatch = yield* importUser(canonical, sessionID, "match two", 3)

        const found = yield* session.findMessage(sessionID, (message) =>
          message.parts.some((part) => part.type === "text" && part.text.startsWith("match")),
        )
        expect(Option.getOrUndefined(found)?.info.id).toBe(MessageID.ascending(newestMatch.id))
        expect(Option.getOrUndefined(found)?.info.id).not.toBe(MessageID.ascending(firstMatch.id))
      }),
    ),
  )

  it.instance("forks canonical messages before the requested boundary and copies metadata", () =>
    withSession(({ session, canonical, sessionID }) =>
      Effect.gen(function* () {
        const first = yield* importUser(canonical, sessionID, "first", 1)
        const boundary = yield* importUser(canonical, sessionID, "boundary", 2)
        yield* importUser(canonical, sessionID, "after", 3)

        const forked = yield* Effect.acquireRelease(
          session.fork({ sessionID, messageID: MessageID.ascending(boundary.id) }),
          (info) => session.remove(info.id).pipe(Effect.ignore),
        )
        const messages = yield* canonical.messages({ sessionID: SessionV2.ID.make(forked.id), order: "asc" })

        expect(messages).toHaveLength(1)
        expect(messages[0]).toMatchObject({ type: "user", text: "first" })
        expect(messages[0]?.id).not.toBe(first.id)
        expect(forked.metadata).toEqual({ source: "test" })
      }),
    ),
  )

  it.instance("preserves the legacy not-found contract", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const missing = "ses_missing" as SessionID
      const error = yield* Effect.flip(session.messages({ sessionID: missing }))
      expect(error).toBeInstanceOf(NotFoundError)
      expect(error.message).toBe(`Session not found: ${missing}`)
    }),
  )
})
