import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Prompt } from "@opencode-ai/core/session/prompt"
import {
  SessionCancellationTable,
  SessionInputTable,
  SessionTable,
  TaskNotificationOutboxTable,
} from "@opencode-ai/core/session/sql"
import { TaskNotification } from "@opencode-ai/core/session/task-notification"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { testEffect } from "./lib/effect"

const parentSessionID = SessionSchema.ID.make("ses_notification_parent")
const childSessionID = SessionSchema.ID.make("ses_notification_child")
const legacyChildSessionID = SessionSchema.ID.make("ses_notification_legacy_child")
const assistantMessageID = SessionMessage.ID.make("msg_notification_assistant")
const invocation = {
  parentSessionID,
  assistantMessageID,
  toolCallID: "call_notification_1",
  childSessionID,
  description: "Inspect notifications",
  agent: "general",
  prompt: Prompt.make({ text: "inspect notifications" }),
  completionDelivery: "parent" as const,
}

const admissions: TaskNotification.Admission[] = []
const wakes: SessionSchema.ID[] = []

const executionLayer = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.succeed(new Set()),
    resume: () => Effect.void,
    exclusive: (_sessionID, work) => work,
    wake: (sessionID) => Effect.sync(() => wakes.push(sessionID)),
    wait: () => Effect.void,
    interrupt: () => Effect.void,
  }),
)

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionCommand.node,
      SessionExecution.node,
      TaskSubmission.node,
      TaskNotification.node,
    ]),
    [[SessionExecution.node, executionLayer]],
  ),
)

const setup = Effect.gen(function* () {
  admissions.length = 0
  wakes.length = 0
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: parentSessionID,
        project_id: Project.ID.global,
        slug: "notification-parent",
        directory: "/project",
        title: "notification parent",
        version: "test",
      },
      {
        id: childSessionID,
        project_id: Project.ID.global,
        parent_id: parentSessionID,
        slug: "notification-child",
        directory: "/project",
        title: "notification child",
        version: "test",
      },
    ])
    .run()
    .pipe(Effect.orDie)
  const submissions = yield* TaskSubmission.Service
  const submission = yield* submissions.submit(invocation)
  yield* submissions.terminalize({ submissionID: submission.id, outcome: "completed", resultText: "child complete" })
})

const admitAndRecord =
  (commands: SessionCommand.Interface) =>
  (admission: TaskNotification.Admission) =>
    Effect.sync(() => admissions.push(admission)).pipe(Effect.andThen(commands.admitSynthetic(admission)), Effect.asVoid)

