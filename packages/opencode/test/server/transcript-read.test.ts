import { expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionRead } from "@opencode-ai/server/session-read"
import { DateTime, Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { TranscriptRead } from "../../src/session/transcript-read"
import { testEffect } from "../lib/effect"

const sessionID = SessionSchema.ID.make("ses_transcript_read")
const overlapID = SessionMessage.ID.make("msg_overlap")
const nativeID = SessionMessage.ID.make("msg_native")
const legacyID = "old-message"
const normalizedLegacyID = SessionMessage.ID.make(`msg_legacy_${Buffer.from(legacyID).toString("base64url")}`)

const legacyOnly = {
  info: {
    id: legacyID,
    sessionID,
    role: "user",
    agent: "build",
    model: { providerID: "provider", modelID: "model" },
    time: { created: 1 },
  },
  parts: [
    { id: "prt_legacy_text", sessionID, messageID: legacyID, type: "text", text: "legacy" },
    { id: "prt_legacy_snapshot", sessionID, messageID: legacyID, type: "snapshot", snapshot: "sha" },
  ],
} as unknown as SessionV1.WithParts

const legacyOverlap = {
  info: {
    id: overlapID,
    sessionID,
    role: "user",
    agent: "build",
    model: { providerID: "provider", modelID: "model" },
    time: { created: 2 },
  },
  parts: [{ id: "prt_overlap", sessionID, messageID: overlapID, type: "text", text: "legacy overlap" }],
} as unknown as SessionV1.WithParts

function assistant(id: SessionMessage.ID, created: number, text: string) {
  return SessionMessage.Assistant.make({
    id,
    type: "assistant",
    agent: "build",
    model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
    time: { created: DateTime.makeUnsafe(created) },
    content: [{ id: `content_${id}`, type: "text", text }],
  })
}

const canonicalOverlap = assistant(overlapID, 3, "canonical overlap")
const canonicalOnly = assistant(nativeID, 4, "canonical")
const canonical = [canonicalOverlap, canonicalOnly]
const removed = new Set<SessionMessage.ID>()

const legacyLayer = Layer.mock(Session.Service, {
  messages: () => Effect.succeed([legacyOnly, legacyOverlap]),
})

const canonicalLayer = Layer.mock(SessionV2.Service, {
  get: () =>
    Effect.succeed({
      id: sessionID,
      projectID: ProjectV2.ID.make("proj_test"),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      title: "transcript",
      location: { directory: AbsolutePath.make("/tmp/transcript") },
    }),
  messages: () => Effect.succeed(canonical),
  message: ({ messageID }) => Effect.succeed(canonical.find((message) => message.id === messageID)),
  transcript: {
    removedMessages: () => Effect.succeed(removed),
    importMessage: () => Effect.die("unexpected SessionV2.transcript.importMessage"),
    removeMessage: () => Effect.die("unexpected SessionV2.transcript.removeMessage"),
    updateUserText: () => Effect.die("unexpected SessionV2.transcript.updateUserText"),
    removeUserText: () => Effect.die("unexpected SessionV2.transcript.removeUserText"),
    updateContent: () => Effect.die("unexpected SessionV2.transcript.updateContent"),
    removeContent: () => Effect.die("unexpected SessionV2.transcript.removeContent"),
  },
  revert: {
    stage: () => Effect.die("unexpected SessionV2.revert.stage"),
    clear: () => Effect.die("unexpected SessionV2.revert.clear"),
    commit: () => Effect.die("unexpected SessionV2.revert.commit"),
  },
})

const layer = TranscriptRead.layer.pipe(Layer.provide(Layer.merge(legacyLayer, canonicalLayer)))
const it = testEffect(layer)

it.effect("merges retained and canonical messages with canonical precedence and stable ordering", () =>
  Effect.gen(function* () {
    const read = yield* SessionRead.Service
    const asc = yield* read.messages({ sessionID, order: "asc" })
    const desc = yield* read.messages({ sessionID, order: "desc" })

    expect(asc.map((message) => message.id)).toEqual([normalizedLegacyID, overlapID, nativeID])
    expect(desc.map((message) => message.id)).toEqual([nativeID, overlapID, normalizedLegacyID])
    expect(asc.filter((message) => message.id === overlapID)).toEqual([canonicalOverlap])

    const retained = asc[0]!
    expect(retained.metadata?.legacy).toEqual(legacyOnly)
    expect(retained.type).toBe("user")
    if (retained.type === "user") expect(retained.text).toBe("legacy")
  }),
)

it.effect("paginates both cursor directions and returns an empty page for a stale cursor", () =>
  Effect.gen(function* () {
    const read = yield* SessionRead.Service

    expect(
      (yield* read.messages({
        sessionID,
        order: "desc",
        limit: 1,
        cursor: { id: nativeID, direction: "next" },
      })).map((message) => message.id),
    ).toEqual([overlapID])
    expect(
      (yield* read.messages({
        sessionID,
        order: "desc",
        limit: 1,
        cursor: { id: normalizedLegacyID, direction: "previous" },
      })).map((message) => message.id),
    ).toEqual([overlapID])
    expect(
      (yield* read.messages({
        sessionID,
        order: "asc",
        limit: 1,
        cursor: { id: normalizedLegacyID, direction: "next" },
      })).map((message) => message.id),
    ).toEqual([overlapID])
    expect(
      (yield* read.messages({
        sessionID,
        order: "asc",
        limit: 1,
        cursor: { id: nativeID, direction: "previous" },
      })).map((message) => message.id),
    ).toEqual([overlapID])
    expect(
      yield* read.messages({
        sessionID,
        order: "asc",
        cursor: { id: SessionMessage.ID.make("msg_stale"), direction: "next" },
      }),
    ).toEqual([])
  }),
)

it.effect("reads canonical and normalized retained messages by ID", () =>
  Effect.gen(function* () {
    const read = yield* SessionRead.Service
    expect(yield* read.message({ sessionID, messageID: overlapID })).toEqual(canonicalOverlap)
    expect(yield* read.message({ sessionID, messageID: normalizedLegacyID })).toMatchObject({
      id: normalizedLegacyID,
      metadata: { legacy: legacyOnly },
    })
  }),
)

it.effect("does not revive retained messages hidden by canonical tombstones", () =>
  Effect.gen(function* () {
    removed.add(normalizedLegacyID)
    const read = yield* SessionRead.Service
    expect((yield* read.messages({ sessionID, order: "asc" })).map((message) => message.id)).not.toContain(
      normalizedLegacyID,
    )
    expect(yield* read.message({ sessionID, messageID: normalizedLegacyID })).toBeUndefined()
    removed.delete(normalizedLegacyID)
  }),
)
