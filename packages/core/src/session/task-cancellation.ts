export * as TaskCancellation from "./task-cancellation"

import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { SessionSchema } from "./schema"
import { SessionCancellationTable, SessionInputTable, TaskNotificationOutboxTable, TaskSubmissionTable } from "./sql"
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

    const ownership = Effect.fn("TaskCancellation.ownership")(function* (rootSessionID: SessionSchema.ID) {
      return yield* db
        .all<{ id: string }>(
          sql`
          WITH RECURSIVE ownership(id) AS (
            SELECT id FROM session WHERE id = ${rootSessionID}
            UNION ALL
            SELECT child.id
            FROM session child
            JOIN ownership parent ON child.parent_id = parent.id
          )
          SELECT id FROM ownership ORDER BY id
        `,
        )
        .pipe(Effect.orDie)
    })

    const cancelTree: Interface["cancelTree"] = Effect.fn("TaskCancellation.cancelTree")(function* (input) {
      const rows = yield* ownership(input.rootSessionID)
      if (rows.length === 0) return yield* new Missing({ rootSessionID: input.rootSessionID })
      const sessionIDs = rows.map((row) => SessionSchema.ID.make(row.id))
      const now = yield* Clock.currentTimeMillis
      const submissionIDs = yield* db
        .transaction(() =>
          Effect.gen(function* () {
            yield* db
              .insert(SessionCancellationTable)
              .values({ root_session_id: input.rootSessionID, time_created: now })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)

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

              const terminalSeq = yield* EventV2.latestSequence(db, updated.child_session_id)

              const projected = yield* db
                .update(SessionInputTable)
                .set({
                  terminal_outcome: "cancelled",
                  terminal_error: { message: "Task cancelled by ownership root" },
                  terminal_time: now,
                  terminal_seq: terminalSeq,
                })
                .where(
                  and(eq(SessionInputTable.id, updated.child_input_id), isNull(SessionInputTable.terminal_outcome)),
                )
                .returning({ id: SessionInputTable.id })
                .get()
                .pipe(Effect.orDie)
              if (!projected) return yield* Effect.die(`Task input was not pending: ${updated.child_input_id}`)

              yield* db
                .insert(TaskNotificationOutboxTable)
                .values({
                  id: Identifier.create("outbox", "ascending"),
                  submission_id: updated.id,
                  parent_session_id: updated.parent_session_id,
                  message_id: TaskSubmission.notificationID(updated.id),
                  payload: {
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

            yield* db
              .update(SessionCancellationTable)
              .set({ time_completed: now })
              .where(eq(SessionCancellationTable.root_session_id, input.rootSessionID))
              .run()
              .pipe(Effect.orDie)
            return submissions.filter((submission) => submission.outcome === null).map((submission) => submission.id)
          }),
        )
        .pipe(Effect.orDie)

      yield* Effect.forEach(sessionIDs, input.interrupt, { discard: true })
      yield* Effect.forEach(sessionIDs, input.wait, { discard: true })
      return { sessionIDs, submissionIDs }
    })

    return Service.of({ cancelTree })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, TaskSubmission.node],
})
