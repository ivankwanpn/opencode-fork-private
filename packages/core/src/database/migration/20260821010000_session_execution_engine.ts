import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821010000_session_execution_engine",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`engine\` text DEFAULT 'classic' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
