import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260812063844_session-message-tombstone",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_message_tombstone\` (
          \`message_id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_message_tombstone_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`session_message_tombstone_session_idx\` ON \`session_message_tombstone\` (\`session_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
