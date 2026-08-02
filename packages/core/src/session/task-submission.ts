export * as TaskSubmission from "./task-submission"

import { and, eq, isNull, or, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Identifier } from "../id/id"
import { makeGlobalNode } from "../effect/app-node"
import { Hash } from "../util/hash"
import { Prompt } from "./prompt"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionAttemptTable, SessionInputTable, TaskNotificationOutboxTable, TaskSubmissionTable } from "./sql"

export type Identity = {
  readonly parentSessionID: SessionSchema.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
  readonly prompt: Prompt
}

export type Invocation = Identity & {
  readonly childSessionID: SessionSchema.ID
  readonly description: string
  readonly agent: string
  readonly agentPath?: string
  readonly model?: unknown
}

export type Outcome = "completed" | "error" | "cancelled" | "recovery-required"

export type Info = {
  readonly id: string
  readonly parentSessionID: SessionSchema.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
  readonly childSessionID: SessionSchema.ID
  readonly childInputID: SessionMessage.ID
  readonly description: string
  readonly prompt: Prompt
  readonly agent: string
  readonly agentPath?: string
  readonly model?: unknown
  readonly status: "accepted" | "running" | "completed" | "error" | "cancelled" | "recovery-required"
  readonly outcome?: Outcome
  readonly resultMessageID?: SessionMessage.ID
  readonly resultText?: string
  readonly error?: unknown
  readonly timeCreated: number
  readonly timeCompleted?: number
}

export class InvocationConflict extends Schema.TaggedErrorClass<InvocationConflict>()(
  "TaskSubmission.InvocationConflict",
  { parentSessionID: SessionSchema.ID, assistantMessageID: SessionMessage.ID, toolCallID: Schema.String },
) {}

export class Missing extends Schema.TaggedErrorClass<Missing>()("TaskSubmission.Missing", { id: Schema.String }) {}

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("TaskSubmission.Cancelled", {
  parentSessionID: SessionSchema.ID,
}) {}

export type TerminalizeInput = {
  readonly submissionID: string
  readonly outcome: Outcome
  readonly resultMessageID?: SessionMessage.ID
  readonly resultText?: string
  readonly error?: unknown
  readonly terminalSeq?: number
}

export type ClaimResult = {
  readonly acquired: boolean
  readonly info: Info
}

export type RecoveryInput = {
  readonly sessionID: SessionSchema.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly childInputID: SessionMessage.ID
  readonly messages: ReadonlyArray<SessionMessage.Message>
}

export type SessionRecoveryInput = {
  readonly sessionID: SessionSchema.ID
  readonly messages: ReadonlyArray<SessionMessage.Message>
}

export type RecoveryRequiredInput = {
  readonly sessionID: SessionSchema.ID
  readonly childInputID: SessionMessage.ID
  readonly reason: "dispatch-unknown" | "response-interrupted"
}

export interface Interface {
  readonly submit: (input: Invocation) => Effect.Effect<Info, InvocationConflict | Cancelled>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly claim: (id: string) => Effect.Effect<ClaimResult, Missing>
  readonly terminalize: (input: TerminalizeInput) => Effect.Effect<Info | undefined>
  readonly recoverSession: (input: RecoveryInput) => Effect.Effect<number>
  readonly recoverCompleted: (input: SessionRecoveryInput) => Effect.Effect<number>
  readonly markRecoveryRequired: (input: RecoveryRequiredInput) => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TaskSubmission") {}

export const inputID = (invocation: Identity) =>
  SessionMessage.ID.make(
    `msg_task_${digest(JSON.stringify([invocation.parentSessionID, invocation.assistantMessageID, invocation.toolCallID, invocation.prompt]))}`,
  )

export const notificationID = (submissionID: string) =>
  SessionMessage.ID.make(`msg_task_notification_${digest(submissionID)}`)

const toInfo = (row: typeof TaskSubmissionTable.$inferSelect): Info => ({
  id: row.id,
  parentSessionID: SessionSchema.ID.make(row.parent_session_id),
  assistantMessageID: SessionMessage.ID.make(row.assistant_message_id),
  toolCallID: row.tool_call_id,
  childSessionID: SessionSchema.ID.make(row.child_session_id),
  childInputID: SessionMessage.ID.make(row.child_input_id),
  description: row.description,
  prompt: Schema.decodeUnknownSync(Prompt)(row.prompt),
  agent: row.agent,
  ...(row.agent_path === null ? {} : { agentPath: row.agent_path }),
  ...(row.model === null ? {} : { model: row.model }),
  status: row.status,
  ...(row.outcome === null ? {} : { outcome: row.outcome }),
  ...(row.result_message_id === null ? {} : { resultMessageID: SessionMessage.ID.make(row.result_message_id) }),
  ...(row.result_text === null ? {} : { resultText: row.result_text }),
  ...(row.error === null ? {} : { error: row.error }),
  timeCreated: row.time_created,
  ...(row.time_completed === null ? {} : { timeCompleted: row.time_completed }),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const isCancelled = Effect.fn("TaskSubmission.isCancelled")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .all<{ root_session_id: string }>(
          sql`
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
        `,
        )
        .pipe(Effect.orDie)
      return rows.length > 0
    })

