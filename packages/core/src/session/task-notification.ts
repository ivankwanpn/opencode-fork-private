export * as TaskNotification from "./task-notification"

import { and, asc, eq, isNull, or, sql } from "drizzle-orm"
import { Cause, Clock, Context, Effect, Layer, PubSub, Schema, Stream } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { TaskNotificationOutboxTable, TaskSubmissionTable } from "./sql"

const NotificationPayload = Schema.Struct({
  taskID: Schema.optional(Schema.String),
  state: Schema.Literals(["completed", "error", "cancelled", "recovery-required"]),
  description: Schema.String,
  text: Schema.String,
})

type Row = typeof TaskNotificationOutboxTable.$inferSelect

export type Admission = {
  readonly id: SessionMessage.ID
  readonly sessionID: SessionSchema.ID
  readonly text: string
  readonly description: string
  readonly delivery: "steer" | "queue"
}

export interface Interface {
  /** Process-local advisory wakeup; the outbox remains the durable source of truth. */
  readonly signal: () => Effect.Effect<void>
  readonly subscribe: () => Stream.Stream<void>
  readonly drain: (input: {
    readonly admit: (input: Admission) => Effect.Effect<unknown, unknown>
    readonly wake: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  }) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskNotification") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const signal = yield* PubSub.sliding<void>(1)

