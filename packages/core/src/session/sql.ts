import { sqliteTable, text, integer, index, primaryKey, real, uniqueIndex } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { ProjectTable } from "../project/sql"
import type { SessionMessage } from "./message"
import type { SessionInput } from "./input"
import type { Snapshot } from "../snapshot"
import { PermissionV2 } from "../permission"
import { ProjectV2 } from "../project"
import type { SessionSchema } from "./schema"
import type { MessageID, PartID, SessionV1 } from "../v1/session"
import { WorkspaceV2 } from "../workspace"
import { Timestamps } from "../database/schema.sql"
import type { SystemContext } from "../system-context/index"
import { AgentV2 } from "../agent"
import type { Revert } from "@opencode-ai/schema/revert"
import type { ID as EventID } from "@opencode-ai/schema/event"
import type { RetryError } from "@opencode-ai/schema/session-event"
import type { Intent as SessionInputIntent } from "@opencode-ai/schema/session-input"
import { ModelV2 } from "../model"

type SessionMessageData = Omit<(typeof SessionMessage.Message)["Encoded"], "type" | "id">
type V1MessageData = Omit<SessionV1.Info, "id" | "sessionID">
type V1PartData = Omit<SessionV1.Part, "id" | "sessionID" | "messageID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text()
      .$type<ProjectV2.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceV2.ID>(),
    parent_id: text().$type<SessionSchema.ID>(),
    slug: text().notNull(),
    directory: DatabasePath.directoryColumn().notNull(),
    path: DatabasePath.pathColumn(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.LegacyFileDiff[]>(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    revert: text({ mode: "json" }).$type<Revert.State>(),
    permission: text({ mode: "json" }).$type<PermissionV2.Ruleset>(),
    agent: text(),
    model: text({ mode: "json" }).$type<{
      id: string
      providerID: string
      variant?: string
      protocol?: ModelV2.Protocol
    }>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1MessageData>(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionSchema.ID>().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<V1PartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const SessionMessageTable = sqliteTable(
  "session_message",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionMessage.Type>().notNull(),
    seq: integer().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<SessionMessageData>(),
  },
  (table) => [
    uniqueIndex("session_message_session_seq_idx").on(table.session_id, table.seq),
    index("session_message_session_type_seq_idx").on(table.session_id, table.type, table.seq),
    index("session_message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id),
    index("session_message_time_created_idx").on(table.time_created),
  ],
)

export const SessionInputTable = sqliteTable(
  "session_input",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    prompt: text({ mode: "json" }).notNull().$type<unknown>(),
    delivery: text().$type<SessionInput.Delivery>().notNull(),
    intent: text({ mode: "json" }).$type<SessionInputIntent>(),
    admitted_seq: integer().notNull(),
    promoted_seq: integer(),
    terminal_outcome: text().$type<"completed" | "error" | "cancelled" | "recovery-required">(),
    terminal_message_id: text().$type<SessionMessage.ID>(),
    terminal_error: text({ mode: "json" }).$type<unknown>(),
    terminal_time: integer(),
    terminal_seq: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("session_input_session_pending_delivery_seq_idx").on(
      table.session_id,
      table.promoted_seq,
      table.delivery,
      table.admitted_seq,
    ),
    uniqueIndex("session_input_session_admitted_seq_idx").on(table.session_id, table.admitted_seq),
    uniqueIndex("session_input_session_promoted_seq_idx").on(table.session_id, table.promoted_seq),
  ],
)

export type TaskSubmissionStatus =
  | "accepted"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "recovery-required"

export const TaskSubmissionTable = sqliteTable(
  "task_submission",
  {
    id: text().primaryKey(),
    parent_session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    assistant_message_id: text().$type<SessionMessage.ID>().notNull(),
    tool_call_id: text().notNull(),
    child_session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    child_input_id: text().$type<SessionMessage.ID>().notNull(),
    description: text().notNull(),
    prompt: text({ mode: "json" }).notNull().$type<unknown>(),
    agent: text().notNull(),
    agent_path: text(),
    model: text({ mode: "json" }).$type<unknown>(),
    requested_completion_delivery: text().$type<"tool" | "parent">().notNull().default("parent"),
    completion_delivery: text().$type<"tool" | "parent">().notNull().default("parent"),
    status: text().$type<TaskSubmissionStatus>().notNull(),
    outcome: text().$type<"completed" | "error" | "cancelled" | "recovery-required">(),
    result_message_id: text().$type<SessionMessage.ID>(),
    result_text: text(),
    error: text({ mode: "json" }).$type<unknown>(),
    time_created: integer().notNull(),
    time_completed: integer(),
  },
  (table) => [
    uniqueIndex("task_submission_invocation_idx").on(
      table.parent_session_id,
      table.assistant_message_id,
      table.tool_call_id,
    ),
    uniqueIndex("task_submission_child_input_idx").on(table.child_input_id),
    index("task_submission_parent_status_idx").on(table.parent_session_id, table.status),
  ],
)

export type TaskNotificationOutboxStatus = "pending" | "delivered" | "woken" | "error" | "suppressed"

export const TaskNotificationOutboxTable = sqliteTable(
  "task_notification_outbox",
  {
    id: text().primaryKey(),
    submission_id: text()
      .notNull()
      .references(() => TaskSubmissionTable.id, { onDelete: "cascade" }),
    parent_session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    message_id: text().$type<SessionMessage.ID>().notNull(),
    payload: text({ mode: "json" }).notNull().$type<unknown>(),
    status: text().$type<TaskNotificationOutboxStatus>().notNull(),
    attempts: integer().notNull().default(0),
    error: text({ mode: "json" }).$type<unknown>(),
    time_created: integer().notNull(),
    time_delivered: integer(),
    time_woken: integer(),
  },
  (table) => [
    uniqueIndex("task_notification_outbox_message_idx").on(table.message_id),
    index("task_notification_outbox_status_idx").on(table.status, table.time_created),
  ],
)

export const SessionCancellationTable = sqliteTable("session_cancellation", {
  root_session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  time_created: integer().notNull(),
  time_completed: integer(),
})

export type SessionAttemptStatus =
  | "started"
  | "responding"
  | "retrying"
  | "continuation"
  | "ended"
  | "abandoned"
  | "interrupted"

export const SessionAttemptTable = sqliteTable(
  "session_provider_attempt",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    attempt_id: text().$type<EventID>().notNull(),
    assistant_message_id: text().$type<SessionMessage.ID>().notNull(),
    status: text().$type<SessionAttemptStatus>().notNull(),
    attempt: integer().notNull(),
    retry_of: text().$type<EventID>(),
    retry_at: integer(),
    error: text({ mode: "json" }).$type<RetryError>(),
    decision: text().$type<"retry" | "abandon">(),
    seq: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("session_provider_attempt_status_retry_idx").on(table.status, table.retry_at)],
)

export type SessionTurnStatus = "pending" | "active" | "ended"

export const SessionTurnTable = sqliteTable(
  "session_turn",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    turn_id: text().$type<SessionMessage.ID>().notNull(),
    status: text().$type<SessionTurnStatus>().notNull(),
    seq: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("session_turn_status_idx").on(table.status, table.time_updated)],
)

export const SessionContextEpochTable = sqliteTable("session_context_epoch", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline: text().notNull(),
  snapshot: text({ mode: "json" }).notNull().$type<SystemContext.Snapshot>(),
  baseline_seq: integer().notNull(),
})
