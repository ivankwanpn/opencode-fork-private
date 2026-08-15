import { SessionRemovalCapability } from "@opencode-ai/server/session-removal"
import { SessionV2 } from "@opencode-ai/core/session"
import { Effect, Layer } from "effect"
import { WorkspaceRef } from "@/effect/instance-ref"
import { InstanceStore } from "@/project/instance-store"
import { SessionRemoval } from "./removal"

export const layer = Layer.effect(
  SessionRemovalCapability.Service,
  Effect.gen(function* () {
    const instances = yield* InstanceStore.Service
    const removal = yield* SessionRemoval.Service
    const session = yield* SessionV2.Service
    return SessionRemovalCapability.Service.of({
      remove: (sessionID) =>
        session.get(sessionID).pipe(
          Effect.flatMap((info) =>
            instances
              .provide(
                { directory: info.location.directory },
                removal.remove(sessionID).pipe(Effect.provideService(WorkspaceRef, info.location.workspaceID)),
              )
              .pipe(
                Effect.catchCause((cause) =>
                  session.get(sessionID).pipe(
                    Effect.flatMap(() =>
                      Effect.logWarning("session instance cleanup unavailable; continuing durable removal", {
                        sessionID,
                        directory: info.location.directory,
                        cause,
                      }).pipe(Effect.andThen(removal.removeDurable(sessionID))),
                    ),
                    // The instance-backed path can fail after durable deletion
                    // has already committed. In that case there is no work left.
                    Effect.catchTag("Session.NotFoundError", () => Effect.void),
                  ),
                ),
              ),
          ),
        ),
    })
  }),
)

export * as NativeSessionRemoval from "./native-session-removal"
