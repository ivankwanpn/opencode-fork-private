import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Layer } from "effect"
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
import { SessionInputTable, SessionTable, TaskNotificationOutboxTable } from "@opencode-ai/core/session/sql"
import { TaskNotification } from "@opencode-ai/core/session/task-notification"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { testEffect } from "./lib/effect"

const parentSessionID = SessionSchema.ID.make("ses_notification_parent")
const childSessionID = SessionSchema.ID.make("ses_notification_child")
const assistantMessageID = SessionMessage.ID.make("msg_notification_assistant")
const invocation = {
  parentSessionID,
  assistantMessageID,
  toolCallID: "call_notification_1",
  childSessionID,
  description: "Inspect notifications",
  agent: "general",
  prompt: Prompt.make({ text: "inspect notifications" }),
}

const admissions: Array<Parameters<SessionCommand.Interface["admitSynthetic"]>[0]> = []
const wakes: SessionSchema.ID[] = []

const commandLayer = Layer.succeed(
  SessionCommand.Service,
  SessionCommand.Service.of({
    create: () => Effect.die("unused"),
    plan: () => Effect.die("unused"),
    synthetic: () => Effect.die("unused"),
    switchAgent: () => Effect.die("unused"),
    switchModel: () => Effect.die("unused"),
    admit: () => Effect.die("unused"),
    admitSynthetic: (input) =>
      Effect.gen(function* () {
        admissions.push(input)
        return SessionInput.Admitted.make({
          admittedSeq: admissions.length,
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          prompt: Prompt.make({ text: input.text }),
          synthetic: SessionInput.Synthetic.make({ description: input.description }),
          delivery: input.delivery ?? "steer",
          timeCreated: yield* DateTime.now,
        })
      }),
  }),
)

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
    [
      [SessionCommand.node, commandLayer],
      [SessionExecution.node, executionLayer],
    ],
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

describe("TaskNotification", () => {
  it.effect("delivers a terminal notification once and wakes the parent after durable ack", () =>
    Effect.gen(function* () {
      yield* setup
      const notifications = yield* TaskNotification.Service
      const commands = yield* SessionCommand.Service
      const execution = yield* SessionExecution.Service
      const { db } = yield* Database.Service

      const input = { admit: (admission: TaskNotification.Admission) => commands.admitSynthetic(admission).pipe(Effect.asVoid), wake: execution.wake }
      expect(yield* notifications.drain(input)).toBe(1)
      expect(admissions).toHaveLength(1)
      const outbox = (yield* db.select().from(TaskNotificationOutboxTable).all())[0]
      expect(admissions[0]).toMatchObject({
        id: TaskSubmission.notificationID(outbox!.submission_id),
        sessionID: parentSessionID,
        delivery: "steer",
      })
      expect(wakes).toEqual([parentSessionID])
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("woken")
      expect(typeof (yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.time_delivered).toBe("number")
      expect(yield* db.select().from(SessionInputTable).all()).toHaveLength(1)
      expect(yield* notifications.drain(input)).toBe(0)
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
          admit: (admission: TaskNotification.Admission) => commands.admitSynthetic(admission).pipe(Effect.asVoid),
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
          admit: (admission: TaskNotification.Admission) => commands.admitSynthetic(admission).pipe(Effect.asVoid),
          wake: execution.wake,
        }),
      ).toBe(1)
      expect(admissions).toHaveLength(1)
      expect((yield* db.select().from(TaskNotificationOutboxTable).all())[0]?.status).toBe("woken")
    }),
  )
})
