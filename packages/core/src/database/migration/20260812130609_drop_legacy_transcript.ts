import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260812130609_drop_legacy_transcript",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`DROP INDEX IF EXISTS \`message_session_time_created_id_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`part_message_id_id_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`part_session_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`session_message_tombstone_session_idx\`;`)
      yield* tx.run(`DROP TABLE \`message\`;`)
      yield* tx.run(`DROP TABLE \`part\`;`)
      yield* tx.run(`DROP TABLE \`session_message_tombstone\`;`)
    })
  },
} satisfies DatabaseMigration.Migration
