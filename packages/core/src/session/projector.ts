export * as SessionProjector from "./projector"

import { and, desc, eq, gt, gte, inArray, or, sql } from "drizzle-orm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { makeGlobalNode } from "../effect/app-node"
import { SessionEvent } from "./event"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { SessionMessage } from "./message"
import { SessionMessageUpdater } from "./message-updater"
import { SessionInput } from "./input"
import { WorkspaceV2 } from "../workspace"
import { SessionContextEpoch } from "./context-epoch"
import { SessionAttempt } from "./attempt"
import { SessionTurn } from "./turn"
import { SessionToolDiscovery } from "./tool-discovery"
import { SessionInputTable, SessionMessageTable, SessionTable } from "./sql"

type DatabaseService = Database.Interface["db"]

const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)
const encodeMessage = Schema.encodeSync(SessionMessage.Message)

export class SessionAlreadyProjected extends Error {}

type Usage = {
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: { read: number; write: number }
  }
}


function sessionRowFromSnapshot(snapshot: SessionEvent.SessionSnapshot): typeof SessionTable.$inferInsert {
  return {
    id: snapshot.id,
    project_id: snapshot.projectID,
    workspace_id: snapshot.location.workspaceID ?? null,
    parent_id: snapshot.parentID,
    slug: snapshot.slug,
    directory: snapshot.location.directory,
    path: snapshot.subpath,
    title: snapshot.title,
    agent: snapshot.agent,
    model: snapshot.model,
    version: snapshot.version,
    share_url: snapshot.share?.url ?? null,
    metadata: snapshot.metadata ?? null,
    cost: snapshot.cost,
    tokens_input: snapshot.tokens.input,
    tokens_output: snapshot.tokens.output,
    tokens_reasoning: snapshot.tokens.reasoning,
    tokens_cache_read: snapshot.tokens.cache.read,
    tokens_cache_write: snapshot.tokens.cache.write,
    revert: snapshot.revert
      ? { ...snapshot.revert, messageID: SessionMessage.ID.make(snapshot.revert.messageID) }
      : null,
    permission: snapshot.permission ? [...snapshot.permission] : undefined,
    time_created: DateTime.toEpochMillis(snapshot.time.created),
    time_updated: DateTime.toEpochMillis(snapshot.time.updated),
    time_compacting: snapshot.time.compacting ? DateTime.toEpochMillis(snapshot.time.compacting) : null,
    time_archived: snapshot.time.archived ? DateTime.toEpochMillis(snapshot.time.archived) : null,
  }
}

function applyUsage(
  db: DatabaseService,
  sessionID: SessionEvent.Step.Ended["data"]["sessionID"],
  value: Usage,
  sign = 1,
) {
  return db
    .update(SessionTable)
    .set({
      cost: sql`${SessionTable.cost} + ${value.cost * sign}`,
      tokens_input: sql`${SessionTable.tokens_input} + ${value.tokens.input * sign}`,
      tokens_output: sql`${SessionTable.tokens_output} + ${value.tokens.output * sign}`,
      tokens_reasoning: sql`${SessionTable.tokens_reasoning} + ${value.tokens.reasoning * sign}`,
      tokens_cache_read: sql`${SessionTable.tokens_cache_read} + ${value.tokens.cache.read * sign}`,
      tokens_cache_write: sql`${SessionTable.tokens_cache_write} + ${value.tokens.cache.write * sign}`,
      time_updated: sql`${SessionTable.time_updated}`,
    })
    .where(eq(SessionTable.id, sessionID))
    .run()
    .pipe(Effect.orDie)
}

