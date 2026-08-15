import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260815025712_share_removal_intent",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_share_removal\` (
          \`session_id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`PRAGMA foreign_keys=OFF;`)
      yield* tx.run(`
        CREATE TABLE \`__new_session_share_revocation\` (
          \`session_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`id\` text NOT NULL,
          \`secret\` text NOT NULL,
          \`url\` text NOT NULL,
          \`attempt_count\` integer DEFAULT 0 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`session_share_revocation_pk\` PRIMARY KEY(\`session_id\`, \`id\`)
        );
      `)
      yield* tx.run(
        `INSERT INTO \`__new_session_share_revocation\`(\`session_id\`, \`directory\`, \`id\`, \`secret\`, \`url\`, \`attempt_count\`, \`time_created\`, \`time_updated\`) SELECT \`session_id\`, \`directory\`, \`id\`, \`secret\`, \`url\`, \`attempt_count\`, \`time_created\`, \`time_updated\` FROM \`session_share_revocation\`;`,
      )
      yield* tx.run(`DROP TABLE \`session_share_revocation\`;`)
      yield* tx.run(`ALTER TABLE \`__new_session_share_revocation\` RENAME TO \`session_share_revocation\`;`)
      yield* tx.run(`PRAGMA foreign_keys=ON;`)
    })
  },
} satisfies DatabaseMigration.Migration