    const isCancelled = Effect.fn("TaskNotification.isCancelled")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .all<{ root_session_id: string }>(sql`
          WITH RECURSIVE ancestors(id) AS (
            SELECT ${sessionID}
            UNION ALL
            SELECT session.parent_id
            FROM session
            JOIN ancestors ON session.id = ancestors.id
            WHERE session.parent_id IS NOT NULL
          )
          SELECT cancellation.root_session_id
          FROM session_cancellation cancellation
          JOIN ancestors ON ancestors.id = cancellation.root_session_id
          LIMIT 1
        `)
        .pipe(Effect.orDie)
      return rows.length > 0
    })

    const suppress = Effect.fn("TaskNotification.suppress")(function* (row: Row) {
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({
          status: "suppressed",
          error: { message: "Parent session was cancelled before notification delivery" },
          time_woken: yield* Clock.currentTimeMillis,
        })
        .where(
          and(
            eq(TaskNotificationOutboxTable.id, row.id),
            or(
              eq(TaskNotificationOutboxTable.status, "pending"),
              eq(TaskNotificationOutboxTable.status, "error"),
              and(eq(TaskNotificationOutboxTable.status, "delivered"), isNull(TaskNotificationOutboxTable.time_woken)),
            ),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

    const candidates = Effect.fn("TaskNotification.candidates")(function* () {
      return yield* db
        .select()
        .from(TaskNotificationOutboxTable)
        .where(
          or(
            eq(TaskNotificationOutboxTable.status, "pending"),
            eq(TaskNotificationOutboxTable.status, "error"),
            and(eq(TaskNotificationOutboxTable.status, "delivered"), isNull(TaskNotificationOutboxTable.time_woken)),
          ),
        )
        .orderBy(asc(TaskNotificationOutboxTable.time_created), asc(TaskNotificationOutboxTable.id))
        .all()
        .pipe(Effect.orDie)
    })

    const attempt = Effect.fn("TaskNotification.attempt")(function* (
      row: Row,
      input: Parameters<Interface["drain"]>[0],
    ) {
      if (yield* isCancelled(SessionSchema.ID.make(row.parent_session_id))) {
        yield* suppress(row)
        return false
      }
      const claimed = yield* db
        .update(TaskNotificationOutboxTable)
        .set({
          attempts: sql<number>`${TaskNotificationOutboxTable.attempts} + 1`,
          error: null,
        })
        .where(
          and(
            eq(TaskNotificationOutboxTable.id, row.id),
            or(
              eq(TaskNotificationOutboxTable.status, "pending"),
              eq(TaskNotificationOutboxTable.status, "error"),
              and(eq(TaskNotificationOutboxTable.status, "delivered"), isNull(TaskNotificationOutboxTable.time_woken)),
            ),
          ),
        )
        .returning({ id: TaskNotificationOutboxTable.id })
        .get()
        .pipe(Effect.orDie)
      if (!claimed) return false

      const payload = Schema.decodeUnknownSync(NotificationPayload)(row.payload)
      const taskID =
        payload.taskID ||
        (yield* db
          .select({ childSessionID: TaskSubmissionTable.child_session_id })
          .from(TaskSubmissionTable)
          .where(eq(TaskSubmissionTable.id, row.submission_id))
          .get()
          .pipe(Effect.orDie))?.childSessionID
      if (!taskID) return yield* Effect.die(`Task submission not found: ${row.submission_id}`)
      yield* input.admit({
        id: SessionMessage.ID.make(row.message_id),
        sessionID: SessionSchema.ID.make(row.parent_session_id),
        text: renderPayload(payload, taskID),
        description: payload.description,
        delivery: "steer",
      })

      const timeDelivered = yield* Clock.currentTimeMillis
      const delivered = yield* db
        .update(TaskNotificationOutboxTable)
        .set({ status: "delivered", error: null, time_delivered: timeDelivered })
        .where(
          and(
            eq(TaskNotificationOutboxTable.id, row.id),
            or(eq(TaskNotificationOutboxTable.status, "pending"), eq(TaskNotificationOutboxTable.status, "error")),
          ),
        )
        .returning({ id: TaskNotificationOutboxTable.id })
        .get()
        .pipe(Effect.orDie)
      if (!delivered) {
        const current = yield* db
          .select()
          .from(TaskNotificationOutboxTable)
          .where(eq(TaskNotificationOutboxTable.id, row.id))
          .get()
          .pipe(Effect.orDie)
        if (current?.status !== "delivered" || current.time_woken !== null) return false
      }

      yield* input.wake(SessionSchema.ID.make(row.parent_session_id))
      const timeWoken = yield* Clock.currentTimeMillis
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({ status: "woken", time_woken: timeWoken })
        .where(
          and(
            eq(TaskNotificationOutboxTable.id, row.id),
            eq(TaskNotificationOutboxTable.status, "delivered"),
            isNull(TaskNotificationOutboxTable.time_woken),
          ),
        )
        .run()
        .pipe(Effect.orDie)
      return true
    })

    const fail = Effect.fn("TaskNotification.fail")(function* (row: Row, cause: Cause.Cause<unknown>) {
      if (yield* isCancelled(SessionSchema.ID.make(row.parent_session_id))) {
        yield* suppress(row)
        return
      }
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({ status: "error", error: { message: String(Cause.squash(cause)) } })
        .where(
          and(
            eq(TaskNotificationOutboxTable.id, row.id),
            or(
              eq(TaskNotificationOutboxTable.status, "pending"),
              eq(TaskNotificationOutboxTable.status, "error"),
              and(eq(TaskNotificationOutboxTable.status, "delivered"), isNull(TaskNotificationOutboxTable.time_woken)),
            ),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    })

    const drain: Interface["drain"] = Effect.fn("TaskNotification.drain")(function* (input) {
      const rows = yield* candidates()
      const results = yield* Effect.forEach(rows, (row) =>
        attempt(row, input).pipe(Effect.catchCause((cause) => fail(row, cause).pipe(Effect.as(false)))),
      )
      return results.filter((result) => result).length
    })

    return Service.of({
      signal: () => PubSub.publish(signal, undefined).pipe(Effect.asVoid),
      subscribe: () => Stream.fromPubSub(signal),
      drain,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})

function renderPayload(payload: typeof NotificationPayload.Type, taskID: string) {
  const tag = payload.state === "error" ? "task_error" : "task_result"
  return [
    `<task id="${taskID}" state="${payload.state}">`,
    `<summary>${payload.description}</summary>`,
    `<${tag}>`,
    payload.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}
