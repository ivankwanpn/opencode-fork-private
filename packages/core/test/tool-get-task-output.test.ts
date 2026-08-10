import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { BackgroundJob } from "@opencode-ai/core/background-job"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { TaskSubmission } from "@opencode-ai/core/session/task-submission"
import { GetTaskOutputTool } from "@opencode-ai/core/tool/get-task-output"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { executeTool, settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const parentID = SessionSchema.ID.make("ses_task_output_parent")
const otherParentID = SessionSchema.ID.make("ses_task_output_other_parent")
const NOT_FOUND = "Task not found or not owned"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      EventV2.node,
      SessionProjector.node,
      TaskSubmission.node,
      BackgroundJob.node,
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      GetTaskOutputTool.node,
    ]),
    [[ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig]],
  ),
)

const call = (input: typeof GetTaskOutputTool.Input.Type, sessionID = parentID, id = "call-get-task-output") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: GetTaskOutputTool.name, input },
})

const setup = (childSessionIDs: ReadonlyArray<SessionSchema.ID>) =>
  Effect.gen(function* () {
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
          id: parentID,
          project_id: Project.ID.global,
          slug: "task-output-parent",
          directory: "/project",
          title: "task output parent",
          version: "test",
        },
        {
          id: otherParentID,
          project_id: Project.ID.global,
          slug: "task-output-other-parent",
          directory: "/project",
          title: "task output other parent",
          version: "test",
        },
        ...childSessionIDs.map((id) => ({
          id,
          project_id: Project.ID.global,
          parent_id: parentID,
          slug: id,
          directory: "/project",
          title: id,
          version: "test",
        })),
      ])
      .run()
      .pipe(Effect.orDie)
  })

const submit = (childSessionID: SessionSchema.ID, parentSessionID = parentID) =>
  Effect.gen(function* () {
    const submissions = yield* TaskSubmission.Service
    return yield* submissions.submit({
      parentSessionID,
      assistantMessageID: SessionMessage.ID.make(`msg_${parentSessionID}_${childSessionID}`),
      toolCallID: `call_${parentSessionID}_${childSessionID}`,
      childSessionID,
      description: `Task ${childSessionID}`,
      prompt: Prompt.make({ text: `Run ${childSessionID}` }),
      agent: "general",
      completionDelivery: "parent",
    })
  })

