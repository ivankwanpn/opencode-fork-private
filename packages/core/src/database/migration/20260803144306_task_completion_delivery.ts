import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803144306_task_completion_delivery",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task_submission\` ADD \`completion_delivery\` text DEFAULT 'parent' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
