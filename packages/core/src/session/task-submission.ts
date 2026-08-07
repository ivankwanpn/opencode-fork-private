export * as TaskSubmission from "./task-submission"

import { and, asc, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
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
import {
  SessionAttemptTable,
  SessionInputTable,
  SessionMessageTable,
  TaskNotificationOutboxTable,
  TaskSubmissionTable,
} from "./sql"
import { TaskNotification } from "./task-notification"

export type Identity = {
  readonly parentSessionID: SessionSchema.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly toolCallID: string
  readonly prompt: Prompt
}

export type CompletionDelivery = "tool" | "parent"

export type Invocation = Identity & {
  readonly childSessionID: SessionSchema.ID
  readonly description: string
  readonly agent: string
  readonly agentPath?: string
  readonly model?: unknown
  readonly completionDelivery: CompletionDelivery
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
  readonly completionDelivery: CompletionDelivery
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
  readonly latestByChild: (input: {
    readonly parentSessionID: SessionSchema.ID
    readonly childSessionID: SessionSchema.ID
  }) => Effect.Effect<Info | undefined>
  readonly claim: (id: string) => Effect.Effect<ClaimResult, Missing>
  readonly terminalize: (input: TerminalizeInput) => Effect.Effect<Info | undefined>
  /** Settles a submission from the durable child transcript, independent of compaction. */
  readonly terminalizeFromChild: (submissionID: string) => Effect.Effect<Info | undefined>
  readonly promoteDelivery: (submissionID: string) => Effect.Effect<Info | undefined>
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
  completionDelivery: row.completion_delivery,
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
    const notifications = yield* TaskNotification.Service

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

    const findCompletedAssistantDurable = Effect.fn("TaskSubmission.findCompletedAssistantDurable")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly childInputID: SessionMessage.ID
      readonly assistantMessageID?: SessionMessage.ID
    }) {
      const inputRow = yield* db
        .select({ admittedSeq: SessionInputTable.admitted_seq, promotedSeq: SessionInputTable.promoted_seq })
        .from(SessionInputTable)
        .where(and(eq(SessionInputTable.session_id, input.sessionID), eq(SessionInputTable.id, input.childInputID)))
        .get()
        .pipe(Effect.orDie)
      const messageRow = inputRow
        ? undefined
        : yield* db
            .select({ seq: SessionMessageTable.seq })
            .from(SessionMessageTable)
            .where(
              and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.childInputID)),
            )
            .get()
            .pipe(Effect.orDie)
      const anchor = inputRow ? { seq: inputRow.promotedSeq ?? inputRow.admittedSeq } : messageRow
      if (!anchor) return undefined

      const nextInput = yield* db
        .select({ seq: SessionMessageTable.seq })
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, input.sessionID),
            eq(SessionMessageTable.type, "user"),
            gt(SessionMessageTable.seq, anchor.seq),
          ),
        )
        .orderBy(asc(SessionMessageTable.seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, input.sessionID),
            gt(SessionMessageTable.seq, anchor.seq),
            nextInput ? lt(SessionMessageTable.seq, nextInput.seq) : undefined,
          ),
        )
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      const messages = yield* Effect.forEach(rows, (row) =>
        Schema.decodeUnknownEffect(SessionMessage.Message)({ ...row.data, id: row.id, type: row.type }).pipe(
          Effect.orDie,
        ),
      )
      return findCompletedAssistantAfterInput(messages, input.assistantMessageID)
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

    const latestByChild: Interface["latestByChild"] = Effect.fn("TaskSubmission.latestByChild")(function* (input) {
      const row = yield* db
        .select()
        .from(TaskSubmissionTable)
        .where(
          and(
            eq(TaskSubmissionTable.parent_session_id, input.parentSessionID),
            eq(TaskSubmissionTable.child_session_id, input.childSessionID),
          ),
        )
        .orderBy(desc(TaskSubmissionTable.time_created), desc(TaskSubmissionTable.id))
        .limit(1)
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
        if (!matches(toInfo(existing), input, existing.requested_completion_delivery))
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
              requested_completion_delivery: input.completionDelivery,
              completion_delivery: input.completionDelivery,
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
        if (!matches(toInfo(row), input, row.requested_completion_delivery))
          return yield* new InvocationConflict({
            parentSessionID: input.parentSessionID,
            assistantMessageID: input.assistantMessageID,
            toolCallID: input.toolCallID,
          })
        return toInfo(row)
      }

      yield* commit(admitted.admittedSeq)
      const recovered = yield* findInvocation(input)
      if (recovered && !matches(toInfo(recovered), input, recovered.requested_completion_delivery))
        return yield* new InvocationConflict({
          parentSessionID: input.parentSessionID,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.toolCallID,
        })
      if (!recovered) return yield* Effect.die("Task submission commit did not create a submission")
      return toInfo(recovered)
    })

    const enqueueNotification = Effect.fn("TaskSubmission.enqueueNotification")(function* (
      row: typeof TaskSubmissionTable.$inferSelect,
      timeCreated: number,
    ) {
      if (row.outcome === null) return
      const text =
        row.outcome === "completed"
          ? (row.result_text ?? "")
          : (nonEmptyText(row.result_text) ?? errorText(row.error) ?? "")
      yield* db
        .insert(TaskNotificationOutboxTable)
        .values({
          id: Identifier.create("outbox", "ascending"),
          submission_id: row.id,
          parent_session_id: row.parent_session_id,
          message_id: notificationID(row.id),
          payload: { taskID: row.child_session_id, state: row.outcome, description: row.description, text },
          status: "pending",
          time_created: timeCreated,
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    })

    const terminalize: Interface["terminalize"] = Effect.fn("TaskSubmission.terminalize")(function* (input) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* db
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

            if (updated.completion_delivery === "parent") yield* enqueueNotification(updated, now)
            return toInfo(updated)
          }),
        )
        .pipe(Effect.orDie)
      if (result?.completionDelivery === "parent") yield* notifications.signal()
      return result
    })

    const terminalizeFromChild: Interface["terminalizeFromChild"] = Effect.fn("TaskSubmission.terminalizeFromChild")(
      function* (submissionID) {
        const row = yield* db
          .select()
          .from(TaskSubmissionTable)
          .where(eq(TaskSubmissionTable.id, submissionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        if (row.outcome !== null) return toInfo(row)

        const assistant = yield* findCompletedAssistantDurable({
          sessionID: row.child_session_id,
          childInputID: SessionMessage.ID.make(row.child_input_id),
        })
        if (!assistant) return toInfo(row)
        const text = assistant.content
          .filter((part): part is SessionMessage.AssistantText => part.type === "text")
          .map((part) => part.text)
          .join("")
        return yield* terminalize({
          submissionID: row.id,
          outcome: assistant.error || assistant.finish === "error" ? "error" : "completed",
          resultMessageID: assistant.id,
          resultText: text,
          error: assistant.error,
        })
      },
    )

    const promoteDelivery: Interface["promoteDelivery"] = Effect.fn("TaskSubmission.promoteDelivery")(function* (
      submissionID,
    ) {
      const now = yield* Clock.currentTimeMillis
      const result = yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const row = yield* db
              .select()
              .from(TaskSubmissionTable)
              .where(eq(TaskSubmissionTable.id, submissionID))
              .get()
              .pipe(Effect.orDie)
            if (!row) return undefined

            const updated =
              row.completion_delivery === "tool"
                ? yield* db
                    .update(TaskSubmissionTable)
                    .set({ completion_delivery: "parent" })
                    .where(
                      and(
                        eq(TaskSubmissionTable.id, submissionID),
                        eq(TaskSubmissionTable.completion_delivery, "tool"),
                      ),
                    )
                    .returning()
                    .get()
                    .pipe(Effect.orDie)
                : row
            const current =
              updated ??
              (yield* db
                .select()
                .from(TaskSubmissionTable)
                .where(eq(TaskSubmissionTable.id, submissionID))
                .get()
                .pipe(Effect.orDie))
            if (!current) return undefined
            if (current.outcome !== null) yield* enqueueNotification(current, now)
            return toInfo(current)
          }),
        )
        .pipe(Effect.orDie)
      if (result?.completionDelivery === "parent") yield* notifications.signal()
      return result
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
      const assistant =
        (yield* findCompletedAssistantDurable({
          sessionID: input.sessionID,
          childInputID: input.childInputID,
          assistantMessageID: input.assistantMessageID,
        })) ?? findCompletedAssistant(input.messages, input.childInputID, input.assistantMessageID)
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
          const childInputID = SessionMessage.ID.make(row.child_input_id)
          const assistant =
            (yield* findCompletedAssistantDurable({
              sessionID: input.sessionID,
              childInputID,
            })) ?? findCompletedAssistant(input.messages, childInputID)
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

    return Service.of({
      submit,
      get,
      latestByChild,
      claim,
      terminalize,
      terminalizeFromChild,
      promoteDelivery,
      recoverSession,
      recoverCompleted,
      markRecoveryRequired,
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, EventV2.node, TaskNotification.node] })

