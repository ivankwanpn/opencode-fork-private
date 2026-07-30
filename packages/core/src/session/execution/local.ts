import { Cause, Clock, Effect, Layer } from "effect"
import { and, desc, eq, isNotNull, isNull, lte, or } from "drizzle-orm"
import { Database } from "../../database/database"
import { LocationServiceMap } from "../../location-service-map"
import { makeGlobalNode } from "../../effect/app-node"
import { SessionRunCoordinator } from "../run-coordinator"
import { SessionRunner } from "../runner"
import { SessionSchema } from "../schema"
import { SessionStore } from "../store"
import { SessionExecution } from "../execution"
import { SessionAttempt } from "../attempt"
import { SessionInput } from "../input"
import { SessionCommand } from "../command"
import { TaskNotification } from "../task-notification"
import { TaskSubmission } from "../task-submission"
import { SessionAttemptTable, SessionInputTable, TaskSubmissionTable } from "../sql"
import { EventV2 } from "../../event"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import { SessionV1 } from "@opencode-ai/schema/v1/session"

type DB = Database.Interface["db"]

const unresolvedTaskInputID = Effect.fn("SessionExecutionLocal.unresolvedTaskInputID")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  attempt?: { readonly seq: number; readonly status: string },
) {
  const current = attempt ?? (yield* SessionAttempt.get(db, sessionID))
  if (!current || (current.status !== "started" && current.status !== "responding")) return undefined
  const input = yield* SessionInput.latestPromotedAtOrBefore(db, sessionID, current.seq)
  if (!input) return undefined
  const submission = yield* db
    .select({ childInputID: TaskSubmissionTable.child_input_id })
    .from(TaskSubmissionTable)
    .where(
      and(
        eq(TaskSubmissionTable.child_session_id, sessionID),
        eq(TaskSubmissionTable.child_input_id, input.id),
        isNull(TaskSubmissionTable.outcome),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return submission ? input.id : undefined
})

export const startupCandidates = Effect.fn("SessionExecutionLocal.startupCandidates")(function* (db: DB, now: number) {
  const [scheduled, input] = yield* Effect.all([SessionAttempt.scheduled(db, now), SessionInput.startupCandidates(db)])
  const candidates = new Set<SessionSchema.ID>([
    ...scheduled.map((row: { sessionID: SessionSchema.ID }) => row.sessionID),
    ...input.map((row: { sessionID: SessionSchema.ID }) => row.sessionID),
  ])
  const safe: SessionSchema.ID[] = []
  for (const sessionID of candidates) {
    const attempt = yield* SessionAttempt.get(db, sessionID)
    if (attempt?.status === "started" || attempt?.status === "responding") continue
    safe.push(sessionID)
  }
  return safe
})

export const startupRecoveryCandidates = Effect.fn("SessionExecutionLocal.startupRecoveryCandidates")(function* (
  db: DB,
  _now: number,
) {
  const attempts = yield* db
    .select({
      sessionID: SessionAttemptTable.session_id,
      status: SessionAttemptTable.status,
      seq: SessionAttemptTable.seq,
    })
    .from(SessionAttemptTable)
    .where(or(eq(SessionAttemptTable.status, "started"), eq(SessionAttemptTable.status, "responding")))
    .all()
    .pipe(Effect.orDie)
  const recovery: Array<{
    readonly sessionID: SessionSchema.ID
    readonly reason: "dispatch-unknown" | "response-interrupted"
  }> = []
  for (const attempt of attempts)
    recovery.push({
      sessionID: attempt.sessionID,
      reason: attempt.status === "responding" ? "response-interrupted" : "dispatch-unknown",
    })
  return recovery
})

const recoverCompletedSubmissions = Effect.fn("SessionExecutionLocal.recoverCompletedSubmissions")(function* (
  sessionID: SessionSchema.ID,
  store: SessionStore.Interface,
  submissions: TaskSubmission.Interface,
) {
  const messages = yield* store.context(sessionID).pipe(Effect.orDie)
  return yield* submissions.recoverCompleted({ sessionID, messages })
})

const interruptedChildInputID = Effect.fn("SessionExecutionLocal.interruptedChildInputID")(function* (
  sessionID: SessionSchema.ID,
  db: DB,
) {
  return yield* unresolvedTaskInputID(db, sessionID)
})

const clearTerminalTaskAttempt = Effect.fn("SessionExecutionLocal.clearTerminalTaskAttempt")(function* (
  sessionID: SessionSchema.ID,
  db: DB,
) {
  const attempt = yield* SessionAttempt.get(db, sessionID)
  if (!attempt || (attempt.status !== "started" && attempt.status !== "responding")) return false
  const input = yield* db
    .select({
      id: SessionInputTable.id,
    })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNotNull(SessionInputTable.promoted_seq),
        lte(SessionInputTable.promoted_seq, attempt.seq),
      ),
    )
    .orderBy(desc(SessionInputTable.promoted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!input) return false
  const submission = yield* db
    .select({
      outcome: TaskSubmissionTable.outcome,
    })
    .from(TaskSubmissionTable)
    .where(
      and(
        eq(TaskSubmissionTable.child_session_id, sessionID),
        eq(TaskSubmissionTable.child_input_id, input.id),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  if (!submission?.outcome) return false
  const timeUpdated = yield* Clock.currentTimeMillis
  const updated = yield* db
    .update(SessionAttemptTable)
    .set({
      status: submission.outcome === "recovery-required" ? "abandoned" : "ended",
      retry_at: null,
      error: null,
      decision: submission.outcome === "recovery-required" ? "abandon" : null,
      time_updated: timeUpdated,
    })
    .where(
      and(
        eq(SessionAttemptTable.session_id, sessionID),
        eq(SessionAttemptTable.attempt_id, attempt.attempt_id),
        or(eq(SessionAttemptTable.status, "started"), eq(SessionAttemptTable.status, "responding")),
      ),
    )
    .returning({ sessionID: SessionAttemptTable.session_id })
    .get()
    .pipe(Effect.orDie)
  return updated !== undefined
})

/** Current-process routing for implicit-local Locations. Future remote placement belongs here. */
const layer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db
    const commands = yield* SessionCommand.Service
    const notifications = yield* TaskNotification.Service
    const submissions = yield* TaskSubmission.Service
    const current: { service?: SessionExecution.Interface } = {}
    const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, SessionRunner.RunError>({
      drain: Effect.fnUntraced(function* (sessionID: SessionSchema.ID, force) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* Effect.die(`Session not found: ${sessionID}`)
        const publish = (status: "busy" | "idle") =>
          events.publish(
            SessionStatusEvent.Status,
            { sessionID, status: { type: status } },
            { location: session.location },
          )
        const idle = publish("idle").pipe(
          Effect.andThen(events.publish(SessionStatusEvent.Idle, { sessionID }, { location: session.location })),
        )
        yield* publish("busy")
        yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force })).pipe(
          Effect.provide(locations.get(session.location)),
          Effect.provideService(SessionExecution.Current, current.service),
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.all(
                  [
                    Effect.logError("Failed to drain Session", cause).pipe(Effect.annotateLogs({ sessionID })),
                    events.publish(
                      SessionV1.Event.Error,
                      {
                        sessionID,
                        error: { name: "UnknownError", data: { message: Cause.pretty(cause) } },
                      },
                      { location: session.location },
                    ),
                  ],
                  { discard: true },
                ),
          ),
          Effect.ensuring(idle),
        )
        yield* recoverCompletedSubmissions(sessionID, store, submissions)
        yield* notifications.drain({
          admit: (notification) => commands.admitSynthetic(notification).pipe(Effect.asVoid),
          wake: (sessionID) => current.service?.wake(sessionID) ?? Effect.void,
        })
      }),
    })

    const service = SessionExecution.Service.of({
      active: coordinator.active,
      interrupt: coordinator.interrupt,
      resume: coordinator.run,
      exclusive: (sessionID, work) =>
        coordinator
          .exclusive(sessionID, work)
          .pipe(
            Effect.catchTag("SessionRunCoordinator.Busy", () =>
              Effect.fail(new SessionExecution.BusyError({ sessionID })),
            ),
          ),
      wake: coordinator.wake,
      wait: coordinator.wait,
    })
    current.service = service

    yield* notifications
      .drain({
        admit: (notification) => commands.admitSynthetic(notification).pipe(Effect.asVoid),
        wake: (sessionID) => current.service?.wake(sessionID) ?? Effect.void,
      })
      .pipe(Effect.forkScoped)

    const now = yield* Clock.currentTimeMillis
    for (const recovery of yield* startupRecoveryCandidates(db, now)) {
      yield* recoverCompletedSubmissions(recovery.sessionID, store, submissions)
      if (yield* clearTerminalTaskAttempt(recovery.sessionID, db)) continue
      const childInputID = yield* interruptedChildInputID(recovery.sessionID, db)
      if (childInputID)
        yield* submissions
          .markRecoveryRequired({ ...recovery, childInputID })
          .pipe(Effect.catch(() => Effect.succeed(0)))
    }
    for (const sessionID of yield* startupCandidates(db, now))
      yield* coordinator.run(sessionID).pipe(
        Effect.catch(() => Effect.void),
        Effect.forkScoped,
      )

    return service
  }),
)

export const node = makeGlobalNode({
  service: SessionExecution.Service,
  layer,
  deps: [
    Database.node,
    SessionStore.node,
    LocationServiceMap.node,
    EventV2.node,
    SessionCommand.node,
    TaskNotification.node,
    TaskSubmission.node,
  ],
})

export * as SessionExecutionLocal from "./local"
