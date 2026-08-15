import { expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionRemovalCapability } from "@opencode-ai/server/session-removal"
import { InstanceStore } from "@/project/instance-store"
import { NativeSessionRemoval } from "@/session/native-session-removal"
import { SessionRemoval } from "@/session/removal"
import { testEffect } from "../lib/effect"

const sessionID = SessionV2.ID.make("ses_native_removal_boot_failure")
const info = SessionEvent.SessionSnapshot.make({
  id: sessionID,
  projectID: ProjectV2.ID.global,
  slug: "native-removal",
  version: "test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  title: "native removal",
  location: { directory: AbsolutePath.make("/missing/project") },
})

const durable: SessionV2.ID[] = []
const layer = NativeSessionRemoval.layer.pipe(
  Layer.provide(
    Layer.mock(InstanceStore.Service, {
      provide: () => Effect.die("instance boot failed"),
    }),
  ),
  Layer.provide(
    Layer.mock(SessionRemoval.Service, {
      remove: () => Effect.die("instance-backed removal should not start"),
      removeDurable: (id) => Effect.sync(() => durable.push(id)),
    }),
  ),
  Layer.provide(
    Layer.mock(SessionV2.Service, {
      get: () => Effect.succeed(info),
      transcript: {
        importMessage: () => Effect.die("not implemented"),
        removeMessage: () => Effect.die("not implemented"),
        updateUserText: () => Effect.die("not implemented"),
        removeUserText: () => Effect.die("not implemented"),
        updateContent: () => Effect.die("not implemented"),
        removeContent: () => Effect.die("not implemented"),
      },
      revert: {
        stage: () => Effect.die("not implemented"),
        clear: () => Effect.die("not implemented"),
        commit: () => Effect.die("not implemented"),
      },
    }),
  ),
)
const it = testEffect(layer)

it.effect("continues durable Session deletion when the stored directory cannot boot", () =>
  Effect.gen(function* () {
    durable.length = 0

    yield* SessionRemovalCapability.Service.use((service) => service.remove(sessionID))

    expect(durable).toEqual([sessionID])
  }),
)