function matches(existing: Info, input: Invocation, requestedCompletionDelivery = existing.completionDelivery) {
  return (
    existing.childSessionID === input.childSessionID &&
    existing.description === input.description &&
    existing.agent === input.agent &&
    existing.agentPath === input.agentPath &&
    serializedModel(existing.model) === serializedModel(input.model) &&
    requestedCompletionDelivery === input.completionDelivery &&
    SessionInput.samePrompt(existing.prompt, input.prompt)
  )
}

function serializedModel(model: unknown) {
  return JSON.stringify(model ?? null)
}

function nonEmptyText(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : undefined
}

function errorText(error: unknown) {
  if (typeof error === "string" && error.trim()) return error
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined
  const message = String(error.message)
  return message.trim() ? message : undefined
}

function findCompletedAssistant(
  messages: ReadonlyArray<SessionMessage.Message>,
  childInputID: SessionMessage.ID,
  assistantMessageID?: SessionMessage.ID,
) {
  const inputIndex = messages.findIndex((message) => message.id === childInputID)
  if (inputIndex < 0) return undefined
  return findCompletedAssistantAfterInput(messages.slice(inputIndex + 1), assistantMessageID)
}

function findCompletedAssistantAfterInput(
  messages: ReadonlyArray<SessionMessage.Message>,
  assistantMessageID?: SessionMessage.ID,
) {
  if (assistantMessageID !== undefined) {
    const assistant = messages.find((message) => message.id === assistantMessageID)
    if (assistant?.type === "assistant" && assistant.time.completed !== undefined) return assistant
    return undefined
  }
  const nextInputIndex = messages.findIndex((message) => message.type === "user")
  return messages
    .slice(0, nextInputIndex < 0 ? undefined : nextInputIndex)
    .findLast(
      (message): message is SessionMessage.Assistant =>
        message.type === "assistant" && message.time.completed !== undefined,
    )
}

function digest(value: string) {
  return Hash.sha256(value).slice(0, 32)
}
