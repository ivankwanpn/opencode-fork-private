import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260729102613_durable_task_lifecycle",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_cancellation\` (
          \`root_session_id\` text PRIMARY KEY,
          \`time_created\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_session_cancellation_root_session_id_session_id_fk\` FOREIGN KEY (\`root_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_notification_outbox\` (
          \`id\` text PRIMARY KEY,
          \`submission_id\` text NOT NULL,
          \`parent_session_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`payload\` text NOT NULL,
          \`status\` text NOT NULL,
          \`attempts\` integer DEFAULT 0 NOT NULL,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_delivered\` integer,
          \`time_woken\` integer,
          CONSTRAINT \`fk_task_notification_outbox_submission_id_task_submission_id_fk\` FOREIGN KEY (\`submission_id\`) REFERENCES \`task_submission\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_task_notification_outbox_parent_session_id_session_id_fk\` FOREIGN KEY (\`parent_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_submission\` (
          \`id\` text PRIMARY KEY,
          \`parent_session_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`tool_call_id\` text NOT NULL,
          \`child_session_id\` text NOT NULL,
          \`child_input_id\` text NOT NULL,
          \`description\` text NOT NULL,
          \`prompt\` text NOT NULL,
          \`agent\` text NOT NULL,
          \`model\` text,
          \`status\` text NOT NULL,
          \`outcome\` text,
          \`result_message_id\` text,
          \`result_text\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_task_submission_parent_session_id_session_id_fk\` FOREIGN KEY (\`parent_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_task_submission_child_session_id_session_id_fk\` FOREIGN KEY (\`child_session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`terminal_outcome\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`terminal_message_id\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`terminal_error\` text;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`terminal_time\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`terminal_seq\` integer;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_notification_outbox_message_idx\` ON \`task_notification_outbox\` (\`message_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_notification_outbox_status_idx\` ON \`task_notification_outbox\` (\`status\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_submission_invocation_idx\` ON \`task_submission\` (\`parent_session_id\`,\`assistant_message_id\`,\`tool_call_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`task_submission_child_input_idx\` ON \`task_submission\` (\`child_input_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_submission_parent_status_idx\` ON \`task_submission\` (\`parent_session_id\`,\`status\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
