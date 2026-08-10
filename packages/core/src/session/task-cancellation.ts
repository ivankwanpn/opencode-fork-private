export * as TaskCancellation from "./task-cancellation"

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Cause, Clock, Context, Effect, Layer, Result, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { SessionSchema } from "./schema"
import {
  SessionAttemptTable,
  SessionCancellationTable,
  SessionInputTable,
  TaskNotificationOutboxTable,
  TaskSubmissionTable,
} from "./sql"
import { TaskNotification } from "./task-notification"
import { TaskSubmission } from "./task-submission"

export type CancelHooks = {
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly wait: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export type CancelResult = {
  readonly sessionIDs: SessionSchema.ID[]
  readonly submissionIDs: string[]
}

export class Missing extends Schema.TaggedErrorClass<Missing>()("TaskCancellation.Missing", {
  rootSessionID: SessionSchema.ID,
}) {}

export interface Interface {
  readonly cancelTree: (
    input: { rootSessionID: SessionSchema.ID } & CancelHooks,
  ) => Effect.Effect<CancelResult, Missing>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskCancellation") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const notifications = yield* TaskNotification.Service

    const cancelTree: Interface["cancelTree"] = Effect.fn("TaskCancellation.cancelTree")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const cancelled = yield* db
        .transaction(
          () =>
            Effect.gen(function* () {
              const rows = yield* db
                .all<{ id: string }>(
                  sql`
                  WITH RECURSIVE ownership(id) AS (
                    SELECT id FROM session WHERE id = ${input.rootSessionID}
                    UNION ALL
                    SELECT child.id
                    FROM session child
                    JOIN ownership parent ON child.parent_id = parent.id
                  )
                  SELECT id FROM ownership ORDER BY id
                `,
                )
                .pipe(Effect.orDie)
              if (rows.length === 0) return yield* new Missing({ rootSessionID: input.rootSessionID })

              yield* db
                .insert(SessionCancellationTable)
                .values({ root_session_id: input.rootSessionID, time_created: now })
                .onConflictDoNothing()
                .run()
                .pipe(Effect.orDie)

              const sessionIDs = rows.map((row) => SessionSchema.ID.make(row.id))
              const submissionIDs = new Array<string>()
              const submissions = yield* db
                .select()
                .from(TaskSubmissionTable)
                .where(
                  and(inArray(TaskSubmissionTable.child_session_id, sessionIDs), isNull(TaskSubmissionTable.outcome)),
                )
                .all()
                .pipe(Effect.orDie)
              for (const submission of submissions) {
                const updated = yield* db
                  .update(TaskSubmissionTable)
                  .set({
                    status: "cancelled",
                    outcome: "cancelled",
                    error: { message: "Task cancelled by ownership root" },
                    time_completed: now,
                  })
                  .where(and(eq(TaskSubmissionTable.id, submission.id), isNull(TaskSubmissionTable.outcome)))
                  .returning()
                  .get()
                  .pipe(Effect.orDie)
                if (!updated) continue
                submissionIDs.push(updated.id)

                const terminalSeq = yield* EventV2.latestSequence(db, updated.child_session_id)
                yield* db
                  .update(SessionInputTable)
                  .set({
                    terminal_outcome: "cancelled",
                    terminal_message_id: null,
                    terminal_error: { message: "Task cancelled by ownership root" },
                    terminal_time: now,
                    terminal_seq: terminalSeq,
                  })
                  .where(
                    and(eq(SessionInputTable.id, updated.child_input_id), isNull(SessionInputTable.terminal_outcome)),
                  )
                  .run()
                  .pipe(Effect.orDie)

                if (updated.completion_delivery !== "parent") continue

                yield* db
                  .insert(TaskNotificationOutboxTable)
                  .values({
                    id: Identifier.create("outbox", "ascending"),
                    submission_id: updated.id,
                    parent_session_id: updated.parent_session_id,
                    message_id: TaskSubmission.notificationID(updated.id),
                    payload: {
                      taskID: updated.child_session_id,
                      state: "cancelled",
                      description: updated.description,
                      text: "Task cancelled by ownership root",
                    },
                    status: "pending",
                    time_created: now,
                  })
                  .onConflictDoNothing()
                  .run()
                  .pipe(Effect.orDie)
              }

              const pendingInputs = yield* db
                .select({ id: SessionInputTable.id, sessionID: SessionInputTable.session_id })
                .from(SessionInputTable)
                .where(
                  and(inArray(SessionInputTable.session_id, sessionIDs), isNull(SessionInputTable.terminal_outcome)),
                )
                .all()
                .pipe(Effect.orDie)
              for (const pendingInput of pendingInputs) {
                const terminalSeq = yield* EventV2.latestSequence(db, pendingInput.sessionID)
                yield* db
                  .update(SessionInputTable)
                  .set({
                    terminal_outcome: "cancelled",
                    terminal_message_id: null,
                    terminal_error: { message: "Task cancelled by ownership root" },
                    terminal_time: now,
                    terminal_seq: terminalSeq,
                  })
                  .where(and(eq(SessionInputTable.id, pendingInput.id), isNull(SessionInputTable.terminal_outcome)))
                  .run()
                  .pipe(Effect.orDie)
              }

              yield* db
                .update(SessionAttemptTable)
                .set({
                  status: "abandoned",
                  retry_at: null,
                  error: null,
                  decision: "abandon",
                  time_updated: now,
                })
                .where(
                  and(
                    inArray(SessionAttemptTable.session_id, sessionIDs),
                    or(
                      eq(SessionAttemptTable.status, "started"),
                      eq(SessionAttemptTable.status, "responding"),
                      eq(SessionAttemptTable.status, "retrying"),
                      eq(SessionAttemptTable.status, "continuation"),
                    ),
                  ),
                )
                .run()
                .pipe(Effect.orDie)

              return { sessionIDs, submissionIDs }
            }),
            { behavior: "immediate" },
          )
        .pipe(
          Effect.catchCause((cause) => {
            const failure = Cause.findError(cause)
            if (Result.isFailure(failure) || !(failure.success instanceof Missing)) {
              return Effect.die(Cause.squash(cause))
            }
            return Effect.fail(failure.success)
          }),
        )

      if (cancelled.submissionIDs.length > 0) yield* notifications.signal()
      yield* Effect.forEach(cancelled.sessionIDs, input.interrupt, { discard: true })
      yield* Effect.forEach(cancelled.sessionIDs, input.wait, { discard: true })
      yield* db
        .update(SessionCancellationTable)
        .set({ time_completed: yield* Clock.currentTimeMillis })
        .where(
          and(
            eq(SessionCancellationTable.root_session_id, input.rootSessionID),
            isNull(SessionCancellationTable.time_completed),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      return cancelled
    })

    return Service.of({ cancelTree })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, TaskNotification.node, TaskSubmission.node],
})
