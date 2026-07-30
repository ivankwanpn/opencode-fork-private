import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import { SessionV2 } from "@opencode-ai/core/session"
import type { Session } from "@/session/session"
import { Effect, Schema } from "effect"
import * as ApiError from "../errors"

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, StorageNotFoundError, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.message)))
}

export function mapSessionNotFound<A, E, R>(
  self: Effect.Effect<A, E | SessionV2.NotFoundError, R>,
) {
  return self.pipe(
    Effect.catchIf(Schema.is(SessionV2.NotFoundError), (error) =>
      Effect.fail(ApiError.notFound(`Session not found: ${error.sessionID}`)),
    ),
  )
}

export function mapBusy<A, R>(self: Effect.Effect<A, Session.BusyError, R>) {
  return self.pipe(
    Effect.catchTag("SessionBusyError", (error) =>
      Effect.fail(
        new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        }),
      ),
    ),
  )
}

export function mapExecutionBusy<A, E, R>(
  self: Effect.Effect<A, E | SessionV2.BusyError, R>,
) {
  return self.pipe(
    Effect.catchIf(Schema.is(SessionV2.BusyError), (error) =>
      Effect.fail(
        new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        }),
      ),
    ),
  )
}