    const isInvocationCancelled = Effect.fn("TaskSubmission.isInvocationCancelled")(function* (
      parentSessionID: SessionSchema.ID,
      childSessionID: SessionSchema.ID,
    ) {
      if (yield* isCancelled(parentSessionID)) return true
      if (parentSessionID === childSessionID) return false
      return yield* isCancelled(childSessionID)
    })

    const findInvocation = Effect.fn("TaskSubmission.findInvocation")(function* (input: Identity) {
      return yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(
          and(
            eq(TaskSubmissionTable.parent_session_id, input.parentSessionID),
            eq(TaskSubmissionTable.assistant_message_id, input.assistantMessageID),
            eq(TaskSubmissionTable.tool_call_id, input.toolCallID),
          ),
        )
        .get()
        .pipe(Effect.orDie)
    })

    const get: Interface["get"] = Effect.fn("TaskSubmission.get")(function* (id) {
      const row = yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(eq(TaskSubmissionTable.id, id))
        .get()
        .pipe(Effect.orDie)
      return row === undefined ? undefined : toInfo(row)
    })

    const claim: Interface["claim"] = Effect.fn("TaskSubmission.claim")(function* (id) {
      const row = yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(eq(TaskSubmissionTable.id, id))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new Missing({ id })
      const updated = yield* db
        .update(TaskSubmissionTable)
        .set({ status: "running" })
        .where(and(eq(TaskSubmissionTable.id, id), eq(TaskSubmissionTable.status, "accepted")))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (updated) return { acquired: true, info: toInfo(updated) }
      return { acquired: false, info: toInfo(row) }
    })

    const submit: Interface["submit"] = Effect.fn("TaskSubmission.submit")(function* (input) {
      const existing = yield* findInvocation(input)
      if (existing) {
        if (!matches(toInfo(existing), input))
          return yield* new InvocationConflict({
            parentSessionID: input.parentSessionID,
            assistantMessageID: input.assistantMessageID,
            toolCallID: input.toolCallID,
          })
        return toInfo(existing)
      }
      if (yield* isInvocationCancelled(input.parentSessionID, input.childSessionID))
        return yield* new Cancelled({ parentSessionID: input.parentSessionID })

      const childInputID = inputID(input)
      const submissionID = Identifier.create("sub", "ascending")
      const timeCreated = yield* Clock.currentTimeMillis
      const commit = (_seq: number) =>
        Effect.gen(function* () {
          if (yield* isInvocationCancelled(input.parentSessionID, input.childSessionID))
            return yield* Effect.die(new Cancelled({ parentSessionID: input.parentSessionID }))
          yield* db
            .insert(TaskSubmissionTable)
            .values({
              id: submissionID,
              parent_session_id: input.parentSessionID,
              assistant_message_id: input.assistantMessageID,
              tool_call_id: input.toolCallID,
              child_session_id: input.childSessionID,
              child_input_id: childInputID,
              description: input.description,
              prompt: input.prompt,
              agent: input.agent,
              agent_path: input.agentPath,
              model: input.model,
              status: "accepted",
              time_created: timeCreated,
            })
            .onConflictDoNothing()
            .run()
            .pipe(Effect.orDie)
        })

      const admitted = yield* SessionInput.admit(db, events, {
        id: childInputID,
        sessionID: input.childSessionID,
        prompt: input.prompt,
        delivery: "steer",
        commit,
      }).pipe(Effect.catchDefect((defect) => (defect instanceof Cancelled ? Effect.fail(defect) : Effect.die(defect))))
      if (
        !SessionInput.equivalent(admitted, { sessionID: input.childSessionID, prompt: input.prompt, delivery: "steer" })
      )
        return yield* new InvocationConflict({
          parentSessionID: input.parentSessionID,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.toolCallID,
        })

      const row = yield* findInvocation(input)
      if (row) {
        if (!matches(toInfo(row), input))
          return yield* new InvocationConflict({
            parentSessionID: input.parentSessionID,
            assistantMessageID: input.assistantMessageID,
            toolCallID: input.toolCallID,
          })
        return toInfo(row)
      }

      yield* commit(admitted.admittedSeq)
      const recovered = yield* findInvocation(input)
      if (recovered && !matches(toInfo(recovered), input))
        return yield* new InvocationConflict({
          parentSessionID: input.parentSessionID,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.toolCallID,
        })
      if (!recovered) return yield* Effect.die("Task submission commit did not create a submission")
      return toInfo(recovered)
    })

