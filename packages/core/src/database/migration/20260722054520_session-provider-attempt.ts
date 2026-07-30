import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260722054520_session-provider-attempt",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_provider_attempt\` (
          \`session_id\` text PRIMARY KEY,
          \`attempt_id\` text NOT NULL,
          \`assistant_message_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`attempt\` integer NOT NULL,
          \`retry_of\` text,
          \`retry_at\` integer,
          \`error\` text,
          \`decision\` text,
          \`seq\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_provider_attempt_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_provider_attempt_status_retry_idx\` ON \`session_provider_attempt\` (\`status\`,\`retry_at\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
