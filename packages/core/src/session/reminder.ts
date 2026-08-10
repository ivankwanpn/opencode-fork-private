export * as SessionReminder from "./reminder"

import path from "path"
import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { AgentV2 } from "../agent"
import type { Database } from "../database/database"
import { FSUtil } from "../fs-util"
import { SessionCommand } from "./command"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable } from "./sql"
import BUILD_SWITCH from "./runner/prompt/build-switch.txt"
import PLAN_MODE from "./runner/prompt/plan-mode.txt"

const planAgent = AgentV2.ID.make("plan")
const reminderKind = sql<string>`json_extract(${SessionMessageTable.data}, '$.kind')`
const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)

type Mode = "plan" | "build"

const modelFacingMode = Effect.fn("SessionReminder.modelFacingMode")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        or(
          eq(SessionMessageTable.type, "assistant"),
          and(eq(SessionMessageTable.type, "synthetic"), inArray(reminderKind, ["plan-mode", "build-switch"])),
        ),
      ),
    )
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!row) return
  const message = yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
    Effect.mapError(
      () =>
        new MessageDecodeError({
          sessionID,
          messageID: SessionMessage.ID.make(row.id),
        }),
    ),
  )
  if (message.type === "assistant") return message.agent === planAgent ? "plan" : "build"
  if (message.type === "synthetic") return message.kind === "plan-mode" ? "plan" : "build"
})

export const apply = Effect.fn("SessionReminder.apply")(function* (input: {
  readonly db: Database.Interface["db"]
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly commands: SessionCommand.Interface
  readonly fs: FSUtil.Interface
}) {
  const current: Mode = input.agent === planAgent ? "plan" : "build"
  const previous = yield* modelFacingMode(input.db, input.sessionID)
  if (previous === current || (previous === undefined && current === "build")) return false

  const plan = yield* input.commands.plan(input.sessionID).pipe(Effect.orDie)
  const exists = yield* input.fs.existsSafe(plan)
  if (current === "plan" && !exists) yield* input.fs.ensureDir(path.dirname(plan)).pipe(Effect.orDie)

  const text =
    current === "plan"
      ? PLAN_MODE.replace("${planInfo}", () =>
          exists
            ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
            : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`,
        )
      : exists
        ? `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        : BUILD_SWITCH

  yield* input.commands
    .synthetic({
      sessionID: input.sessionID,
      text,
      kind: current === "plan" ? "plan-mode" : "build-switch",
    })
    .pipe(Effect.orDie)
  return true
})
