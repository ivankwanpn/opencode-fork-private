import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260815012419_session_share_revocation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_share_revocation\` (
          \`session_id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`attempt_count\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
