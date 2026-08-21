import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821020000_session_execution",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_execution\` (
          \`session_id\` text PRIMARY KEY,
          \`engine\` text DEFAULT 'kernel' NOT NULL,
          \`generation\` integer DEFAULT 0 NOT NULL,
          \`lease_token\` text,
          \`process_incarnation\` text,
          \`state\` text DEFAULT 'idle' NOT NULL,
          \`phase\` text,
          \`turn_id\` text,
          \`input_id\` text,
          \`attempt_id\` text,
          \`assistant_message_id\` text,
          \`retry_at\` integer,
          \`recovery_reason\` text,
          \`started_seq\` integer,
          \`updated_seq\` integer,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_execution_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`session_execution_state_idx\` ON \`session_execution\` (\`state\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
