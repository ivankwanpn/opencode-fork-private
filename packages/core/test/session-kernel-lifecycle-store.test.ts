import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { EventTable } from "@opencode-ai/core/event/sql"
import { Location } from "@opencode-ai/core/location"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionInputTable } from "@opencode-ai/core/session/sql"
import { Kernel } from "@opencode-ai/core/session/kernel"
import { LifecycleStore } from "@opencode-ai/core/session/kernel/lifecycle-store"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const pluginMap = pluginLocationMap()
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      SessionStore.node,
      SessionV2.node,
      Kernel.node,
      LifecycleStore.node,
    ]),
    [
      [ProjectV2.node, projects],
      [SessionExecution.node, SessionExecution.noopLayer],
      pluginMap.replacement,
    ],
  ),
)

const makeKernelSession = Effect.fn("test.makeKernelSession")(function* (
  sessions: SessionV2.Interface,
  label = "turn",
) {
  const session = yield* sessions.create({ location, engine: "kernel" })
  const admitted = yield* sessions.prompt({
    sessionID: session.id,
    prompt: Prompt.make({ text: `Kernel ${label}` }),
    resume: false,
  })
  return { session, admitted }
})

const startInput = (sessionID: SessionV2.ID, inputID: SessionMessage.ID) => ({
  sessionID,
  inputID,
  turnID: SessionMessage.ID.create(),
  attemptID: EventV2.ID.create(),
  assistantMessageID: SessionMessage.ID.create(),
  processIncarnation: "incarnation-1",
})

const durableTypes = Effect.fn("test.durableTypes")(function* (db: Database.Interface["db"], sessionID: SessionV2.ID) {
  const rows = yield* db
    .select({ type: EventTable.type })
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)
  return rows.map((row) => row.type)
})