    const terminalize: Interface["terminalize"] = Effect.fn("TaskSubmission.terminalize")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      return yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const row = yield* db
              .select()
              .from(TaskSubmissionTable)
              .where(eq(TaskSubmissionTable.id, input.submissionID))
              .get()
              .pipe(Effect.orDie)
            if (!row) return undefined
            if (row.outcome !== null) return toInfo(row)

            const updated = yield* db
              .update(TaskSubmissionTable)
              .set({
                status:
                  input.outcome === "completed" ? "completed" : input.outcome === "error" ? "error" : input.outcome,
                outcome: input.outcome,
                result_message_id: input.resultMessageID,
                result_text: input.resultText,
                error: input.error,
                time_completed: now,
              })
              .where(and(eq(TaskSubmissionTable.id, input.submissionID), isNull(TaskSubmissionTable.outcome)))
              .returning()
              .get()
              .pipe(Effect.orDie)
            if (!updated) {
              const current = yield* db
                .select()
                .from(TaskSubmissionTable)
                .where(eq(TaskSubmissionTable.id, input.submissionID))
                .get()
                .pipe(Effect.orDie)
              return current ? toInfo(current) : undefined
            }

            const terminalSeq = input.terminalSeq ?? (yield* EventV2.latestSequence(db, updated.child_session_id))
            const projected = yield* db
              .update(SessionInputTable)
              .set({
                terminal_outcome: input.outcome,
                terminal_message_id: input.resultMessageID,
                terminal_error: input.error,
                terminal_time: now,
                terminal_seq: terminalSeq,
              })
              .where(and(eq(SessionInputTable.id, updated.child_input_id), isNull(SessionInputTable.terminal_outcome)))
              .returning({ id: SessionInputTable.id })
              .get()
              .pipe(Effect.orDie)
            if (!projected) return yield* Effect.die(`Task input was not pending: ${updated.child_input_id}`)

