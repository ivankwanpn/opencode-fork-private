import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

// The session permission column historically stored the V1 rule shape
// ({ permission, pattern, action }). The V2 runner consumes rules as
// { action, resource, effect }. This migration rewrites existing rows in
// place so the column type annotation can switch to PermissionV2.Ruleset.
// Rows that already carry the V2 shape are left untouched.
export default {
  id: "20260811000000_session_permission_v2",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE session
        SET permission = (
          SELECT json_group_array(json_object(
            'action', json_extract(value, '$.permission'),
            'resource', json_extract(value, '$.pattern'),
            'effect', json_extract(value, '$.action')
          ))
          FROM json_each(session.permission)
        )
        WHERE permission IS NOT NULL
          AND json_valid(permission)
          AND json_extract(permission, '$[0].permission') IS NOT NULL
      `)
    })
  },
} satisfies DatabaseMigration.Migration
