import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802120000_add_task_agent_path",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task_submission\` ADD \`agent_path\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