describe("TaskNotification", () => {
  it.effect("delivers a terminal notification once and wakes the parent after durable ack", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const execution = yield* SessionExecution.Service
      const { db } = yield* Database.Service

      const input = {
        admit: admitAndRecord(commands),
        wake: execution.wake,
      }
      expect(yield* notifications.drain(input)).toBe(1)
      expect(admissions).toHaveLength(1)
      const outbox = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]
      expect(admissions[0]).toMatchObject({
        id: TaskSubmission.notificationID(outbox!.submission_id),
        sessionID: parentSessionID,
        delivery: "steer",
      })
      expect(admissions[0]?.text).toContain(`<task id="${childSessionID}" state="completed">`)
      expect(wakes).toEqual([parentSessionID])
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("woken")
      expect(typeof (yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.time_delivered).toBe("number")
      expect(
        yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, parentSessionID)).all(),
      ).toHaveLength(1)
      expect(yield* notifications.drain(input)).toBe(0)
    }),
  )

  it.effect("recovers a child task identity when delivering a legacy payload", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const execution = yield* SessionExecution.Service
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service
      yield* db
        .insert(SessionTable)
        .values({
          id: legacyChildSessionID,
          project_id: Project.ID.global,
          parent_id: parentSessionID,
          slug: "notification-legacy-child",
          directory: "/project",
          title: "notification legacy child",
          version: "test",
        })
        .run()
        .pipe(Effect.orDie)
      const legacy = yield* submissions.submit({
        ...invocation,
        childSessionID: legacyChildSessionID,
        toolCallID: "call_notification_legacy",
        completionDelivery: "tool",
      })
      yield* submissions.terminalize({ submissionID: legacy.id, outcome: "completed", resultText: "legacy complete" })
      yield* db
        .insert(TaskNotificationOutboxTable)
        .values({
          id: "outbox_notification_legacy",
          submission_id: legacy.id,
          parent_session_id: parentSessionID,
          message_id: SessionMessage.ID.make("msg_notification_legacy"),
          payload: {
            state: "completed",
            description: legacy.description,
            text: "legacy complete",
          },
          status: "pending",
          time_created: 1,
        })
        .run()
        .pipe(Effect.orDie)

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: execution.wake,
        }),
      ).toBe(2)
      expect(admissions).toHaveLength(2)
      expect(admissions.find((admission) => admission.id === SessionMessage.ID.make("msg_notification_legacy"))?.text).toContain(
        `<task id="${legacyChildSessionID}" state="completed">`,
      )
    }),
  )

  it.effect("replays a delivered-but-not-woken outbox row with the same parent message ID", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const execution = yield* SessionExecution.Service
      const { db } = yield* Database.Service
      const outbox = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]!
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({ status: "delivered", time_woken: null })
        .where(eq(TaskNotificationOutboxTable.id, outbox.id))
        .run()
        .pipe(Effect.orDie)

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: execution.wake,
        }),
      ).toBe(1)
      expect(admissions).toHaveLength(1)
      expect(admissions[0]?.id).toBe(TaskSubmission.notificationID(outbox.submission_id))
      expect(wakes).toEqual([parentSessionID])
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("woken")
    }),
  )

  it.effect("retries an outbox row after a previous delivery failure", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const execution = yield* SessionExecution.Service
      const { db } = yield* Database.Service
      const outbox = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]!
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({ status: "error", error: { message: "previous process crashed" } })
        .where(eq(TaskNotificationOutboxTable.id, outbox.id))
        .run()
        .pipe(Effect.orDie)

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: execution.wake,
        }),
      ).toBe(1)
      expect(admissions).toHaveLength(1)
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("woken")
    }),
  )

  it.effect("keeps a wake-failed notification replayable and reuses the deterministic parent input id on replay", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const { db } = yield* Database.Service
      const commands = yield* SessionCommand.Service

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: () => Effect.die(new Error("wake crashed")),
        }),
      ).toBe(0)
      const failed = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]!
      const parentInputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.session_id, parentSessionID))
        .all()
      expect(parentInputs).toHaveLength(1)
      expect(parentInputs[0]?.id).toBe(TaskSubmission.notificationID(failed.submission_id))
      expect(failed.status).toBe("error")
      expect(failed.error).toMatchObject({ message: expect.stringContaining("wake crashed") })

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: () => Effect.void,
        }),
      ).toBe(1)
      expect(
        yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, parentSessionID))
          .all(),
      ).toHaveLength(1)
      expect(
        (
          yield* db
            .select()
            .from(SessionInputTable)
            .where(eq(SessionInputTable.session_id, parentSessionID))
            .all()
        )[0]?.id,
      ).toBe(
        TaskSubmission.notificationID(failed.submission_id),
      )
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("woken")
    }),
  )

  it.effect("reports an explicit delivery error when deterministic replay conflicts with the existing parent input", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const { db } = yield* Database.Service
      const commands = yield* SessionCommand.Service

      yield* notifications.drain({
        admit: admitAndRecord(commands),
        wake: () => Effect.die(new Error("wake crashed")),
      })
      const failed = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]!
      yield* db
        .update(TaskNotificationOutboxTable)
        .set({
          payload: {
            state: "completed",
            description: "Inspect notifications",
            text: "conflicting replay payload",
          },
        })
        .where(eq(TaskNotificationOutboxTable.id, failed.id))
        .run()
        .pipe(Effect.orDie)

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: () => Effect.void,
        }),
      ).toBe(0)
      expect(
        yield* db
          .select()
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, parentSessionID))
          .all(),
      ).toHaveLength(1)
      const replayed = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]!
      expect(replayed.status).toBe("error")
      expect(replayed.error).toMatchObject({
        message: expect.stringContaining("PromptConflictError"),
      })
    }),
  )

  it.effect("does not rewrite a woken notification to error after a late wake failure", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const { db } = yield* Database.Service
      const firstWakeStarted = yield* Deferred.make<void>()
      const releaseFirstWake = yield* Deferred.make<void>()
      const secondDone = yield* Deferred.make<void>()
      let wakeCalls = 0

      const first = yield* notifications
        .drain({
          admit: admitAndRecord(commands),
          wake: () =>
            Effect.gen(function* () {
              wakeCalls += 1
              yield* Deferred.succeed(firstWakeStarted, undefined)
              yield* Deferred.await(releaseFirstWake)
              return yield* Effect.die(new Error("late wake failure"))
            }),
        })
        .pipe(Effect.forkChild)

      yield* Deferred.await(firstWakeStarted)

      const second = yield* notifications
        .drain({
          admit: admitAndRecord(commands),
          wake: () =>
            Effect.sync(() => {
              wakeCalls += 1
            }),
        })
        .pipe(Effect.ensuring(Deferred.succeed(secondDone, undefined)), Effect.forkChild)

      yield* Deferred.await(secondDone)
      yield* Deferred.succeed(releaseFirstWake, undefined)
      expect(yield* Fiber.join(second)).toBe(1)
      expect(yield* Fiber.join(first)).toBe(0)
      expect(wakeCalls).toBe(2)
      const outbox = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]!
      expect(outbox.status).toBe("woken")
      expect(outbox.time_woken).not.toBeNull()
      expect(
        yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, parentSessionID)).all(),
      ).toHaveLength(1)
    }),
  )

  it.effect("suppresses notifications after the parent session is cancelled", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const execution = yield* SessionExecution.Service
      const { db } = yield* Database.Service
      yield* db
        .insert(SessionCancellationTable)
        .values({ root_session_id: parentSessionID, time_created: 1 })
        .run()
        .pipe(Effect.orDie)

      const rejected = yield* commands
        .admitSynthetic({
          id: SessionMessage.ID.make("msg_cancelled_parent_direct"),
          sessionID: parentSessionID,
          text: "direct synthetic input",
          description: "direct synthetic input",
        })
        .pipe(Effect.flip)
      expect(rejected._tag).toBe("Session.Cancelled")

      expect(
        yield* notifications.drain({
          admit: admitAndRecord(commands),
          wake: execution.wake,
        }),
      ).toBe(0)
      expect(admissions).toHaveLength(0)
      expect(
        yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.session_id, parentSessionID)).all(),
      ).toHaveLength(0)
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("suppressed")
      expect(yield* notifications.drain({ admit: admitAndRecord(commands), wake: execution.wake })).toBe(0)
    }),
  )
})
