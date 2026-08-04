import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260803200310_task_requested_completion_delivery",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `ALTER TABLE \`task_submission\` ADD \`requested_completion_delivery\` text DEFAULT 'parent' NOT NULL;`,
      )
      yield* tx.run(
        `UPDATE \`task_submission\` SET \`requested_completion_delivery\` = \`completion_delivery\`;`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
