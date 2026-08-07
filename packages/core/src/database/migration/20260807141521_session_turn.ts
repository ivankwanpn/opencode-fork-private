import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260807141521_session_turn",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_turn\` (
          \`session_id\` text PRIMARY KEY,
          \`turn_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_turn_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`intent\` text;`)
      yield* tx.run(`CREATE INDEX \`session_turn_status_idx\` ON \`session_turn\` (\`status\`,\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