describe("GetTaskOutputTool", () => {
  it.effect("trims and deduplicates IDs in first-seen order and caps raw input at 20 IDs", () =>
    Effect.gen(function* () {
      const first = SessionSchema.ID.make("ses_task_output_first")
      const second = SessionSchema.ID.make("ses_task_output_second")
      const third = SessionSchema.ID.make("ses_task_output_third")
      yield* setup([first, second, third])
      yield* Effect.all([submit(first), submit(second), submit(third)], { concurrency: "unbounded" })
      const registry = yield* ToolRegistry.Service

      const normalized = yield* settleTool(registry, call({ task_ids: [`  ${second}  `, first, second, ` ${third}`] }))
      expect(normalized.output?.structured).toEqual([
        expect.objectContaining({ taskID: second }),
        expect.objectContaining({ taskID: first }),
        expect.objectContaining({ taskID: third }),
      ])

      expect(
        yield* executeTool(
          registry,
          call({ task_ids: Array.from({ length: 20 }, (_, index) => `ses_task_output_missing_${index}`) }),
        ),
      ).toEqual({ type: "error", value: NOT_FOUND })
      expect(
        yield* executeTool(
          registry,
          call({ task_ids: Array.from({ length: 21 }, (_, index) => `ses_task_output_excess_${index}`) }),
        ),
      ).toMatchObject({ type: "error", value: expect.stringContaining("Invalid tool input") })
    }),
  )

  it.effect("rejects empty task lists and timeout values outside the bounded integer range", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const invalid = [
        { task_ids: [] },
        { task_ids: ["ses_task_output_missing"], timeout_ms: -1 },
        { task_ids: ["ses_task_output_missing"], timeout_ms: 1.5 },
        { task_ids: ["ses_task_output_missing"], timeout_ms: 600_001 },
      ]

      const results = yield* Effect.forEach(invalid, (input, index) =>
        executeTool(registry, call(input, parentID, `call-invalid-${index}`)),
      )
      results.forEach((result) =>
        expect(result).toMatchObject({ type: "error", value: expect.stringContaining("Invalid tool input") }),
      )
    }),
  )

  it.effect("settles malformed and whitespace task IDs as controlled failures", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const results = yield* Effect.forEach(["", "   ", "foo"], (taskID, index) =>
        executeTool(registry, call({ task_ids: [taskID] }, parentID, `call-malformed-${index}`)),
      )

      expect(results).toEqual([
        { type: "error", value: "Invalid task ID" },
        { type: "error", value: "Invalid task ID" },
        { type: "error", value: "Invalid task ID" },
      ])
    }),
  )

  it.effect("returns immediate durable snapshots when timeout is omitted or zero", () =>
    Effect.gen(function* () {
      const acceptedID = SessionSchema.ID.make("ses_task_output_accepted")
      const runningID = SessionSchema.ID.make("ses_task_output_running")
      yield* setup([acceptedID, runningID])
      yield* submit(acceptedID)
      const running = yield* submit(runningID)
      const submissions = yield* TaskSubmission.Service
      yield* submissions.claim(running.id)
      const registry = yield* ToolRegistry.Service

      expect((yield* settleTool(registry, call({ task_ids: [acceptedID] }))).output?.structured).toEqual([
        expect.objectContaining({ taskID: acceptedID, status: "accepted" }),
      ])
      expect((yield* settleTool(registry, call({ task_ids: [runningID], timeout_ms: 0 }))).output?.structured).toEqual([
        expect.objectContaining({ taskID: runningID, status: "running" }),
      ])
    }),
  )

  it.effect("returns owned live shell output and hides it from other sessions", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const release = yield* Deferred.make<void>()
      const taskID = "job_shelloutput1"
      yield* jobs.start({
        id: taskID,
        type: "shell",
        title: "build workspace",
        metadata: { sessionID: parentID, agent: "build-agent", outputBytes: 0 },
        run: Deferred.await(release).pipe(Effect.as("build complete")),
      })
      yield* jobs.update({
        id: taskID,
        output: "compiling package\n",
        metadata: { outputBytes: 18, lastOutputAt: 1234 },
      })
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, call({ task_ids: [taskID] }))
      expect(settled.output?.structured).toEqual([
        {
          taskID,
          status: "running",
          description: "build workspace",
          agent: "build-agent",
          kind: "shell",
          timeCreated: expect.any(Number),
          result: "compiling package\n",
          outputBytes: 18,
          lastOutputAt: 1234,
          runningForMs: expect.any(Number),
          idleForMs: expect.any(Number),
        },
      ])
      expect(settled.result).toMatchObject({
        type: "text",
        value: expect.stringContaining("the process is still owned and its last output was"),
      })
      expect(
        yield* executeTool(registry, call({ task_ids: [taskID] }, otherParentID, "call-shell-other-owner")),
      ).toEqual({ type: "error", value: NOT_FOUND })

      yield* Deferred.succeed(release, undefined)
      yield* jobs.wait({ id: taskID })
    }),
  )

  it.effect("waits for a live shell owner and returns its terminal output", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const release = yield* Deferred.make<void>()
      const taskID = "job_shellwait1"
      yield* jobs.start({
        id: taskID,
        type: "shell",
        title: "run tests",
        metadata: { sessionID: parentID, agent: "worker", outputBytes: 0 },
        run: Deferred.await(release).pipe(Effect.as("tests passed")),
      })
      const registry = yield* ToolRegistry.Service
      const waiting = yield* settleTool(registry, call({ task_ids: [taskID], timeout_ms: 5_000 })).pipe(
        Effect.forkScoped,
      )

      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(waiting)).output?.structured).toEqual([
        {
          taskID,
          status: "completed",
          description: "run tests",
          agent: "worker",
          kind: "shell",
          timeCreated: expect.any(Number),
          timeCompleted: expect.any(Number),
          result: "tests passed",
          outputBytes: 0,
        },
      ])
    }),
  )

  it.effect("waits for all tasks and then re-reads durable task state", () =>
    Effect.gen(function* () {
      const firstID = SessionSchema.ID.make("ses_task_output_wait_first")
      const secondID = SessionSchema.ID.make("ses_task_output_wait_second")
      yield* setup([firstID, secondID])
      const first = yield* submit(firstID)
      const second = yield* submit(secondID)
      const submissions = yield* TaskSubmission.Service
      const jobs = yield* BackgroundJob.Service
      const releaseFirst = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const completedFirst = yield* Deferred.make<void>()
      const completedSecond = yield* Deferred.make<void>()
      yield* jobs.start({
        id: firstID,
        type: "task",
        run: Deferred.await(releaseFirst).pipe(
          Effect.andThen(
            submissions.terminalize({ submissionID: first.id, outcome: "completed", resultText: "first result" }),
          ),
          Effect.tap(() => Deferred.succeed(completedFirst, undefined)),
          Effect.as("first result"),
        ),
      })
      yield* jobs.start({
        id: secondID,
        type: "task",
        run: Deferred.await(releaseSecond).pipe(
          Effect.andThen(
            submissions.terminalize({ submissionID: second.id, outcome: "completed", resultText: "second result" }),
          ),
          Effect.tap(() => Deferred.succeed(completedSecond, undefined)),
          Effect.as("second result"),
        ),
      })
      const registry = yield* ToolRegistry.Service
      const waiting = yield* settleTool(registry, call({ task_ids: [firstID, secondID], timeout_ms: 5_000 })).pipe(
        Effect.forkScoped,
      )

      yield* Effect.yieldNow
      yield* Deferred.succeed(releaseFirst, undefined)
      yield* Deferred.await(completedFirst)
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releaseSecond, undefined)
      yield* Deferred.await(completedSecond)
      yield* TestClock.adjust(1_000)

      expect((yield* Fiber.join(waiting)).output?.structured).toEqual([
        expect.objectContaining({ taskID: firstID, status: "completed", result: "first result" }),
        expect.objectContaining({ taskID: secondID, status: "completed", result: "second result" }),
      ])
    }),
  )

  it.effect("uses one bounded deadline for concurrent process-local waits", () =>
    Effect.gen(function* () {
      const firstID = SessionSchema.ID.make("ses_task_output_timeout_first")
      const secondID = SessionSchema.ID.make("ses_task_output_timeout_second")
      yield* setup([firstID, secondID])
      const first = yield* submit(firstID)
      const second = yield* submit(secondID)
      const submissions = yield* TaskSubmission.Service
      yield* submissions.claim(first.id)
      yield* submissions.claim(second.id)
      const jobs = yield* BackgroundJob.Service
      yield* jobs.start({ id: firstID, type: "task", run: Effect.never })
      yield* jobs.start({ id: secondID, type: "task", run: Effect.never })
      const registry = yield* ToolRegistry.Service
      const waiting = yield* settleTool(registry, call({ task_ids: [firstID, secondID], timeout_ms: 100 })).pipe(
        Effect.forkScoped,
      )

      yield* Effect.yieldNow
      yield* TestClock.adjust(99)
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust(1)
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeDefined()
      expect((yield* Fiber.join(waiting)).output?.structured).toEqual([
        {
          taskID: firstID,
          status: "running",
          description: `Task ${firstID}`,
          agent: "general",
          timeCreated: expect.any(Number),
          timedOut: true,
        },
        {
          taskID: secondID,
          status: "running",
          description: `Task ${secondID}`,
          agent: "general",
          timeCreated: expect.any(Number),
          timedOut: true,
        },
      ])
      yield* jobs.cancel(firstID)
      yield* jobs.cancel(secondID)
    }),
  )

  it.effect("maps completed, error, cancelled, and recovery-required durable records", () =>
    Effect.gen(function* () {
      const completedID = SessionSchema.ID.make("ses_task_output_completed")
      const errorID = SessionSchema.ID.make("ses_task_output_error")
      const cancelledID = SessionSchema.ID.make("ses_task_output_cancelled")
      const recoveryID = SessionSchema.ID.make("ses_task_output_recovery")
      yield* setup([completedID, errorID, cancelledID, recoveryID])
      const submissions = yield* TaskSubmission.Service
      const completed = yield* submit(completedID)
      const failed = yield* submit(errorID)
      const cancelled = yield* submit(cancelledID)
      const recovery = yield* submit(recoveryID)
      yield* submissions.terminalize({
        submissionID: completed.id,
        outcome: "completed",
        resultText: "completed result",
      })
      yield* submissions.terminalize({
        submissionID: failed.id,
        outcome: "error",
        error: { message: "provider failed" },
      })
      yield* submissions.terminalize({
        submissionID: cancelled.id,
        outcome: "cancelled",
        error: { message: "cancelled by parent" },
      })
      yield* submissions.terminalize({
        submissionID: recovery.id,
        outcome: "recovery-required",
        error: { message: "recovery decision required" },
      })
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, call({ task_ids: [completedID, errorID, cancelledID, recoveryID] }))
      expect(settled.output?.structured).toEqual([
        {
          taskID: completedID,
          status: "completed",
          description: `Task ${completedID}`,
          agent: "general",
          timeCreated: expect.any(Number),
          timeCompleted: expect.any(Number),
          result: "completed result",
        },
        {
          taskID: errorID,
          status: "error",
          description: `Task ${errorID}`,
          agent: "general",
          timeCreated: expect.any(Number),
          timeCompleted: expect.any(Number),
          error: { message: "provider failed" },
        },
        {
          taskID: cancelledID,
          status: "cancelled",
          description: `Task ${cancelledID}`,
          agent: "general",
          timeCreated: expect.any(Number),
          timeCompleted: expect.any(Number),
          error: { message: "cancelled by parent" },
        },
        {
          taskID: recoveryID,
          status: "recovery-required",
          description: `Task ${recoveryID}`,
          agent: "general",
          timeCreated: expect.any(Number),
          timeCompleted: expect.any(Number),
          error: { message: "recovery decision required" },
        },
      ])
      expect(settled.result).toMatchObject({
        type: "content",
        value: [
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining(`id="${completedID}" state="completed"`),
          }),
          expect.objectContaining({ type: "text", text: expect.stringContaining(`id="${errorID}" state="error"`) }),
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining(`id="${cancelledID}" state="cancelled"`),
          }),
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining(`id="${recoveryID}" state="recovery-required"`),
          }),
        ],
      })
    }),
  )

  it.effect("uses the same failure for unknown and non-owned task IDs", () =>
    Effect.gen(function* () {
      const nonOwnedID = SessionSchema.ID.make("ses_task_output_non_owned")
      yield* setup([nonOwnedID])
      yield* submit(nonOwnedID, otherParentID)
      const registry = yield* ToolRegistry.Service

      const nonOwned = yield* executeTool(registry, call({ task_ids: [nonOwnedID] }))
      const unknown = yield* executeTool(
        registry,
        call({ task_ids: ["ses_task_output_unknown"] }, parentID, "call-get-task-output-unknown"),
      )
      const missingShell = yield* executeTool(
        registry,
        call({ task_ids: ["job_missingowner1"] }, parentID, "call-get-task-output-missing-shell"),
      )
      expect(nonOwned).toEqual({ type: "error", value: NOT_FOUND })
      expect(unknown).toEqual(nonOwned)
      expect(missingShell).toEqual(nonOwned)
    }),
  )

  it.effect("keeps waiting without a process-local job and observes durable completion", () =>
    Effect.gen(function* () {
      const childID = SessionSchema.ID.make("ses_task_output_restarted")
      yield* setup([childID])
      const submitted = yield* submit(childID)
      const submissions = yield* TaskSubmission.Service
      yield* submissions.claim(submitted.id)
      const registry = yield* ToolRegistry.Service
      const waiting = yield* settleTool(registry, call({ task_ids: [childID], timeout_ms: 600_000 })).pipe(
        Effect.forkScoped,
      )

      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* submissions.terminalize({ submissionID: submitted.id, outcome: "completed", resultText: "recovered" })
      yield* TestClock.adjust(1_000)
      expect((yield* Fiber.join(waiting)).output?.structured).toEqual([
        expect.objectContaining({ taskID: childID, status: "completed", result: "recovered" }),
      ])
    }),
  )

  it.effect("returns early when new steer input arrives during a bounded wait", () =>
    Effect.gen(function* () {
      const childID = SessionSchema.ID.make("ses_task_output_steered")
      yield* setup([childID])
      const submitted = yield* submit(childID)
      const submissions = yield* TaskSubmission.Service
      yield* submissions.claim(submitted.id)
      const registry = yield* ToolRegistry.Service
      const waiting = yield* settleTool(registry, call({ task_ids: [childID], timeout_ms: 600_000 })).pipe(
        Effect.forkScoped,
      )

      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      yield* SessionInput.admit(db, events, {
        id: SessionMessage.ID.make("msg_task_output_steer"),
        sessionID: parentID,
        prompt: Prompt.make({ text: "New direction" }),
        delivery: "steer",
      })
      yield* TestClock.adjust(1_000)

      const result = (yield* Fiber.join(waiting)).output?.structured
      expect(result).toEqual([expect.objectContaining({ taskID: childID, status: "running" })])
      expect(result).not.toEqual([expect.objectContaining({ timedOut: true })])
    }),
  )

  it.effect("shares task permission visibility with the task tool", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const denied = [{ action: "*", resource: "*", effect: "deny" as const }]
      const allowed = [...denied, { action: "task", resource: "*", effect: "allow" as const }]

      expect(yield* toolDefinitions(registry, denied)).toEqual([])
      expect((yield* toolDefinitions(registry, allowed)).map((definition) => definition.name)).toEqual([
        GetTaskOutputTool.name,
      ])
    }),
  )
})
