import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import {
  SessionInputTable,
  SessionTable,
  TaskNotificationOutboxTable,
  TaskSubmissionTable,
} from "@opencode-ai/core/session/sql"
import { TaskCancellation } from "@opencode-ai/core/session/task-cancellation"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { testEffect } from "./lib/effect"

const root = SessionSchema.ID.make("ses_cancel_root")
const child = SessionSchema.ID.make("ses_cancel_child")
const grandchild = SessionSchema.ID.make("ses_cancel_grandchild")
const other = SessionSchema.ID.make("ses_cancel_other")
const prompt = Prompt.make({ text: "run cancellation test" })

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, EventV2.node, SessionProjector.node, TaskSubmission.node, TaskCancellation.node]),
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values([
      {
        id: root,
        project_id: Project.ID.global,
        slug: "cancel-root",
        directory: "/project",
        title: "root",
        version: "test",
      },
      {
        id: child,
        project_id: Project.ID.global,
        parent_id: root,
        slug: "cancel-child",
        directory: "/project",
        title: "child",
        version: "test",
      },
      {
        id: grandchild,
        project_id: Project.ID.global,
        parent_id: child,
        slug: "cancel-grandchild",
        directory: "/project",
        title: "grandchild",
        version: "test",
      },
      {
        id: other,
        project_id: Project.ID.global,
        slug: "cancel-other",
        directory: "/project",
        title: "other",
        version: "test",
      },
    ])
    .run()
    .pipe(Effect.orDie)
  const submissions = yield* TaskSubmission.Service
  yield* submissions.submit({
    parentSessionID: root,
    assistantMessageID: SessionMessage.ID.make("msg_cancel_root_assistant"),
    toolCallID: "call_cancel_child",
    childSessionID: child,
    description: "cancel child",
    prompt,
    agent: "general",
  })
  yield* submissions.submit({
    parentSessionID: child,
    assistantMessageID: SessionMessage.ID.make("msg_cancel_child_assistant"),
    toolCallID: "call_cancel_grandchild",
    childSessionID: grandchild,
    description: "cancel grandchild",
    prompt,
    agent: "general",
  })
})

describe("TaskCancellation", () => {
  it.effect("terminalizes the ownership tree before interrupting and blocks descendant submits", () =>
    Effect.gen(function* () {
      yield* setup
      const cancellation = yield* TaskCancellation.Service
      const submissions = yield* TaskSubmission.Service
      const { db } = yield* Database.Service
      const interrupted: SessionSchema.ID[] = []
      const waited: SessionSchema.ID[] = []

      const result = yield* cancellation.cancelTree({
        rootSessionID: root,
        interrupt: (sessionID) => Effect.sync(() => interrupted.push(sessionID)),
        wait: (sessionID) => Effect.sync(() => waited.push(sessionID)),
      })

      expect(result.sessionIDs).toEqual(expect.arrayContaining([root, child, grandchild]))
      expect(interrupted).toEqual(expect.arrayContaining([root, child, grandchild]))
      expect(waited).toEqual(expect.arrayContaining([root, child, grandchild]))
      expect(
        yield* db.select().from(TaskSubmissionTable).where(eq(TaskSubmissionTable.outcome, "cancelled")).all(),
      ).toHaveLength(2)
      const terminalInputs = yield* db
        .select()
        .from(SessionInputTable)
        .where(eq(SessionInputTable.terminal_outcome, "cancelled"))
        .all()
      expect(terminalInputs).toHaveLength(2)
      const expectedTerminalSeqs = yield* Effect.forEach([child, grandchild], (sessionID) =>
        EventV2.latestSequence(db, sessionID),
      )
      expect(terminalInputs.map((input) => input.terminal_seq).toSorted()).toEqual(expectedTerminalSeqs.toSorted())
      expect(yield* db.select().from(TaskNotificationOutboxTable).all()).toHaveLength(2)

      const escaped = yield* submissions
        .submit({
          parentSessionID: grandchild,
          assistantMessageID: SessionMessage.ID.make("msg_cancel_escape_assistant"),
          toolCallID: "call_cancel_escape",
          childSessionID: other,
          description: "escape",
          prompt,
          agent: "general",
        })
        .pipe(Effect.flip)
      expect(escaped._tag).toBe("TaskSubmission.Cancelled")
    }),
  )

  it.effect("does not leave a descendant submission running across cancellation commit", () =>
    Effect.gen(function* () {
      yield* setup
      const cancellation = yield* TaskCancellation.Service
      const submissions = yield* TaskSubmission.Service
      const submit = submissions
        .submit({
          parentSessionID: grandchild,
          assistantMessageID: SessionMessage.ID.make("msg_cancel_race_assistant"),
          toolCallID: "call_cancel_race",
          childSessionID: other,
          description: "race",
          prompt,
          agent: "general",
        })
        .pipe(Effect.catchTag("TaskSubmission.Cancelled", (error) => Effect.succeed(error)))
      const [, submitted] = yield* Effect.all(
        [
          cancellation.cancelTree({ rootSessionID: root, interrupt: () => Effect.void, wait: () => Effect.void }),
          submit,
        ],
        { concurrency: "unbounded" },
      )
      if ("_tag" in submitted && submitted._tag === "TaskSubmission.Cancelled") return
      if ("outcome" in submitted) expect(submitted.outcome).toBe("cancelled")
    }),
  )
})
