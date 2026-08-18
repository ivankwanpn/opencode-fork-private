export * as SessionV2 from "./session"
export * from "./session/schema"

import { Cause, Context, DateTime, Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { ListAnchor } from "@opencode-ai/schema/session"
import { and, asc, desc, eq, gte, gt, isNull, like, lt, or, sql, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { AgentV2 } from "./agent"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { SessionMessage } from "./session/message"
import { Prompt } from "./session/prompt"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { EventV2 } from "./event"
import { Database } from "./database/database"
import { SessionProjector } from "./session/projector"
import { SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { fromRow } from "./session/info"
import { mutateSession, rowToSnapshot, type SnapshotTransform } from "./session/mutation"
import { SessionRunner } from "./session/runner/index"
import { SessionStore } from "./session/store"
import { SessionExecution } from "./session/execution"
import { SessionShell } from "./session/shell"
import { makeGlobalNode } from "./effect/app-node"
import { LocationServiceMap } from "./location-service-map"
import { MessageDecodeError } from "./session/error"
import { SessionEvent } from "./session/event"
import { SessionInput } from "./session/input"
import { SessionAttachment } from "./session/attachment"
import { SessionAttempt } from "./session/attempt"
import { SessionCommand } from "./session/command"
import { SessionLifecycle } from "./session/lifecycle"
import { SessionPromptExpansion } from "./session/prompt-expansion"
import { PluginRuntime } from "./plugin/runtime"
import { SessionCompaction } from "./session/compaction"
import { SessionSkill } from "./session/skill"
import { Snapshot } from "./snapshot"
import { SessionRevert } from "./session/revert"
import { Revert } from "@opencode-ai/schema/revert"
import { SessionDurable } from "@opencode-ai/schema/durable-event-manifest"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"
import { SessionV1 } from "./v1/session"
import { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"
import type { PermissionV2 } from "./permission"
import { isDeepStrictEqual } from "node:util"

export const RevertState = Revert.State
export type RevertState = Revert.State

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export { ListAnchor }

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  orderBy: Schema.Literals(["created", "updated"]).pipe(Schema.optional),
  start: Schema.Finite.pipe(Schema.optional),
  parentID: Schema.NullOr(SessionSchema.ID).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
  directory: AbsolutePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

// The project variant must precede the directory variant: a query carrying
// {project, directory, subpath} would otherwise decode as ListDirectoryInput
// and silently drop the project scoping and subpath filter.
export const ListInput = Schema.Union([ListProjectInput, ListDirectoryInput, ListAllInput])
export type ListInput = typeof ListInput.Type

type CreateInput = SessionCommand.CreateInput

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
  reason?: "manual" | "auto"
}

function forkTitle(title: string) {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (!match) return `${title} (fork #1)`
  return `${match[1]} (fork #${Number.parseInt(match[2], 10) + 1})`
}

function forkMessage(
  message: SessionMessage.Message,
  id: SessionMessage.ID,
  sessionID: SessionSchema.ID,
  ids: ReadonlyMap<SessionMessage.ID, SessionMessage.ID>,
): SessionMessage.Message {
  if (message.type === "synthetic") return { ...message, id, sessionID }
  if (message.type === "shell") return { ...message, id, userID: message.userID ? ids.get(message.userID) : undefined }
  return { ...message, id }
}

const promptedEventID = (inputID: SessionMessage.ID) => EventV2.ID.make(`evt_prompted_${inputID}`)

export const Status = SessionAttempt.Status
export type Status = SessionAttempt.Status

export const RecoveryInput = Schema.Struct({
  sessionID: SessionSchema.ID,
  attemptID: EventV2.ID,
  decision: Schema.Literals(["retry", "abandon"]),
}).annotate({ identifier: "SessionRecoveryInput" })
export type RecoveryInput = typeof RecoveryInput.Type

export const RecoveryConflictError = SessionAttempt.RecoveryConflictError
export type RecoveryConflictError = SessionAttempt.RecoveryConflictError

export const NotFoundError = SessionCommand.NotFoundError
export type NotFoundError = SessionCommand.NotFoundError

export class SkillNotFoundError extends Schema.TaggedErrorClass<SkillNotFoundError>()("Session.SkillNotFoundError", {
  sessionID: SessionSchema.ID,
  skill: Schema.String,
  available: Schema.Array(Schema.String),
}) {}

export { ContextSnapshotDecodeError, MessageDecodeError } from "./session/error"

export const PromptConflictError = SessionCommand.PromptConflictError
export type PromptConflictError = SessionCommand.PromptConflictError
export const ActiveAttemptConflictError = SessionCommand.ActiveAttemptConflictError
export type ActiveAttemptConflictError = SessionCommand.ActiveAttemptConflictError
export const TurnConflictError = SessionCommand.TurnConflictError
export type TurnConflictError = SessionCommand.TurnConflictError
export class InputConflictError extends Schema.TaggedErrorClass<InputConflictError>()("Session.InputConflictError", {
  sessionID: SessionSchema.ID,
  inputID: SessionMessage.ID,
}) {}
export const CommandNotFoundError = SessionPromptExpansion.CommandNotFoundError
export type CommandNotFoundError = SessionPromptExpansion.CommandNotFoundError
export const AgentNotFoundError = SessionPromptExpansion.AgentNotFoundError
export type AgentNotFoundError = SessionPromptExpansion.AgentNotFoundError
export type CommandExpansionError = SessionPromptExpansion.Error
export const BusyError = SessionExecution.BusyError
export type BusyError = SessionExecution.BusyError
export const MessageNotFoundError = SessionRevert.MessageNotFoundError
export type MessageNotFoundError = SessionRevert.MessageNotFoundError
export class MessageConflictError extends Schema.TaggedErrorClass<MessageConflictError>()(
  "Session.MessageConflictError",
  {
    sessionID: SessionSchema.ID,
    messageID: SessionMessage.ID,
  },
) {}

export type Error =
  | NotFoundError
  | MessageDecodeError
  | PromptConflictError
  | ActiveAttemptConflictError
  | TurnConflictError
  | InputConflictError
  | MessageConflictError
  | SessionCommand.RestoreConflictError
  | CommandExpansionError
  | BusyError
  | SkillNotFoundError
  | RecoveryConflictError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info>
  readonly restore: (
    input: SessionCommand.RestoreInput,
  ) => Effect.Effect<SessionSchema.Info, SessionCommand.RestoreConflictError>
  readonly fork: (input: {
    sessionID: SessionSchema.ID
    messages: readonly SessionMessage.Message[]
  }) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly children: (parentID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info[], NotFoundError>
  readonly update: (input: {
    sessionID: SessionSchema.ID
    title?: string
    archived?: DateTime.Utc | null
    metadata?: NonNullable<SessionSchema.Info["metadata"]> | null
    share?: NonNullable<SessionSchema.Info["share"]> | null
  }) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly permissions: (sessionID: SessionSchema.ID) => Effect.Effect<PermissionV2.Ruleset, NotFoundError>
  readonly setPermissions: (input: {
    sessionID: SessionSchema.ID
    permissions: PermissionV2.Ruleset
  }) => Effect.Effect<void, NotFoundError>
  readonly remove: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly message: (input: {
    sessionID: SessionSchema.ID
    messageID: SessionMessage.ID
  }) => Effect.Effect<SessionMessage.Message | undefined>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly plan: (sessionID: SessionSchema.ID) => Effect.Effect<string, NotFoundError>
  readonly events: (input: {
    sessionID: SessionSchema.ID
    after?: number
  }) => Stream.Stream<SessionEvent.DurableEvent, NotFoundError>
  readonly history: (input: {
    sessionID: SessionSchema.ID
    after?: number
    limit: number
  }) => Effect.Effect<{ events: ReadonlyArray<SessionEvent.DurableEvent>; hasMore: boolean }, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, NotFoundError>
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly prompt: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    model?: ModelV2.Ref
    delivery?: SessionInput.Delivery
    intent?: SessionInput.Intent
    expectedActiveAttemptID?: EventV2.ID
    resume?: boolean
    commit?: boolean
  }) =>
    Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError | ActiveAttemptConflictError | TurnConflictError>
  readonly command: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    command: string
    arguments: string
    agent?: AgentV2.ID
    model?: ModelV2.Ref
    variant?: ModelV2.VariantID
    files?: readonly PromptInput.FileAttachment[]
    delivery?: SessionInput.Delivery
    intent?: SessionInput.Intent
    expectedActiveAttemptID?: EventV2.ID
    resume?: boolean
    commit?: boolean
  }) => Effect.Effect<
    SessionInput.Admitted,
    NotFoundError | PromptConflictError | ActiveAttemptConflictError | TurnConflictError | CommandExpansionError
  >
  readonly pending: (input: {
    sessionID: SessionSchema.ID
    delivery?: SessionInput.Delivery
  }) => Effect.Effect<ReadonlyArray<SessionInput.Admitted>, NotFoundError>
  readonly findInput: (input: {
    sessionID: SessionSchema.ID
    inputID: SessionMessage.ID
  }) => Effect.Effect<SessionInput.Admitted | undefined, NotFoundError>
  readonly promoteInput: (input: {
    sessionID: SessionSchema.ID
    inputID: SessionMessage.ID
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | InputConflictError>
  readonly cancelInput: (input: {
    sessionID: SessionSchema.ID
    inputID: SessionMessage.ID
  }) => Effect.Effect<void, NotFoundError | InputConflictError>
  readonly shell: (input: {
    id?: EventV2.ID
    userID?: SessionMessage.ID
    sessionID: SessionSchema.ID
    command: string
    agent?: AgentV2.ID
    model?: ModelV2.Ref
    resume?: boolean
  }) => Effect.Effect<void, NotFoundError | BusyError>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    skill: string
    resume?: boolean
  }) => Effect.Effect<void, NotFoundError | SkillNotFoundError>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | BusyError>
  readonly summarize: (input: {
    sessionID: SessionSchema.ID
    model?: ModelV2.Ref
    auto?: boolean
  }) => Effect.Effect<void, NotFoundError | BusyError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly active: Effect.Effect<ReadonlySet<SessionSchema.ID>>
  readonly status: (sessionID: SessionSchema.ID) => Effect.Effect<Status, NotFoundError>
  readonly recover: (input: RecoveryInput) => Effect.Effect<void, NotFoundError | RecoveryConflictError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | SessionRunner.RunError>
  readonly interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly transcript: {
    readonly importMessage: (input: {
      sessionID: SessionSchema.ID
      message: SessionMessage.Message
    }) => Effect.Effect<void, NotFoundError | MessageConflictError>
    readonly removeMessage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
    }) => Effect.Effect<void, NotFoundError | MessageNotFoundError>
    readonly updateUserText: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      partID: string
      text: string
    }) => Effect.Effect<void, NotFoundError | MessageNotFoundError>
    readonly removeUserText: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      partID: string
    }) => Effect.Effect<void, NotFoundError | MessageNotFoundError>
    readonly updateContent: (input: {
      sessionID: SessionSchema.ID
      assistantMessageID: SessionMessage.ID
      contentIndex: number
      partID: string
      content: SessionMessage.AssistantContent
    }) => Effect.Effect<void, NotFoundError | MessageNotFoundError>
    readonly removeContent: (input: {
      sessionID: SessionSchema.ID
      assistantMessageID: SessionMessage.ID
      contentIndex: number
      partID: string
    }) => Effect.Effect<void, NotFoundError | MessageNotFoundError>
  }
  readonly revert: {
    readonly stage: (input: {
      sessionID: SessionSchema.ID
      messageID: SessionMessage.ID
      partID?: string
      contentIndex?: number
      removedMessageIDs?: SessionMessage.ID[]
      files?: boolean
    }) => Effect.Effect<Revert.State, NotFoundError | MessageNotFoundError | Snapshot.Error>
    readonly clear: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError | Snapshot.Error>
    readonly commit: (sessionID: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const commands = yield* SessionCommand.Service
    const events = yield* EventV2.Service
    const execution = yield* SessionExecution.Service
    const store = yield* SessionStore.Service
    const locations = yield* LocationServiceMap.Service
    const scope = yield* Scope.Scope
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)
    const encodeMessage = Schema.encodeSync(SessionMessage.Message)
    const isDurableSessionEvent = Schema.is(SessionEvent.Durable)
    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )
    const mutate = (sessionID: SessionSchema.ID, next: SnapshotTransform) => mutateSession(db, events, sessionID, next)

    const publishCompatibilityUpdate = Effect.fn("V2Session.publishCompatibilityUpdate")(function* (
      sessionID: SessionSchema.ID,
    ) {
      // Identity next: the compat echo must NOT bump time.updated (revert projections already
      // set it); the expectedSeq guard in mutateSession keeps this full-snapshot echo from
      // clobbering a canonical mutation's projection when interleaved.
      return yield* mutate(sessionID, (snapshot) => snapshot)
    })

    const commitStagedRevert = Effect.fn("V2Session.commitStagedRevert")(function* (
      session: SessionSchema.Info,
    ) {
      if (!session.revert) return session
      yield* SessionRevert.commit(session).pipe(Effect.provideService(EventV2.Service, events))
      return yield* publishCompatibilityUpdate(session.id)
    })
    const prepareStart = Effect.fn("V2Session.prepareStart")(function* (
      sessionID: SessionSchema.ID,
      intent: SessionInput.Intent | undefined,
    ) {
      if (intent?.type !== "start") return
      yield* execution
        .exclusive(
          sessionID,
          SessionLifecycle.reconcileForStart(db, store, events, sessionID),
        )
        .pipe(Effect.catchTag("Session.ExecutionBusyError", () => Effect.void))
    })

    const result = Service.of({
      create: commands.create,
      restore: commands.restore,
      fork: Effect.fn("V2Session.fork")(function* (input) {
        const source = yield* result.get(input.sessionID)
        const target = yield* commands.create({
          title: forkTitle(source.title),
          agent: source.agent,
          model: source.model,
          metadata: source.metadata,
          location: source.location,
        })
        const ids = new Map<SessionMessage.ID, SessionMessage.ID>()
        for (const message of input.messages) {
          const id = SessionMessage.ID.create()
          ids.set(message.id, id)
          yield* events.publish(
            SessionEvent.MessageImported,
            {
              sessionID: target.id,
              timestamp: yield* DateTime.now,
              message: forkMessage(message, id, target.id, ids),
            },
            { location: target.location },
          )
        }
        return yield* result.get(target.id)
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const session = yield* store.get(sessionID)
        if (!session) return yield* new NotFoundError({ sessionID })
        return session
      }),
      children: Effect.fn("V2Session.children")(function* (parentID) {
        yield* result.get(parentID)
        const rows = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.parent_id, parentID))
          .orderBy(asc(SessionTable.time_created), asc(SessionTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map(fromRow)
      }),
      update: Effect.fn("V2Session.update")(function* (input) {
        return yield* mutate(input.sessionID, (snapshot, timestamp) =>
          SessionEvent.SessionSnapshot.make({
            ...snapshot,
            title: input.title ?? snapshot.title,
            metadata:
              input.metadata === undefined ? snapshot.metadata : input.metadata === null ? undefined : input.metadata,
            share: input.share === undefined ? snapshot.share : input.share === null ? undefined : input.share,
            time: {
              ...snapshot.time,
              updated: timestamp,
              archived:
                input.archived === undefined
                  ? snapshot.time.archived
                  : input.archived === null
                    ? undefined
                    : input.archived,
            },
          }),
        )
      }),
      permissions: Effect.fn("V2Session.permissions")(function* (sessionID) {
        // Single query: a delete between an existence check and the permission read
        // would otherwise surface an empty ruleset instead of NotFoundError.
        const row = yield* db
          .select({ permission: SessionTable.permission })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ sessionID })
        return row.permission ? [...row.permission] : []
      }),
      setPermissions: Effect.fn("V2Session.setPermissions")(function* (input) {
        yield* mutate(input.sessionID, (snapshot, timestamp) =>
          SessionEvent.SessionSnapshot.make({
            ...snapshot,
            permission: [...input.permissions],
            time: { ...snapshot.time, updated: timestamp },
          }),
        )
      }),
      remove: Effect.fn("V2Session.remove")(function* (sessionID) {
        const row = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ sessionID })
        yield* result.interrupt(sessionID)
        const childRows = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.parent_id, sessionID))
          .orderBy(asc(SessionTable.time_created), asc(SessionTable.id))
          .all()
          .pipe(Effect.orDie)
        for (const child of childRows) yield* result.remove(child.id)
        const timestamp = yield* DateTime.now
        yield* events.publish(
          SessionEvent.Deleted,
          { timestamp, sessionID, info: rowToSnapshot(row) },
          {
            location: fromRow(row).location,
            // The projector, history purge, sequence advance, and tombstone
            // insert must commit together. A separate purge can strand a live
            // projection without replayable history if the process stops
            // before the Deleted event is committed.
            replaceAggregate: true,
          },
        )
      }),
      list: Effect.fn("V2Session.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = input.orderBy === "updated" ? SessionTable.time_updated : SessionTable.time_created
        const conditions: SQL[] = []
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input && input.subpath !== undefined) {
          // V1 parity: an empty path disables both the path and directory filters.
          if (input.subpath !== "") {
            const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)
            const pathConditions = [
              eq(SessionTable.path, input.subpath),
              sql`${SessionTable.path} LIKE ${`${escapeLike(input.subpath)}/%`} ESCAPE '\\'`,
            ]
            conditions.push(
              input.directory !== undefined
                ? or(...pathConditions, and(or(isNull(SessionTable.path), eq(SessionTable.path, "")), eq(SessionTable.directory, input.directory))!)!
                : or(...pathConditions)!,
            )
          }
        } else if ("directory" in input && input.directory !== undefined) {
          conditions.push(eq(SessionTable.directory, input.directory))
        }
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.parentID === null) conditions.push(isNull(SessionTable.parent_id))
        if (input.parentID !== undefined && input.parentID !== null)
          conditions.push(eq(SessionTable.parent_id, input.parentID))
        if (input.start !== undefined) conditions.push(gte(SessionTable.time_updated, input.start))
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const anchor = input.cursor
          ? yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (input.cursor && !anchor) return []
        const boundary = anchor
          ? order === "asc"
            ? gt(SessionMessageTable.seq, anchor.seq)
            : lt(SessionMessageTable.seq, anchor.seq)
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(where)
          .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, decode)
      }),
      message: Effect.fn("V2Session.message")(function* (input) {
        const stored = yield* store.message(input.messageID)
        return stored?.sessionID === input.sessionID ? stored.message : undefined
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* store.context(sessionID)
      }),
      plan: commands.plan,
      events: (input) =>
        Stream.unwrap(
          result
            .get(input.sessionID)
            .pipe(Effect.as(events.durable({ aggregateID: input.sessionID, after: input.after }))),
        ).pipe(Stream.filter((event): event is SessionEvent.DurableEvent => isDurableSessionEvent(event))),
      history: Effect.fn("V2Session.history")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* EventV2.readAggregate(db, {
          ...input,
          aggregateID: input.sessionID,
          manifest: SessionDurable,
        })
      }),
      prompt: Effect.fn("V2Session.prompt")((input) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const current = yield* result.get(input.sessionID)
            const session = yield* commitStagedRevert(current)
            yield* prepareStart(input.sessionID, input.intent)
            const prepared = yield* Effect.gen(function* () {
              const plugins = yield* PluginRuntime.Service
              const attachment = yield* SessionAttachment.Service
              const expansion = yield* SessionPromptExpansion.Service
              const prompt = SessionPromptExpansion.hasMentions(input.prompt.text)
                ? yield* expansion.resolve(input.prompt)
                : input.prompt
              return { plugins, attachment, expansion, prompt }
            }).pipe(Effect.provide(locations.get(session.location)), Effect.orDie)
            const admitted = yield* commands.admit({
              id: input.id,
              sessionID: input.sessionID,
              prompt: prepared.prompt,
              model: input.model,
              delivery: input.delivery,
              intent: input.intent,
              expectedActiveAttemptID: input.expectedActiveAttemptID,
              plugins: prepared.plugins,
              materialize: (prompt, agent) =>
                prepared.expansion
                  .materializeAgents(prompt, agent)
                  .pipe(Effect.flatMap(prepared.attachment.materialize)),
            })
            if (input.commit === true) {
              yield* SessionInput.promote(db, events, admitted.sessionID, admitted.id)
              return admitted
            }
            if (input.resume !== false)
              yield* restore(execution.wake(admitted.sessionID)).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.forkIn(scope, { startImmediately: true }),
                Effect.asVoid,
              )
            return admitted
          }),
        ),
      ),
      command: Effect.fn("V2Session.command")((input) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const current = yield* result.get(input.sessionID)
            const session = yield* commitStagedRevert(current)
            yield* prepareStart(input.sessionID, input.intent)
            const messageID = input.id ?? SessionMessage.ID.create()
            const prepared = yield* Effect.gen(function* () {
              const plugins = yield* PluginRuntime.Service
              const attachment = yield* SessionAttachment.Service
              const expansion = yield* SessionPromptExpansion.Service
              const command = yield* expansion
                .command({
                  session,
                  messageID,
                  command: input.command,
                  arguments: input.arguments,
                  agent: input.agent,
                  model: input.model,
                  variant: input.variant,
                  files: input.files,
                })
                .pipe(
                  Effect.map((value) => ({ ok: true as const, value })),
                  Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
                )
              return { plugins, attachment, expansion, command }
            }).pipe(Effect.provide(locations.get(session.location)), Effect.orDie)
            if (!prepared.command.ok) return yield* prepared.command.error
            const resolved = prepared.command.value
            const admitted = yield* commands.admit({
              id: messageID,
              sessionID: input.sessionID,
              prompt: resolved.prompt,
              delivery: input.delivery,
              intent: input.intent,
              expectedActiveAttemptID: input.expectedActiveAttemptID,
              plugins: prepared.plugins,
              agent: resolved.agent,
              model: resolved.model,
              materialize: (prompt, agent) =>
                prepared.expansion
                  .materializeAgents(prompt, agent)
                  .pipe(Effect.flatMap(prepared.attachment.materialize)),
            })
            yield* events.publish(LegacyEvent.CommandExecuted, {
              name: input.command,
              sessionID: input.sessionID,
              arguments: input.arguments,
              messageID: SessionV1.MessageID.make(admitted.id),
            })
            if (input.commit === true) {
              yield* SessionInput.promote(db, events, admitted.sessionID, admitted.id)
              return admitted
            }
            if (input.resume !== false)
              yield* restore(execution.wake(admitted.sessionID)).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.forkIn(scope, { startImmediately: true }),
                Effect.asVoid,
              )
            return admitted
          }),
        ),
      ),
      pending: Effect.fn("V2Session.pending")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* SessionInput.pending(db, input.sessionID, input.delivery)
      }),
      findInput: Effect.fn("V2Session.findInput")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* SessionInput.findForSession(db, input.sessionID, input.inputID)
      }),
      promoteInput: Effect.fn("V2Session.promoteInput")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* result.get(input.sessionID)
            const existing = yield* SessionInput.findForSession(db, input.sessionID, input.inputID)
            if (existing === undefined)
              return yield* new InputConflictError({ sessionID: input.sessionID, inputID: input.inputID })
            if (existing.promotedSeq !== undefined) return existing

            yield* events
              .publish(
                SessionEvent.Prompted,
                {
                  sessionID: input.sessionID,
                  timestamp: existing.timeCreated,
                  messageID: existing.id,
                  prompt: existing.prompt,
                  synthetic: existing.synthetic,
                  delivery: existing.delivery,
                  intent: existing.intent,
                },
                { id: promptedEventID(existing.id) },
              )
              .pipe(
                Effect.catchDefect((defect) =>
                  defect instanceof SessionInput.LifecycleConflict || defect instanceof EventV2.InvalidDurableEventError
                    ? Effect.void
                    : Effect.die(defect),
                ),
              )

            const current = yield* SessionInput.findForSession(db, input.sessionID, input.inputID)
            if (current?.promotedSeq !== undefined) return current
            return yield* new InputConflictError({ sessionID: input.sessionID, inputID: input.inputID })
          }),
        ),
      ),
      cancelInput: Effect.fn("V2Session.cancelInput")(function* (input) {
        yield* result.get(input.sessionID)
        const outcome = yield* SessionInput.cancelPending(db, input.sessionID, input.inputID)
        if (outcome === "cancelled") return
        return yield* new InputConflictError({ sessionID: input.sessionID, inputID: input.inputID })
      }),
      shell: Effect.fn("V2Session.shell")(function* (input) {
        let session = yield* result.get(input.sessionID)
        session = yield* commitStagedRevert(session)
        if (input.agent !== undefined && session.agent !== input.agent) {
          yield* result.switchAgent({ sessionID: input.sessionID, agent: input.agent })
          session = yield* result.get(input.sessionID)
        }
        if (input.model !== undefined) {
          yield* result.switchModel({ sessionID: input.sessionID, model: input.model })
          session = yield* result.get(input.sessionID)
        }
        const callID = input.id ?? EventV2.ID.create()
        const messageID = SessionMessage.ID.create()
        const work = Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* events.publish(
              SessionEvent.Shell.Started,
              {
                sessionID: session.id,
                messageID,
                userID: input.userID,
                timestamp: yield* DateTime.now,
                callID,
                command: input.command,
              },
              { id: callID, location: session.location },
            )

            let output = ""
            let aborted = false
            const exit = yield* restore(
              SessionShell.Service.use((shell) =>
                shell.execute({
                  command: input.command,
                  cwd: session.location.directory,
                  sessionID: session.id,
                  callID,
                  onOutput: (chunk) =>
                    Effect.gen(function* () {
                      output += chunk
                      yield* events.publish(
                        SessionEvent.Shell.Delta,
                        {
                          sessionID: session.id,
                          timestamp: yield* DateTime.now,
                          callID,
                          delta: chunk,
                        },
                        { location: session.location },
                      )
                    }),
                }),
              ).pipe(Effect.provide(locations.get(session.location)), Effect.orDie),
            ).pipe(Effect.exit)

            if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
              aborted = true
              output += `\n\n<metadata>\nUser aborted the command\n</metadata>`
            }
            yield* events.publish(
              SessionEvent.Shell.Ended,
              {
                sessionID: session.id,
                timestamp: yield* DateTime.now,
                callID,
                output,
              },
              { location: session.location },
            )

            if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause))
              return yield* Effect.failCause(exit.cause)
            if (!aborted && input.resume !== false) yield* execution.wake(session.id)
          }),
        )

        yield* execution.exclusive(session.id, work)
      }),
      skill: Effect.fn("V2Session.skill")(function* (input) {
        const session = yield* result.get(input.sessionID)
        const resolved = yield* SessionSkill.Service.use((skills) =>
          skills.resolve({ session, name: input.skill }),
        ).pipe(Effect.provide(locations.get(session.location)), Effect.orDie)
        const text = resolved.text
        if (text === undefined)
          return yield* new SkillNotFoundError({
            sessionID: session.id,
            skill: input.skill,
            available: resolved.available,
          })

        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* events.publish(
              SessionEvent.Synthetic,
              {
                sessionID: session.id,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                text,
              },
              {
                id: input.id ?? EventV2.ID.create(),
                location: session.location,
              },
            )
            if (input.resume !== false) yield* execution.wake(session.id)
          }),
        )
      }),
      switchAgent: commands.switchAgent,
      switchModel: commands.switchModel,
      compact: Effect.fn("V2Session.compact")(function* (input) {
        const session = yield* result.get(input.sessionID)
        let shouldContinue = false
        const work = Effect.gen(function* () {
          yield* events.publish(
            SessionEvent.Status,
            { timestamp: yield* DateTime.now, sessionID: session.id, status: { type: "busy" } },
            { location: session.location },
          )
          yield* Effect.ensuring(
            SessionCompaction.Service.use((compaction) =>
              compaction.compact({
                session,
                prompt: input.prompt,
                reason: input.reason ?? "manual",
              }),
            ).pipe(
              Effect.provide(locations.get(session.location)),
              Effect.orDie,
              Effect.tap((outcome) =>
                Effect.sync(() => {
                  shouldContinue = outcome.shouldContinue
                }),
              ),
              Effect.asVoid,
            ),
            Effect.gen(function* () {
              yield* events.publish(
                SessionEvent.Status,
                { timestamp: yield* DateTime.now, sessionID: session.id, status: { type: "idle" } },
                { location: session.location },
              )
              yield* events.publish(
                SessionStatusEvent.Idle,
                { sessionID: session.id },
                { location: session.location },
              )
            }).pipe(Effect.asVoid),
          )
        })
        yield* execution.exclusive(session.id, work)
        if (shouldContinue) yield* execution.resume(session.id).pipe(Effect.orDie)
      }),
      summarize: Effect.fn("V2Session.summarize")(function* (input) {
        const session = yield* result.get(input.sessionID)
        yield* commitStagedRevert(session)
        if (input.model !== undefined) {
          yield* result.switchModel({ sessionID: session.id, model: input.model })
        }
        yield* result.compact({ sessionID: session.id, reason: input.auto === true ? "auto" : "manual" })
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.wait(sessionID)
      }),
      active: execution.active,
      status: Effect.fn("V2Session.status")(function* (sessionID) {
        yield* result.get(sessionID)
        const active = yield* execution.active
        return yield* SessionAttempt.status(db, sessionID, active.has(sessionID))
      }),
      recover: Effect.fn("V2Session.recover")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* result.get(input.sessionID)
            const conflict = (message: string) =>
              new RecoveryConflictError({
                sessionID: input.sessionID,
                attemptID: input.attemptID,
                message,
              })
            const existing = yield* SessionAttempt.recoveryDecision(db, input.sessionID, input.attemptID)
            if (existing !== undefined) {
              if (existing !== input.decision)
                return yield* conflict(`Recovery attempt was already resolved with ${existing}`)
              if (existing === "retry") {
                const row = yield* SessionAttempt.get(db, input.sessionID)
                if (row?.status === "continuation" && row.decision === "retry" && row.retry_of === input.attemptID)
                  yield* execution.wake(input.sessionID)
              }
              return
            }

            const work = Effect.gen(function* () {
              const decided = yield* SessionAttempt.recoveryDecision(db, input.sessionID, input.attemptID)
              if (decided !== undefined) {
                if (decided === input.decision) return
                return yield* conflict(`Recovery attempt was already resolved with ${decided}`)
              }
              const row = yield* SessionAttempt.get(db, input.sessionID)
              if (!row || row.attempt_id !== input.attemptID)
                return yield* conflict("Recovery attempt is not the current provider attempt")
              if (row.status !== "started" && row.status !== "responding")
                return yield* conflict(`Provider attempt cannot be recovered from ${row.status}`)

              yield* SessionLifecycle.settleAssistant(store, events, {
                sessionID: input.sessionID,
                assistantMessageID: row.assistant_message_id,
                message: "Provider turn interrupted",
              })
              yield* events.publish(SessionEvent.ProviderAttempt.Recovery.Decided, {
                sessionID: input.sessionID,
                attemptID: input.attemptID,
                timestamp: yield* DateTime.now,
                decision: input.decision,
              })
            })
            yield* execution
              .exclusive(input.sessionID, work)
              .pipe(
                Effect.catchTag("Session.ExecutionBusyError", () =>
                  Effect.fail(conflict("Session execution is currently active")),
                ),
              )
            if (input.decision === "retry") yield* execution.wake(input.sessionID)
          }),
        ),
      ),
      resume: Effect.fn("V2Session.resume")(function* (sessionID) {
        yield* result.get(sessionID)
        yield* execution.resume(sessionID)
      }),
      interrupt: Effect.fn("V2Session.interrupt")((sessionID) =>
        Effect.uninterruptible(execution.interrupt(sessionID)),
      ),
      transcript: {
        importMessage: Effect.fn("V2Session.transcript.importMessage")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const stored = yield* store.message(input.message.id)
          if (stored) {
            if (
              stored.sessionID === input.sessionID &&
              isDeepStrictEqual(encodeMessage(stored.message), encodeMessage(input.message))
            )
              return
            return yield* new MessageConflictError({ sessionID: input.sessionID, messageID: input.message.id })
          }
          yield* events.publish(
            SessionEvent.MessageImported,
            { sessionID: input.sessionID, message: input.message, timestamp: yield* DateTime.now },
            { location: session.location },
          )
        }),
        removeMessage: Effect.fn("V2Session.transcript.removeMessage")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const stored = yield* store.message(input.messageID)
          if (stored?.sessionID !== input.sessionID) return yield* new MessageNotFoundError(input)
          yield* events.publish(
            SessionEvent.TranscriptMutation.MessageRemoved,
            { ...input, timestamp: yield* DateTime.now },
            { location: session.location },
          )
        }),
        updateUserText: Effect.fn("V2Session.transcript.updateUserText")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const stored = yield* store.message(input.messageID)
          if (stored?.sessionID !== input.sessionID || stored.message.type !== "user") {
            return yield* new MessageNotFoundError(input)
          }
          yield* events.publish(
            SessionEvent.TranscriptMutation.UserTextUpdated,
            { ...input, timestamp: yield* DateTime.now },
            { location: session.location },
          )
        }),
        removeUserText: Effect.fn("V2Session.transcript.removeUserText")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const stored = yield* store.message(input.messageID)
          if (stored?.sessionID !== input.sessionID || stored.message.type !== "user") {
            return yield* new MessageNotFoundError(input)
          }
          yield* events.publish(
            SessionEvent.TranscriptMutation.UserTextRemoved,
            { ...input, timestamp: yield* DateTime.now },
            { location: session.location },
          )
        }),
        updateContent: Effect.fn("V2Session.transcript.updateContent")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const stored = yield* store.message(input.assistantMessageID)
          if (
            stored?.sessionID !== input.sessionID ||
            stored.message.type !== "assistant" ||
            !stored.message.content[input.contentIndex]
          ) {
            return yield* new MessageNotFoundError({
              sessionID: input.sessionID,
              messageID: input.assistantMessageID,
            })
          }
          yield* events.publish(
            SessionEvent.TranscriptMutation.ContentUpdated,
            { ...input, timestamp: yield* DateTime.now },
            { location: session.location },
          )
        }),
        removeContent: Effect.fn("V2Session.transcript.removeContent")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const stored = yield* store.message(input.assistantMessageID)
          if (
            stored?.sessionID !== input.sessionID ||
            stored.message.type !== "assistant" ||
            !stored.message.content[input.contentIndex]
          ) {
            return yield* new MessageNotFoundError({
              sessionID: input.sessionID,
              messageID: input.assistantMessageID,
            })
          }
          yield* events.publish(
            SessionEvent.TranscriptMutation.ContentRemoved,
            { ...input, timestamp: yield* DateTime.now },
            { location: session.location },
          )
        }),
      },
      revert: {
        stage: Effect.fn("V2Session.revert.stage")(function* (input) {
          const session = yield* result.get(input.sessionID)
          const revert = yield* SessionRevert.stage({
            session,
            messageID: input.messageID,
            partID: input.partID,
            contentIndex: input.contentIndex,
            removedMessageIDs: input.removedMessageIDs,
            files: input.files,
          }).pipe(
            Effect.provideService(Database.Service, database),
            Effect.provideService(EventV2.Service, events),
            Effect.provide(locations.get(session.location)),
          )
          yield* publishCompatibilityUpdate(session.id)
          return revert
        }),
        clear: Effect.fn("V2Session.revert.clear")(function* (sessionID) {
          const session = yield* result.get(sessionID)
          yield* SessionRevert.clear(session).pipe(
            Effect.provideService(EventV2.Service, events),
            Effect.provide(locations.get(session.location)),
          )
          if (session.revert) yield* publishCompatibilityUpdate(session.id)
        }),
        commit: Effect.fn("V2Session.revert.commit")(function* (sessionID) {
          const session = yield* result.get(sessionID)
          yield* commitStagedRevert(session)
        }),
      },
    })

    return result
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [
    Database.node,
    EventV2.node,
    ProjectV2.node,
    SessionCommand.node,
    SessionExecution.node,
    SessionStore.node,
    LocationServiceMap.node,
    SessionProjector.node,
  ],
})