describe("LifecycleStore", () => {
  it.effect("creates the idle kernel execution row with the kernel Session", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const lifecycle = yield* LifecycleStore.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const snapshot = yield* lifecycle.get(session.id)
      expect(snapshot).toMatchObject({ engine: "kernel", generation: 0, state: "idle" })
      expect(snapshot.lease).toBeUndefined()
      expect(snapshot.phase).toBeUndefined()
      expect(snapshot.turnID).toBeUndefined()
      expect(snapshot.inputID).toBeUndefined()
      expect(snapshot.attemptID).toBeUndefined()
      expect(snapshot.assistantMessageID).toBeUndefined()
      expect(snapshot.retryAt).toBeUndefined()
      expect(snapshot.recoveryReason).toBeUndefined()
      expect(snapshot.startedSeq).toBeUndefined()
      expect(snapshot.updatedSeq).toBeUndefined()
      expect((yield* SessionInput.find((yield* Database.Service).db, admitted.id))?.promotedSeq).toBeUndefined()
    }),
  )

  it.effect("atomically starts one kernel turn and fences the loser", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const input = startInput(session.id, admitted.id)
      const [left, right] = yield* Effect.all(
        [store.start(input).pipe(Effect.exit), store.start(input).pipe(Effect.exit)],
        { concurrency: "unbounded" },
      )
      expect([left, right].filter(Exit.isSuccess)).toHaveLength(1)
      const snapshot = yield* store.get(session.id)
      expect(snapshot.state).toBe("active")
      expect(snapshot.phase).toBe("dispatching")
      expect(snapshot.generation).toBe(1)
      expect(snapshot.lease).toMatchObject({ sessionID: session.id, generation: 1 })
      expect(snapshot.turnID).toBe(input.turnID)
      expect(snapshot.inputID).toBe(input.inputID)
      expect(snapshot.attemptID).toBe(input.attemptID)
      expect(snapshot.assistantMessageID).toBe(input.assistantMessageID)
      expect(snapshot.processIncarnation).toBe("incarnation-1")
      expect(snapshot.startedSeq).toBe(2)
      expect(snapshot.updatedSeq).toBe(4)
      expect(yield* durableTypes(db, session.id)).toEqual([
        "session.next.created.1",
        "session.next.prompt.admitted.1",
        "session.next.prompted.1",
        "session.next.turn.started.1",
        "session.next.provider.attempt.started.1",
      ])
      // The atomic start promoted the input exactly once.
      expect((yield* SessionInput.find(db, admitted.id))?.promotedSeq).toBe(2)
    }),
  )

  it.effect("rejects every commit made with a fenced lease", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const lease = yield* store.start(startInput(session.id, admitted.id))
      yield* store.acceptInterrupt({ sessionID: session.id, expectedGeneration: lease.generation, reason: "user" })
      const error = yield* store.checkpoint({ lease, events: [] }).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "StaleExecutionError" })
      const transitionError = yield* store
        .transition({
          lease,
          expectedState: "active",
          state: "retry_wait",
          events: [],
        })
        .pipe(Effect.flip)
      expect(transitionError).toMatchObject({ _tag: "StaleExecutionError" })
      const terminalError = yield* store.terminalize({ lease, outcome: "cancelled" }).pipe(Effect.flip)
      expect(terminalError).toMatchObject({ _tag: "StaleExecutionError" })
      // The fence advanced the generation and cleared the lease.
      const snapshot = yield* store.get(session.id)
      expect(snapshot.state).toBe("cancelling")
      expect(snapshot.generation).toBe(2)
      expect(snapshot.lease).toBeUndefined()
    }),
  )

  it.effect("rejects a transition from an unexpected state", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const lease = yield* store.start(startInput(session.id, admitted.id))
      const error = yield* store
        .transition({ lease, expectedState: "retry_wait", state: "active", events: [] })
        .pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "StaleExecutionError" })
      // The failed transition changed nothing: generation, state, and sequence
      // are untouched.
      const snapshot = yield* store.get(session.id)
      expect(snapshot).toMatchObject({ generation: 1, state: "active", updatedSeq: 4 })
    }),
  )

  it.effect("checkpoints commit events and advance the coordination sequence", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const lease = yield* store.start(startInput(session.id, admitted.id))
      const payloads = yield* store.checkpoint({
        lease,
        events: [
          {
            definition: KernelCheckpointEvent,
            data: { sessionID: session.id, text: "checkpoint" },
          },
        ],
      })
      expect(payloads).toHaveLength(1)
      expect(payloads[0]?.durable?.seq).toBe(5)
      expect((yield* store.get(session.id)).updatedSeq).toBe(5)
      expect((yield* store.get(session.id)).generation).toBe(1)
    }),
  )

  it.effect("terminalizes input, turn, and attempt atomically and is idempotent", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { db } = yield* Database.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const lease = yield* store.start(startInput(session.id, admitted.id))
      const resultMessageID = SessionMessage.ID.create()
      const settled = yield* store.terminalize({
        lease,
        outcome: "completed",
        resultMessageID,
      })
      expect(settled).toMatchObject({ state: "idle", generation: 1 })
      expect(settled.lease).toBeUndefined()
      expect(settled.turnID).toBeUndefined()
      expect(settled.attemptID).toBeUndefined()
      const inputRow = yield* db
        .select()
        .from(SessionInputTable)
        .where(and(eq(SessionInputTable.id, admitted.id), eq(SessionInputTable.session_id, session.id)))
        .get()
        .pipe(Effect.orDie)
      expect(inputRow).toMatchObject({
        terminal_outcome: "completed",
        terminal_message_id: resultMessageID,
      })
      expect(inputRow?.terminal_seq).toBe(7)
      expect(yield* durableTypes(db, session.id)).toEqual([
        "session.next.created.1",
        "session.next.prompt.admitted.1",
        "session.next.prompted.1",
        "session.next.turn.started.1",
        "session.next.provider.attempt.started.1",
        "session.next.provider.attempt.ended.1",
        "session.next.turn.ended.1",
        "session.next.input.terminalized.1",
      ])
      // Repeated terminalize with the same lease is an idempotent no-op.
      const again = yield* store.terminalize({ lease, outcome: "completed" })
      expect(again).toMatchObject({ state: "idle" })
      const terminalRows = yield* db
        .select({ id: EventTable.id })
        .from(EventTable)
        .where(
          and(eq(EventTable.aggregate_id, session.id), eq(EventTable.type, "session.next.input.terminalized.1")),
        )
        .all()
        .pipe(Effect.orDie)
      expect(terminalRows).toHaveLength(1)
    }),
  )

  it.effect("interrupt is idempotent and never duplicates terminal facts", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { session, admitted } = yield* makeKernelSession(sessions)
      const lease = yield* store.start(startInput(session.id, admitted.id))
      const accepted = yield* store.acceptInterrupt({
        sessionID: session.id,
        expectedGeneration: lease.generation,
        reason: "user",
      })
      expect(accepted).toMatchObject({ state: "cancelling", generation: 2 })
      expect(accepted.lease).toBeUndefined()
      // Repeated interrupt with the stale generation is a no-op.
      const repeated = yield* store.acceptInterrupt({
        sessionID: session.id,
        expectedGeneration: lease.generation,
        reason: "user",
      })
      expect(repeated.generation).toBe(2)
      expect(repeated.state).toBe("cancelling")
    }),
  )

  it.effect("idle interruption is a no-op", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionV2.Service
      const store = yield* LifecycleStore.Service
      const { session } = yield* makeKernelSession(sessions)
      const snapshot = yield* store.acceptInterrupt({ sessionID: session.id, reason: "user" })
      expect(snapshot).toMatchObject({ state: "idle", generation: 0 })
    }),
  )

  it.effect("missing sessions fail with NotFoundError", () =>
    Effect.gen(function* () {
      const store = yield* LifecycleStore.Service
      const missing = SessionV2.ID.make("ses_missing_execution")
      const error = yield* store.get(missing).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: "Session.NotFoundError", sessionID: missing })
    }),
  )
})

// A minimal durable kernel checkpoint-style event for sequence assertions.
const KernelCheckpointEvent = EventV2.define({
  type: "kernel.checkpoint.1",
  durable: { version: 1, aggregate: "sessionID" },
  schema: { sessionID: SessionV2.ID, text: Schema.String },
})