function run(db: DatabaseService, event: SessionEvent.DurableEvent) {
  return Effect.gen(function* () {
    const decodeRow = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })
    const updateMessage = (message: SessionMessage.Message) => {
      if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
      const encoded = encodeMessage(message)
      const { id, type, ...data } = encoded
      return db
        .update(SessionMessageTable)
        .set({ type, time_created: DateTime.toEpochMillis(message.time.created), data })
        .where(
          and(
            eq(SessionMessageTable.id, SessionMessage.ID.make(id)),
            eq(SessionMessageTable.session_id, event.data.sessionID),
          ),
        )
        .run()
        .pipe(Effect.orDie)
    }
    const appendMessage = (message: SessionMessage.Message) => insertMessage(db, event, message)
    const adapter: SessionMessageUpdater.Adapter = {
      getCurrentAssistant() {
        return Effect.gen(function* () {
          // A newer turn supersedes stale incomplete rows; never resume an older assistant projection.
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "assistant")),
            )
            .orderBy(desc(SessionMessageTable.seq))
            .limit(1)
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" && !message.time.completed ? message : undefined
        })
      },
      getAssistant(messageID) {
        return Effect.gen(function* () {
          const row = yield* db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.id, messageID),
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.type, "assistant"),
              ),
            )
            .get()
            .pipe(Effect.orDie)
          if (!row) return
          const message = decodeRow(row)
          return message.type === "assistant" ? message : undefined
        })
      },
      getCurrentShell(callID) {
        return Effect.gen(function* () {
          const rows = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, event.data.sessionID), eq(SessionMessageTable.type, "shell")))
            .orderBy(desc(SessionMessageTable.seq))
            .all()
            .pipe(Effect.orDie)
          return rows
            .map(decodeRow)
            .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
        })
      },
      updateAssistant: updateMessage,
      updateShell: updateMessage,
      appendMessage,
    }
    yield* SessionMessageUpdater.update(adapter, event)
  })
}