            const text =
              input.resultText ??
              (typeof input.error === "object" && input.error !== null && "message" in input.error
                ? String(input.error.message)
                : "")
            yield* db
              .insert(TaskNotificationOutboxTable)
              .values({
                id: Identifier.create("outbox", "ascending"),
                submission_id: updated.id,
                parent_session_id: updated.parent_session_id,
                message_id: notificationID(updated.id),
                payload: { state: input.outcome, description: updated.description, text },
                status: "pending",
                time_created: now,
              })
              .onConflictDoNothing()
              .run()
              .pipe(Effect.orDie)
            return toInfo(updated)
          }),
        )
        .pipe(Effect.orDie)
    })

    const recoverOne = Effect.fn("TaskSubmission.recoverOne")(function* (
      submission: typeof TaskSubmissionTable.$inferSelect,
      assistant: SessionMessage.Assistant,
    ) {
      const row = yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(and(eq(TaskSubmissionTable.id, submission.id), isNull(TaskSubmissionTable.outcome)))
        .get()
        .pipe(Effect.orDie)
      if (!row) return false
      const text = assistant.content
        .filter((part): part is SessionMessage.AssistantText => part.type === "text")
        .map((part) => part.text)
        .join("")
      const recovered = yield* terminalize({
        submissionID: row.id,
        outcome: assistant.error || assistant.finish === "error" ? "error" : "completed",
        resultMessageID: assistant.id,
        resultText: text,
        error: assistant.error,
      })
      if (recovered) {
        const timeUpdated = yield* Clock.currentTimeMillis
        yield* db
          .update(SessionAttemptTable)
          .set({
            status: "ended",
            retry_at: null,
            error: null,
            decision: null,
            time_updated: timeUpdated,
          })
          .where(
            and(
              eq(SessionAttemptTable.session_id, row.child_session_id),
              eq(SessionAttemptTable.assistant_message_id, assistant.id),
              or(eq(SessionAttemptTable.status, "started"), eq(SessionAttemptTable.status, "responding")),
            ),
          )
          .run()
          .pipe(Effect.orDie)
      }
      return recovered !== undefined
    })

    const recoverSession: Interface["recoverSession"] = Effect.fn("TaskSubmission.recoverSession")(function* (input) {
      const assistant = findCompletedAssistant(input.messages, input.childInputID, input.assistantMessageID)
      if (!assistant) return 0
      const row = yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(
          and(
            eq(TaskSubmissionTable.child_session_id, input.sessionID),
            eq(TaskSubmissionTable.child_input_id, input.childInputID),
            isNull(TaskSubmissionTable.outcome),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (!row) return 0
      return (yield* recoverOne(row, assistant)) ? 1 : 0
    })

    const recoverCompleted: Interface["recoverCompleted"] = Effect.fn("TaskSubmission.recoverCompleted")(
      function* (input) {
        const rows = yield* db
          .select()
          .from(TaskSubmissionTable)
          .where(and(eq(TaskSubmissionTable.child_session_id, input.sessionID), isNull(TaskSubmissionTable.outcome)))
          .all()
          .pipe(Effect.orDie)
        let recovered = 0
        for (const row of rows) {
          const assistant = findCompletedAssistant(input.messages, SessionMessage.ID.make(row.child_input_id))
          if (assistant && (yield* recoverOne(row, assistant))) recovered++
        }
        return recovered
      },
    )

    const markRecoveryRequired: Interface["markRecoveryRequired"] = Effect.fn("TaskSubmission.markRecoveryRequired")(
      function* (input) {
        const row = yield* db
          .select()
          .from(TaskSubmissionTable)
          .where(
            and(
              eq(TaskSubmissionTable.child_session_id, input.sessionID),
              eq(TaskSubmissionTable.child_input_id, input.childInputID),
              isNull(TaskSubmissionTable.outcome),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) return 0
        const settled = yield* terminalize({
          submissionID: row.id,
          outcome: "recovery-required",
          error: {
            message: "Provider attempt requires an explicit recovery decision",
            reason: input.reason,
          },
        })
        if (settled) {
          const timeUpdated = yield* Clock.currentTimeMillis
          yield* db
            .update(SessionAttemptTable)
            .set({
              status: "abandoned",
              retry_at: null,
              error: null,
              decision: "abandon",
              time_updated: timeUpdated,
            })
            .where(
              and(
                eq(SessionAttemptTable.session_id, input.sessionID),
                or(eq(SessionAttemptTable.status, "started"), eq(SessionAttemptTable.status, "responding")),
              ),
            )
            .run()
            .pipe(Effect.orDie)
        }
        return settled ? 1 : 0
      },
    )

    return Service.of({ submit, get, claim, terminalize, recoverSession, recoverCompleted, markRecoveryRequired })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node] })

function matches(existing: Info, input: Invocation) {
  return (
    existing.childSessionID === input.childSessionID &&
    existing.description === input.description &&
    existing.agent === input.agent &&
    existing.agentPath === input.agentPath &&
    serializedModel(existing.model) === serializedModel(input.model) &&
    SessionInput.samePrompt(existing.prompt, input.prompt)
  )
}

function serializedModel(model: unknown) {
  return JSON.stringify(model ?? null)
}

function findCompletedAssistant(
  messages: ReadonlyArray<SessionMessage.Message>,
  childInputID: SessionMessage.ID,
  assistantMessageID?: SessionMessage.ID,
) {
  const inputIndex = messages.findIndex((message) => message.id === childInputID)
  if (inputIndex < 0) return undefined
  const afterInput = messages.slice(inputIndex + 1)
  if (assistantMessageID !== undefined) {
    const assistant = afterInput.find((message) => message.id === assistantMessageID)
    if (assistant?.type === "assistant" && assistant.time.completed !== undefined) return assistant
    return undefined
  }
  const nextInputIndex = afterInput.findIndex((message) => message.type === "user")
  return afterInput
    .slice(0, nextInputIndex < 0 ? undefined : nextInputIndex)
    .find(
      (message): message is SessionMessage.Assistant =>
        message.type === "assistant" && message.time.completed !== undefined,
    )
}

function digest(value: string) {
  return Hash.sha256(value).slice(0, 32)
}
