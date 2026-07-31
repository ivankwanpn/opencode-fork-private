import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionInputTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const inputLayer = AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node]))
const inputIt = testEffect(inputLayer)
const pluginLocation = pluginLocationMap()
const sessionLayer = AppNodeBuilder.build(
  LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionStore.node, SessionCommand.node, SessionV2.node]),
  [pluginLocation.replacement, [SessionExecution.node, SessionExecution.noopLayer]],
)
const sessionIt = testEffect(sessionLayer)

const sessionID = SessionV2.ID.make("ses_input_test")
const otherSessionID = SessionV2.ID.make("ses_input_other")

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: sessionID,
        project_id: Project.ID.global,
        slug: "input-test",
        directory: "/project",
        title: "input-test",
        version: "test",
      },
      {
        id: otherSessionID,
        project_id: Project.ID.global,
        slug: "input-other",
        directory: "/project",
        title: "input-other",
        version: "test",
      },
    ])
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const seedAggregate = (sessionID: SessionV2.ID) =>
  EventV2.Service.use((events) =>
    events.publish(SessionEvent.Synthetic, {
      sessionID,
      messageID: SessionMessage.ID.make(`msg_seed_${sessionID}`),
      timestamp: DateTime.makeUnsafe(0),
      text: "seed",
    }),
  )

const admitInput = (sessionID: SessionV2.ID, id: string, delivery: SessionInput.Delivery = "steer") =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    return yield* SessionInput.admit(db, events, {
      id: SessionMessage.ID.make(id),
      sessionID,
      prompt: Prompt.make({ text: id }),
      delivery,
    })
  })

describe("SessionInput", () => {
  inputIt.effect("lists only pending inputs in admitted order", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const first = yield* admitInput(sessionID, "msg_pending_first")
      const second = yield* admitInput(sessionID, "msg_pending_second", "queue")
      const third = yield* admitInput(sessionID, "msg_pending_third", "queue")

      expect([first.admittedSeq, second.admittedSeq, third.admittedSeq]).toEqual([1, 2, 3])
      expect(yield* SessionInput.cancelPending(db, sessionID, third.id)).toBe("cancelled")

      const inputs = yield* SessionInput.pending(db, sessionID)
      expect(inputs.map((input) => input.id)).toEqual([first.id, second.id])
      expect((yield* SessionInput.pending(db, sessionID, "queue")).every((input) => input.delivery === "queue")).toBe(
        true,
      )
    }),
  )

  inputIt.effect("looks up inputs only within the requested session", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const { db } = yield* Database.Service
      const first = yield* admitInput(sessionID, "msg_find_session")

      expect(yield* SessionInput.findForSession(db, sessionID, first.id)).toEqual(first)
      expect(yield* SessionInput.findForSession(db, otherSessionID, first.id)).toBeUndefined()
    }),
  )

  inputIt.effect("returns precise cancellation outcomes for pending, replayed, promoted, and missing inputs", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const pending = yield* admitInput(sessionID, "msg_cancel_pending")
      const promoted = yield* admitInput(sessionID, "msg_cancel_promoted")

      expect(yield* SessionInput.cancelPending(db, sessionID, pending.id)).toBe("cancelled")
      const cancelledSeq = yield* EventV2.latestSequence(db, sessionID)
      expect(yield* SessionInput.cancelPending(db, sessionID, pending.id)).toBe("terminal")
      expect(yield* SessionInput.promote(db, events, sessionID, promoted.id)).toBe(true)
      expect(yield* SessionInput.cancelPending(db, sessionID, promoted.id)).toBe("promoted")
      expect(yield* SessionInput.cancelPending(db, sessionID, SessionMessage.ID.make("msg_cancel_missing"))).toBe(
        "missing",
      )

      const row = yield* db
        .select({
          outcome: SessionInputTable.terminal_outcome,
          error: SessionInputTable.terminal_error,
          time: SessionInputTable.terminal_time,
          seq: SessionInputTable.terminal_seq,
        })
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, pending.id))
        .get()
        .pipe(Effect.orDie)
      expect(row).toMatchObject({
        outcome: "cancelled",
        error: { message: "Input cancelled by user" },
      })
      expect(typeof row?.time).toBe("number")
      expect(row?.seq).toBe(cancelledSeq)
    }),
  )
})

describe("SessionV2 durable input operations", () => {
  sessionIt.effect("validates the session before listing or finding pending durable inputs", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const service = yield* SessionV2.Service
      const first = yield* admitInput(sessionID, "msg_service_pending")

      expect((yield* service.pending({ sessionID })).map((input) => input.id)).toEqual([first.id])
      expect(yield* service.findInput({ sessionID, inputID: first.id })).toEqual(first)
      expect(yield* service.pending({ sessionID: SessionV2.ID.make("ses_input_missing") }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
      })
    }),
  )

  sessionIt.effect("returns the same promoted projection across exact promotion retries", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const { db } = yield* Database.Service
      const service = yield* SessionV2.Service
      const input = yield* admitInput(sessionID, "msg_promote_retry")

      const [first, second] = yield* Effect.all(
        [service.promoteInput({ sessionID, inputID: input.id }), service.promoteInput({ sessionID, inputID: input.id })],
        { concurrency: "unbounded" },
      )

      expect(second).toEqual(first)
      expect(first.promotedSeq).toEqual(expect.any(Number))
      expect(
        yield* db
          .select({ seq: EventTable.seq })
          .from(EventTable)
          .where(eq(EventTable.type, EventV2.versionedType(SessionEvent.Prompted.type, 1)))
          .orderBy(asc(EventTable.seq))
          .all()
          .pipe(Effect.orDie),
      ).toHaveLength(1)
    }),
  )

  sessionIt.effect("rejects exact promotion of missing or terminal inputs", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const service = yield* SessionV2.Service
      const input = yield* admitInput(sessionID, "msg_promote_terminal")
      yield* service.cancelInput({ sessionID, inputID: input.id })

      expect(
        yield* service.promoteInput({ sessionID, inputID: SessionMessage.ID.make("msg_promote_missing") }).pipe(
          Effect.flip,
        ),
      ).toMatchObject({ _tag: "Session.InputConflictError" })
      expect(yield* service.promoteInput({ sessionID, inputID: input.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.InputConflictError",
      })
    }),
  )

  sessionIt.effect("does not allow concurrent promotion and cancellation to both win", () =>
    Effect.gen(function* () {
      yield* setup
      yield* seedAggregate(sessionID)
      const { db } = yield* Database.Service
      const service = yield* SessionV2.Service
      const input = yield* admitInput(sessionID, "msg_promote_cancel_race")

      const [promoted, cancelled] = yield* Effect.all(
        [
          service.promoteInput({ sessionID, inputID: input.id }).pipe(Effect.exit),
          service.cancelInput({ sessionID, inputID: input.id }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      expect(Number(promoted._tag === "Success") + Number(cancelled._tag === "Success")).toBe(1)
      const row = yield* db
        .select({ promoted: SessionInputTable.promoted_seq, terminal: SessionInputTable.terminal_outcome })
        .from(SessionInputTable)
        .where(eq(SessionInputTable.id, input.id))
        .get()
        .pipe(Effect.orDie)
      expect(Number(row !== undefined && row.promoted !== null) + Number(row !== undefined && row.terminal !== null)).toBe(1)
    }),
  )
})