function insertMessage(db: DatabaseService, event: SessionEvent.DurableEvent, message: SessionMessage.Message) {
  if (event.durable === undefined) return Effect.die("Durable Session event is missing aggregate sequence")
  const encoded = encodeMessage(message)
  const { id, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({
      id: SessionMessage.ID.make(id),
      session_id: event.data.sessionID,
      type,
      seq: event.durable.seq,
      time_created: DateTime.toEpochMillis(message.time.created),
      data,
    })
    .run()
    .pipe(Effect.orDie)
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.project(SessionEvent.Created, (event) =>
      Effect.gen(function* () {
        const stored = yield* db
          .insert(SessionTable)
          .values(sessionRowFromSnapshot(event.data.info))
          .onConflictDoNothing()
          .returning({ sessionID: SessionTable.id })
          .get()
          .pipe(Effect.orDie)
        if (!stored) return yield* Effect.die(new SessionAlreadyProjected())
        if (event.data.info.location.workspaceID) {
          yield* db
            .update(WorkspaceTable)
            .set({ time_used: Date.now() })
            .where(eq(WorkspaceTable.id, event.data.info.location.workspaceID))
            .run()
            .pipe(Effect.orDie)
        }
      }),
    )
    yield* events.project(SessionEvent.MessageImported, (event) => insertMessage(db, event, event.data.message))
    yield* events.project(SessionEvent.TranscriptMutation.MessageRemoved, (event) =>
      Effect.gen(function* () {
        yield* db
          .delete(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .run()
          .pipe(Effect.orDie)
        yield* db
          .delete(SessionInputTable)
          .where(
            and(eq(SessionInputTable.session_id, event.data.sessionID), eq(SessionInputTable.id, event.data.messageID)),
          )
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionEvent.TranscriptMutation.UserTextUpdated, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.die(`Transcript message not found: ${event.data.messageID}`)
        const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
        if (message.type !== "user")
          return yield* Effect.die(`Transcript message is not a user message: ${event.data.messageID}`)
        const encoded = encodeMessage(
          SessionMessage.User.make({
            ...message,
            text: event.data.text,
          }),
        )
        const { id: _, type: __, ...data } = encoded
        yield* db
          .update(SessionMessageTable)
          .set({ data })
          .where(eq(SessionMessageTable.id, event.data.messageID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionEvent.TranscriptMutation.UserTextRemoved, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.die(`Transcript message not found: ${event.data.messageID}`)
        const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
        if (message.type !== "user")
          return yield* Effect.die(`Transcript message is not a user message: ${event.data.messageID}`)
        const encoded = encodeMessage(
          SessionMessage.User.make({
            ...message,
            text: "",
          }),
        )
        const { id: _, type: __, ...data } = encoded
        yield* db
          .update(SessionMessageTable)
          .set({ data })
          .where(eq(SessionMessageTable.id, event.data.messageID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionEvent.TranscriptMutation.ContentUpdated, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.assistantMessageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.die(`Transcript message not found: ${event.data.assistantMessageID}`)
        const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
        if (message.type !== "assistant" || !message.content[event.data.contentIndex])
          return yield* Effect.die(`Transcript content not found: ${event.data.partID}`)
        const encoded = encodeMessage(
          SessionMessage.Assistant.make({
            ...message,
            content: message.content.map((content, index) =>
              index === event.data.contentIndex ? event.data.content : content,
            ),
          }),
        )
        const { id: _, type: __, ...data } = encoded
        yield* db
          .update(SessionMessageTable)
          .set({ data })
          .where(eq(SessionMessageTable.id, event.data.assistantMessageID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionEvent.TranscriptMutation.ContentRemoved, (event) =>
      Effect.gen(function* () {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.assistantMessageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* Effect.die(`Transcript message not found: ${event.data.assistantMessageID}`)
        const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
        if (message.type !== "assistant" || !message.content[event.data.contentIndex])
          return yield* Effect.die(`Transcript content not found: ${event.data.partID}`)
        const encoded = encodeMessage(
          SessionMessage.Assistant.make({
            ...message,
            content: message.content.filter((_, index) => index !== event.data.contentIndex),
          }),
        )
        const { id: _, type: __, ...data } = encoded
        yield* db
          .update(SessionMessageTable)
          .set({ data })
          .where(eq(SessionMessageTable.id, event.data.assistantMessageID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionEvent.Updated, (event) =>
      db
        .update(SessionTable)
        .set(sessionRowFromSnapshot(event.data.info))
        .where(eq(SessionTable.id, event.data.info.id))
        .run()
        .pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.Moved, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({
            directory: event.data.location.directory,
            path: event.data.subdirectory ?? null,
            workspace_id: event.data.location.workspaceID ? WorkspaceV2.ID.make(event.data.location.workspaceID) : null,
            time_updated: DateTime.toEpochMillis(event.data.timestamp),
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
    yield* events.project(SessionEvent.Deleted, (event) =>
      db.delete(SessionTable).where(eq(SessionTable.id, event.data.info.id)).run().pipe(Effect.orDie),
    )
    yield* events.project(SessionEvent.AgentSwitched, (event) =>
      db
        .update(SessionTable)
        .set({ agent: event.data.agent, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.andThen(run(db, event))),
    )
    yield* events.project(SessionEvent.ModelSwitched, (event) =>
      Effect.gen(function* () {
        yield* db
          .update(SessionTable)
          .set({ model: event.data.model, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* run(db, event)
      }),
    )
    yield* events.project(SessionEvent.Prompted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectPrompted(db, {
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          synthetic: event.data.synthetic,
          delivery: event.data.delivery,
          intent: event.data.intent,
          timeCreated: event.data.timestamp,
          promotedSeq: event.durable.seq,
        })
        yield* run(db, event)
      }),
    )
    yield* events.project(SessionEvent.PromptAdmitted, (event) =>
      Effect.gen(function* () {
        if (event.durable === undefined) return yield* Effect.die("Durable Session event is missing aggregate sequence")
        yield* SessionInput.projectAdmitted(db, {
          admittedSeq: event.durable.seq,
          id: event.data.messageID,
          sessionID: event.data.sessionID,
          prompt: event.data.prompt,
          synthetic: event.data.synthetic,
          delivery: event.data.delivery,
          intent: event.data.intent,
          timeCreated: event.data.timestamp,
        })
        yield* SessionTurn.projectAdmitted(db, event)
      }),
    )
    yield* events.project(SessionEvent.ContextUpdated, (event) => run(db, event))
    yield* events.project(SessionEvent.Synthetic, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Shell.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Step.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* applyUsage(db, event.data.sessionID, {
          cost: event.data.cost,
          tokens: event.data.tokens,
        })
      }),
    )
    yield* events.project(SessionEvent.Step.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Text.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Input.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Called, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Progress, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Success, (event) => run(db, event))
    yield* events.project(SessionEvent.Tool.Failed, (event) => run(db, event))
    yield* events.project(SessionEvent.ToolDiscovery.Completed, (event) =>
      SessionToolDiscovery.projectCompleted(db, event),
    )
    yield* events.project(SessionEvent.Reasoning.Started, (event) => run(db, event))
    yield* events.project(SessionEvent.Reasoning.Ended, (event) => run(db, event))
    yield* events.project(SessionEvent.ProviderAttempt.Started, (event) => SessionAttempt.projectStarted(db, event))
    yield* events.project(SessionEvent.ProviderAttempt.ResponseStarted, (event) =>
      SessionAttempt.projectResponseStarted(db, event),
    )
    yield* events.project(SessionEvent.ProviderAttempt.Ended, (event) => SessionAttempt.projectEnded(db, event))
    yield* events.project(SessionEvent.Turn.Started, (event) => SessionTurn.projectStarted(db, event))
    yield* events.project(SessionEvent.Turn.Ended, (event) => SessionTurn.projectEnded(db, event))
    yield* events.project(SessionEvent.ProviderAttempt.Recovery.Decided, (event) =>
      SessionAttempt.projectRecoveryDecided(db, event),
    )
    yield* events.project(SessionEvent.Retried, (event) => SessionAttempt.projectRetried(db, event))
    yield* events.project(SessionEvent.Compaction.Ended, (event) =>
      Effect.gen(function* () {
        yield* run(db, event)
        yield* db
          .update(SessionTable)
          .set({
            time_compacting: DateTime.toEpochMillis(event.data.timestamp),
            // Preserve time_updated: SessionTable.time_updated has an $onUpdate
            // hook that would otherwise stamp this projection as a user update.
            time_updated: sql`${SessionTable.time_updated}`,
          })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
    )
    yield* events.project(SessionEvent.RevertEvent.Staged, (event) =>
      db
        .update(SessionTable)
        .set({
          revert: { ...event.data.revert, files: event.data.revert.files ? [...event.data.revert.files] : undefined },
          time_updated: DateTime.toEpochMillis(event.data.timestamp),
        })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Cleared, (event) =>
      db
        .update(SessionTable)
        .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
        .where(eq(SessionTable.id, event.data.sessionID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid),
    )
    yield* events.project(SessionEvent.RevertEvent.Committed, (event) =>
      Effect.gen(function* () {
        const boundary = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, event.data.sessionID),
              eq(SessionMessageTable.id, event.data.messageID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!boundary) return yield* Effect.die(`Revert boundary message not found: ${event.data.messageID}`)
        if (event.data.contentIndex !== undefined) {
          const message = decodeMessage({ ...boundary.data, id: boundary.id, type: boundary.type })
          if (message.type !== "assistant")
            return yield* Effect.die(`Revert content boundary is not an assistant message: ${event.data.messageID}`)
          const encoded = encodeMessage(
            SessionMessage.Assistant.make({
              ...message,
              content: message.content.slice(0, event.data.contentIndex),
              finish: undefined,
              structured: undefined,
              cost: undefined,
              tokens: undefined,
              error: undefined,
              time: { created: message.time.created },
            }),
          )
          const { id: _, type: __, ...data } = encoded
          yield* db
            .update(SessionMessageTable)
            .set({ data })
            .where(
              and(
                eq(SessionMessageTable.session_id, event.data.sessionID),
                eq(SessionMessageTable.id, event.data.messageID),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        }
        if (event.data.removedMessageIDs) {
          if (event.data.removedMessageIDs.length > 0) {
            yield* db
              .delete(SessionMessageTable)
              .where(
                and(
                  eq(SessionMessageTable.session_id, event.data.sessionID),
                  inArray(SessionMessageTable.id, event.data.removedMessageIDs),
                ),
              )
              .run()
              .pipe(Effect.orDie)
          }
          yield* db
            .delete(SessionInputTable)
            .where(
              and(
                eq(SessionInputTable.session_id, event.data.sessionID),
                or(
                  gt(SessionInputTable.time_created, boundary.time_created),
                  and(
                    eq(SessionInputTable.time_created, boundary.time_created),
                    event.data.contentIndex === undefined
                      ? gte(SessionInputTable.id, event.data.messageID)
                      : gt(SessionInputTable.id, event.data.messageID),
                  ),
                ),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        } else {
          yield* db
            .delete(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, event.data.sessionID),
                event.data.contentIndex === undefined
                  ? gte(SessionMessageTable.seq, boundary.seq)
                  : gt(SessionMessageTable.seq, boundary.seq),
              ),
            )
            .run()
            .pipe(Effect.orDie)
          yield* db
            .delete(SessionInputTable)
            .where(
              and(
                eq(SessionInputTable.session_id, event.data.sessionID),
                event.data.contentIndex === undefined
                  ? or(
                      gte(SessionInputTable.admitted_seq, boundary.seq),
                      gte(SessionInputTable.promoted_seq, boundary.seq),
                    )
                  : or(
                      gt(SessionInputTable.admitted_seq, boundary.seq),
                      gt(SessionInputTable.promoted_seq, boundary.seq),
                    ),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        }
        yield* db
          .update(SessionTable)
          .set({ revert: null, time_updated: DateTime.toEpochMillis(event.data.timestamp) })
          .where(eq(SessionTable.id, event.data.sessionID))
          .run()
          .pipe(Effect.orDie)
        yield* SessionContextEpoch.reset(db, event.data.sessionID)
      }),
    )
  }),
)

export const node = makeGlobalNode({ name: "session-projector", layer, deps: [EventV2.node, Database.node] })
