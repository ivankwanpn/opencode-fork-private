import { describe, expect } from "bun:test"
import type { SessionHookSpec } from "@opencode-ai/plugin/v2/effect"
import { DateTime, Deferred, Effect, Fiber, Layer, Scope, Stream } from "effect"
import { asc, eq } from "drizzle-orm"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { EventTable } from "@opencode-ai/core/event/sql"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionCommand } from "@opencode-ai/core/session/command"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { testEffect } from "./lib/effect"
import { pluginLocationMap } from "./lib/location-service-map"

const executionCalls: SessionV2.ID[] = []
const interruptCalls: SessionV2.ID[] = []
const wakeCalls: SessionV2.ID[] = []
const activeSessions = new Set<SessionV2.ID>()
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    exclusive: (_sessionID, work) => work,
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
      }),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
    wait: () => Effect.void,
  }),
)
const pluginLocation = pluginLocationMap()
const pluginRuntime = pluginLocation.runtime
const sessionNodes = LayerNode.group([
  Database.node,
  EventV2.node,
  SessionProjector.node,
  SessionStore.node,
  SessionCommand.node,
  SessionV2.node,
])
const it = testEffect(
  AppNodeBuilder.build(sessionNodes, [pluginLocation.replacement, [SessionExecution.node, execution]]),
)
let attachmentMaterializeCalls = 0
const attachmentLocation = pluginLocationMap(undefined, {
  materializeFile: (file) => Effect.succeed(file),
  materialize: (prompt) =>
    Effect.sync(() => {
      attachmentMaterializeCalls++
      return Prompt.make({
        ...prompt,
        files: prompt.files?.map((file) => ({
          ...file,
          materialized: [
            {
              type: "text" as const,
              text: `materialized:${file.uri}`,
            },
          ],
        })),
      })
    }),
})
const itWithAttachments = testEffect(
  AppNodeBuilder.build(sessionNodes, [attachmentLocation.replacement, [SessionExecution.node, execution]]),
)
let agentGuidanceCalls = 0
let observedGuidanceAgent: AgentV2.ID | undefined
const guidanceLocation = pluginLocationMap(undefined, undefined, (prompt, activeAgent) =>
  Effect.sync(() => {
    agentGuidanceCalls++
    observedGuidanceAgent = activeAgent
    return Prompt.make({
      ...prompt,
      agents: prompt.agents?.map((agent) => ({
        ...agent,
        guidance: `expanded:${activeAgent ?? "default"}:${agent.name}`,
      })),
    })
  }),
)
const itWithAgentGuidance = testEffect(
  AppNodeBuilder.build(sessionNodes, [guidanceLocation.replacement, [SessionExecution.node, execution]]),
)
let blockingWakeStarted: Deferred.Deferred<void> | undefined
let releaseBlockingWake: Deferred.Deferred<void> | undefined
const blockingWakeObservations: string[] = []
const blockingWakeExecution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return SessionExecution.Service.of({
      active: Effect.sync(() => new Set(activeSessions)),
      resume: (sessionID) =>
        Effect.sync(() => {
          executionCalls.push(sessionID)
        }),
      exclusive: (_sessionID, work) => work,
      interrupt: (sessionID) =>
        Effect.sync(() => {
          interruptCalls.push(sessionID)
        }),
      wake: (sessionID) =>
        Effect.gen(function* () {
          const pending = yield* SessionInput.pending(db, sessionID)
          blockingWakeObservations.push(pending.length > 0 ? "committed" : "missing")
          if (blockingWakeStarted) yield* Deferred.succeed(blockingWakeStarted, undefined)
          if (releaseBlockingWake) yield* Deferred.await(releaseBlockingWake)
          return yield* Effect.die(new Error("late wake failure"))
        }),
      wait: () => Effect.void,
    })
  }),
)
const itWithBlockingWake = testEffect(
  AppNodeBuilder.build(sessionNodes, [pluginLocation.replacement, [SessionExecution.node, blockingWakeExecution]]),
)
let interruptingWakeStarted: Deferred.Deferred<void> | undefined
const interruptingWakeCalls: SessionV2.ID[] = []
const interruptingWakeExecution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    active: Effect.sync(() => new Set(activeSessions)),
    resume: (sessionID) =>
      Effect.sync(() => {
        executionCalls.push(sessionID)
      }),
    exclusive: (_sessionID, work) => work,
    interrupt: (sessionID) =>
      Effect.sync(() => {
        interruptCalls.push(sessionID)
      }),
    wake: (sessionID) =>
      Effect.gen(function* () {
        interruptingWakeCalls.push(sessionID)
        if (interruptingWakeStarted) yield* Deferred.succeed(interruptingWakeStarted, undefined)
      }),
    wait: () => Effect.void,
  }),
)
const itWithInterruptingWake = testEffect(
  AppNodeBuilder.build(sessionNodes, [pluginLocation.replacement, [SessionExecution.node, interruptingWakeExecution]]),
)
const sessionID = SessionV2.ID.make("ses_prompt_test")
const messageID = SessionMessage.ID.create()
const realWaitStepMs = 10
const realWaitAttempts = 500

function realSleep() {
  return Effect.promise(() => Bun.sleep(realWaitStepMs))
}

function waitFor(label: string, check: () => boolean, remaining = realWaitAttempts): Effect.Effect<void, Error> {
  return Effect.suspend(() => {
    if (check()) return Effect.void
    if (remaining <= 0)
      return Effect.fail(new Error(`Timed out waiting for ${label} after ${realWaitStepMs * realWaitAttempts}ms`))
    return realSleep().pipe(Effect.andThen(waitFor(label, check, remaining - 1)))
  })
}

function awaitDeferred<A, E>(
  label: string,
  deferred: Deferred.Deferred<A, E>,
  remaining = realWaitAttempts,
): Effect.Effect<A, E | Error> {
  return Effect.suspend(() =>
    Deferred.poll(deferred).pipe(
      Effect.flatMap((result) => {
        if (result._tag === "Some") return result.value
        if (remaining <= 0)
          return Effect.fail(new Error(`Timed out waiting for ${label} after ${realWaitStepMs * realWaitAttempts}ms`))
        return realSleep().pipe(Effect.andThen(awaitDeferred(label, deferred, remaining - 1)))
      }),
    ),
  )
}

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "test",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const admitted = (id: SessionMessage.ID) => Database.Service.use(({ db }) => SessionInput.find(db, id))
const admittedCount = Database.Service.use(({ db }) =>
  db
    .select()
    .from(SessionInputTable)
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => rows.length),
    ),
)
const eventCount = (type: string) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(EventTable)
      .where(eq(EventTable.type, type))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.length),
      ),
  )

describe("SessionV2.prompt", () => {
  it.effect("exposes the execution registry", () =>
    Effect.gen(function* () {
      activeSessions.add(sessionID)
      expect(Array.from(yield* (yield* SessionV2.Service).active)).toEqual([sessionID])
    }).pipe(Effect.ensuring(Effect.sync(() => activeSessions.clear()))),
  )

  it.effect("delegates execution continuation through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("delegates process-local interruption through SessionExecution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      interruptCalls.length = 0

      yield* session.interrupt(sessionID)
      expect(interruptCalls).toEqual([sessionID])
      expect(yield* session.messages({ sessionID })).toEqual([])
    }),
  )

  it.effect("delegates interruption without requiring a recorded Session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      interruptCalls.length = 0

      yield* session.interrupt(SessionV2.ID.make("ses_missing"))
      expect(interruptCalls).toEqual([SessionV2.ID.make("ses_missing")])
    }),
  )

  it.effect("durably admits one user message before transcript promotion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      })

      expect(message.prompt.text).toBe("Fix the failing tests")
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).toMatchObject({
        id: message.id,
        sessionID,
        prompt: { text: "Fix the failing tests" },
        delivery: "steer",
      })
    }),
  )

  it.effect("resolves attachment MIME before admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      const message = yield* session.prompt({
        sessionID,
        prompt: {
          text: "Inspect this image",
          files: [{ uri: "data:image/png;base64,aGVsbG8=", name: "image.png" }],
        },
        resume: false,
      })

      expect(message.prompt.files).toEqual([
        { uri: "data:image/png;base64,aGVsbG8=", name: "image.png", mime: "image/png" },
      ])
      expect((yield* admitted(message.id))?.prompt.files).toEqual(message.prompt.files)
    }),
  )

  itWithAttachments.effect(
    "materializes plugin-added attachments after message hooks and only once across exact retries",
    () =>
      Effect.gen(function* () {
        yield* setup
        const session = yield* SessionV2.Service
        const id = SessionMessage.ID.make("msg_attachment_materialization")
        attachmentMaterializeCalls = 0
        yield* attachmentLocation.runtime.hook<SessionHookSpec["message.before"]>(
          PluginRuntime.HookName.sessionMessageBefore,
          (event) => {
            event.parts.update((parts) => {
              const text = parts[0]!
              return [
                ...parts,
                {
                  id: `prt_${event.message.get().id}_file_plugin`,
                  sessionID: text.sessionID,
                  messageID: text.messageID,
                  type: "file",
                  mime: "text/plain",
                  filename: "plugin.txt",
                  url: "https://example.com/plugin.txt",
                },
              ]
            })
          },
        )

        const input = {
          id,
          sessionID,
          prompt: Prompt.make({ text: "Inspect plugin output" }),
          resume: false,
        } as const
        const first = yield* session.prompt(input)
        const retry = yield* session.prompt(input)

        expect(retry).toEqual(first)
        expect(attachmentMaterializeCalls).toBe(1)
        expect(first.prompt.files).toEqual([
          {
            uri: "https://example.com/plugin.txt",
            mime: "text/plain",
            name: "plugin.txt",
            materialized: [
              {
                type: "text",
                text: "materialized:https://example.com/plugin.txt",
              },
            ],
          },
        ])
        expect((yield* admitted(id))?.prompt).toEqual(first.prompt)
      }),
  )

  itWithAgentGuidance.effect(
    "materializes plugin-added and renamed agent guidance after hooks only once across exact retries",
    () =>
      Effect.gen(function* () {
        yield* setup
        const session = yield* SessionV2.Service
        const id = SessionMessage.ID.make("msg_agent_guidance")
        agentGuidanceCalls = 0
        observedGuidanceAgent = undefined
        yield* guidanceLocation.runtime.hook<SessionHookSpec["message.before"]>(
          PluginRuntime.HookName.sessionMessageBefore,
          (event) => {
            event.message.update((message) => ({
              ...message,
              agent: "review",
            }))
            event.parts.update((parts) => {
              const renamed = parts.map((part) => (part.type === "agent" ? { ...part, name: "research" } : part))
              const text = renamed[0]!
              return [
                ...renamed,
                {
                  id: `prt_${event.message.get().id}_agent_plugin`,
                  sessionID: text.sessionID,
                  messageID: text.messageID,
                  type: "agent",
                  name: "added",
                },
              ]
            })
          },
        )

        const input = {
          id,
          sessionID,
          prompt: Prompt.make({
            text: "Delegate",
            agents: [{ name: "general" }],
          }),
          resume: false,
        } as const
        const first = yield* session.prompt(input)
        const retry = yield* session.prompt(input)

        expect(retry).toEqual(first)
        expect(agentGuidanceCalls).toBe(1)
        expect(String(observedGuidanceAgent)).toBe("review")
        expect(first.prompt.agents).toEqual([
          {
            name: "research",
            guidance: "expanded:review:research",
          },
          {
            name: "added",
            guidance: "expanded:review:added",
          },
        ])
        expect((yield* admitted(id))?.prompt).toEqual(first.prompt)
      }),
  )

  it.effect("applies message hooks before durable prompt admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* pluginRuntime.hook<SessionHookSpec["message.before"]>(
        PluginRuntime.HookName.sessionMessageBefore,
        (event) => {
          event.message.update((message) => ({
            ...message,
            agent: "review",
            model: { providerID: "test-provider", modelID: "test-model", variant: "careful" },
            system: "Plugin policy",
            tools: { echo: false },
          }))
          event.parts.update((parts) =>
            parts.map((part) => {
              if (part.type === "text") return { ...part, text: `${part.text} [checked]` }
              if (part.type === "file") return { ...part, filename: "renamed.txt" }
              if (part.type === "agent") return { ...part, name: "research" }
              return part
            }),
          )
        },
      )

      const admitted = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({
          text: "Inspect",
          files: [{ uri: "data:text/plain;base64,aGVsbG8=", mime: "text/plain", name: "original.txt" }],
          agents: [{ name: "general" }],
          system: "Initial policy",
          tools: { echo: true },
          format: {
            type: "json_schema",
            schema: { type: "object", properties: { answer: { type: "string" } } },
          },
        }),
        resume: false,
      })

      expect(admitted.prompt).toEqual({
        text: "Inspect [checked]",
        files: [{ uri: "data:text/plain;base64,aGVsbG8=", mime: "text/plain", name: "renamed.txt" }],
        agents: [{ name: "research" }],
        system: "Plugin policy",
        tools: { echo: false },
        format: {
          type: "json_schema",
          schema: { type: "object", properties: { answer: { type: "string" } } },
        },
      })
      expect(yield* session.get(sessionID)).toMatchObject({
        agent: "review",
        model: { providerID: "test-provider", id: "test-model", variant: "careful" },
      })
    }),
  )

  it.effect("resolves native prompt mentions before message hooks and admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      yield* pluginRuntime.hook<SessionHookSpec["message.before"]>(
        PluginRuntime.HookName.sessionMessageBefore,
        (event) => {
          expect(event.parts.get()).toMatchObject([
            { type: "text", text: "Ask @research" },
            { type: "agent", name: "research" },
          ])
          event.parts.update((parts) =>
            parts.map((part) => (part.type === "agent" ? { ...part, name: "review" } : part)),
          )
        },
      )

      const result = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Ask @research" }),
        resume: false,
      })

      expect(result.prompt).toEqual({ text: "Ask @research", agents: [{ name: "review" }] })
      expect((yield* admitted(result.id))?.prompt).toEqual(result.prompt)
    }),
  )

  it.effect("expands native commands before message hooks and durable admission", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const id = SessionMessage.ID.make("msg_native_command")
      yield* pluginRuntime.hook<SessionHookSpec["message.before"]>(
        PluginRuntime.HookName.sessionMessageBefore,
        (event) => {
          expect(event.parts.get()).toMatchObject([{ type: "text", text: "Expanded /review: src tests" }])
          event.parts.update((parts) =>
            parts.map((part) => (part.type === "text" ? { ...part, text: `${part.text} [message-hook]` } : part)),
          )
        },
      )

      const first = yield* session.command({
        id,
        sessionID,
        command: "review",
        arguments: "src tests",
        resume: false,
      })
      const retried = yield* session.command({
        id,
        sessionID,
        command: "review",
        arguments: "src tests",
        resume: false,
      })

      expect(first.prompt).toEqual({ text: "Expanded /review: src tests [message-hook]" })
      expect(retried).toEqual(first)
      expect(yield* admittedCount).toBe(1)

      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)
      yield* events.remove(sessionID)
      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )

      expect((yield* admitted(id))?.prompt).toEqual(first.prompt)
    }),
  )

  it.effect("applies command-selected agent and model only after admission", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const result = yield* session.command({
        sessionID,
        command: "switch",
        arguments: "",
        resume: false,
      })

      expect(result.prompt).toEqual({ text: "Expanded /switch: " })
      expect(yield* session.get(sessionID)).toMatchObject({
        agent: "review",
        model: { providerID: "command-provider", id: "command-model" },
      })
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("does not durably admit a command that fails expansion", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const failure = yield* session
        .command({
          id: SessionMessage.ID.make("msg_failed_native_command"),
          sessionID,
          command: "missing",
          arguments: "",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "SessionPromptExpansion.CommandNotFound",
        command: "missing",
      })
      expect(yield* admittedCount).toBe(0)
      expect(yield* eventCount(EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1))).toBe(0)
    }),
  )

  it.effect("streams durable Session events after an aggregate sequence", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const fiber = yield* session.events({ sessionID }).pipe(Stream.take(4), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "First" }), resume: false })
      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Second" }), resume: false })
      yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
      const streamed = Array.from(yield* Fiber.join(fiber))

      expect(streamed.map((event) => [event.durable?.seq, event.type])).toEqual([
        [0, "session.next.prompt.admitted"],
        [1, "session.next.prompt.admitted"],
        [2, "session.next.prompted"],
        [3, "session.next.prompted"],
      ])
      expect(
        Array.from(
          yield* session
            .events({ sessionID, after: streamed[0]!.durable?.seq })
            .pipe(Stream.take(1), Stream.runCollect),
        ).map((event) => [event.durable?.seq, event.type]),
      ).toEqual([[1, "session.next.prompt.admitted"]])
    }),
  )

  it.effect("resumes through a recorded message without appending another prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const message = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      })

      executionCalls.length = 0
      wakeCalls.length = 0
      yield* session.resume(sessionID)

      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admitted(message.id)).not.toHaveProperty("promotedSeq")
      expect(executionCalls).toEqual([sessionID])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("records distinct messages when the ID is omitted", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = { sessionID, prompt: Prompt.make({ text: "Fix the failing tests" }), resume: false }

      const first = yield* session.prompt(input)
      const second = yield* session.prompt(input)

      expect(second.id).not.toBe(first.id)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(2)
    }),
  )

  it.effect("returns the original recorded message when the ID is retried", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      }

      const first = yield* session.prompt(input)
      const retried = yield* session.prompt(input)

      expect(retried).toEqual(first)
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("wakes execution when an exact prompt retry recovers a committed message", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Recover committed prompt" }),
        resume: false,
      }
      const first = yield* session.prompt(input)
      wakeCalls.length = 0

      const retried = yield* session.prompt({ ...input, resume: true })

      expect(retried).toEqual(first)
      yield* waitFor("wake call", () => wakeCalls.length >= 1)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("rejects reuse of one ID with a different prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
      })
      const failure = yield* session
        .prompt({
          sessionID,
          id: messageID,
          prompt: Prompt.make({ text: "Delete the failing tests" }),
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
      expect(yield* session.messages({ sessionID })).toHaveLength(0)
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("reconciles durable synthetic inputs by source and description", () =>
    Effect.gen(function* () {
      yield* setup
      const commands = yield* SessionCommand.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const id = SessionMessage.ID.make("msg_synthetic_retry")
      const input = {
        id,
        sessionID,
        text: "<task_result>complete</task_result>",
        description: "Background task completed: inspect flow",
        delivery: "steer" as const,
      }

      const first = yield* commands.admitSynthetic(input)
      expect(yield* commands.admitSynthetic(input)).toEqual(first)
      expect(
        yield* commands
          .admitSynthetic({ ...input, description: "Background task failed: inspect flow" })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.PromptConflictError", messageID: id })
      expect(
        yield* session
          .prompt({ id, sessionID, prompt: Prompt.make({ text: input.text }), resume: false })
          .pipe(Effect.flip),
      ).toMatchObject({ _tag: "Session.PromptConflictError", messageID: id })

      yield* SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER)
      expect(yield* session.messages({ sessionID })).toEqual([
        expect.objectContaining({
          id,
          type: "synthetic",
          text: input.text,
          description: input.description,
        }),
      ])
    }),
  )

  it.effect("includes prompt policy in idempotent admission equivalence", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const prompt = Prompt.make({
        text: "Use policy",
        system: "Answer tersely",
        tools: { echo: true, defect: false },
      })

      const first = yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })
      expect(yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })).toEqual(first)

      const changedSystem = yield* session
        .prompt({
          id: messageID,
          sessionID,
          prompt: Prompt.make({ ...prompt, system: "Answer verbosely" }),
          resume: false,
        })
        .pipe(Effect.flip)
      const changedTools = yield* session
        .prompt({
          id: messageID,
          sessionID,
          prompt: Prompt.make({ ...prompt, tools: { echo: false, defect: false } }),
          resume: false,
        })
        .pipe(Effect.flip)

      expect(changedSystem._tag).toBe("Session.PromptConflictError")
      expect(changedTools._tag).toBe("Session.PromptConflictError")
      expect(yield* admittedCount).toBe(1)
    }),
  )

  it.effect("rejects reuse of one ID with a different delivery mode", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service

      yield* session.prompt({
        id: messageID,
        sessionID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      })
      const failure = yield* session
        .prompt({
          id: messageID,
          sessionID,
          prompt: Prompt.make({ text: "Fix the failing tests" }),
          delivery: "queue",
          resume: false,
        })
        .pipe(Effect.flip)

      expect(failure._tag).toBe("Session.PromptConflictError")
    }),
  )

  it.effect("returns one recorded message to concurrent exact retries", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const input = {
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "Fix the failing tests" }),
        resume: false,
      }

      const messages = yield* Effect.all([session.prompt(input), session.prompt(input)], { concurrency: "unbounded" })

      expect(messages[1]).toEqual(messages[0])
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(yield* admittedCount).toBe(1)
      expect(yield* eventCount(EventV2.versionedType(SessionEvent.PromptAdmitted.type, 1))).toBe(1)
    }),
  )

  it.effect("promotes one message once under concurrent promotion attempts", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      yield* session.prompt({
        id: messageID,
        sessionID,
        prompt: Prompt.make({
          text: "Promote once",
          system: "Promoted policy",
          tools: { echo: false },
        }),
        resume: false,
      })

      yield* Effect.all(
        [
          SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER),
          SessionInput.promoteSteers(db, events, sessionID, Number.MAX_SAFE_INTEGER),
        ],
        { concurrency: "unbounded" },
      )

      expect(yield* eventCount(EventV2.versionedType(SessionEvent.Prompted.type, 1))).toBe(1)
      expect(yield* admitted(messageID)).toMatchObject({ promotedSeq: 1 })
      expect(yield* session.messages({ sessionID })).toMatchObject([
        {
          id: messageID,
          type: "user",
          text: "Promote once",
          system: "Promoted policy",
          tools: { echo: false },
        },
      ])
    }),
  )

  it.effect("promotes steers only through the captured inbox cutoff", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const first = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Before cutoff" }), resume: false })
      const cutoff = first.admittedSeq
      const second = yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "After cutoff" }), resume: false })

      yield* SessionInput.promoteSteers(db, events, sessionID, cutoff)

      expect(yield* admitted(first.id)).toHaveProperty("promotedSeq")
      expect(yield* admitted(second.id)).not.toHaveProperty("promotedSeq")
    }),
  )

  it.effect("reprojects pending inbox input without scheduling execution", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      wakeCalls.length = 0
      yield* session.prompt({
        id: messageID,
        sessionID,
        prompt: Prompt.make({
          text: "Replay pending",
          system: "Replay policy",
          tools: { echo: true },
          format: {
            type: "json_schema",
            schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
          },
        }),
        resume: false,
      })
      const recorded = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
        .pipe(Effect.orDie)

      yield* events.remove(sessionID)
      yield* db.delete(SessionInputTable).where(eq(SessionInputTable.session_id, sessionID)).run().pipe(Effect.orDie)
      yield* db
        .delete(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, sessionID))
        .run()
        .pipe(Effect.orDie)
      yield* events.replayAll(
        recorded.map((event) => ({
          id: event.id,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })),
      )

      expect(yield* admitted(messageID)).toMatchObject({
        id: messageID,
        prompt: {
          text: "Replay pending",
          system: "Replay policy",
          tools: { echo: true },
          format: {
            type: "json_schema",
            schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
          },
        },
      })
      expect(yield* session.messages({ sessionID })).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  it.effect("returns an exact retry of a legacy projected prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = Prompt.make({ text: "Historical prompt" })
      yield* events.publish(SessionEvent.Prompted, {
        sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        prompt,
        delivery: "steer",
      })

      const retried = yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })

      expect(retried).toMatchObject({ id: messageID, prompt: { text: "Historical prompt" } })
      expect(yield* admitted(messageID)).toHaveProperty("promotedSeq")
    }),
  )

  it.effect("returns an exact retry of a legacy projected queued prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const prompt = Prompt.make({ text: "Historical queued prompt" })
      yield* events.publish(SessionEvent.Prompted, {
        sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        prompt,
        delivery: "queue",
      })

      const retried = yield* session.prompt({ id: messageID, sessionID, prompt, delivery: "queue", resume: false })

      expect(retried).toMatchObject({ id: messageID, prompt: { text: "Historical queued prompt" } })
      expect(yield* admitted(messageID)).toMatchObject({ delivery: "queue" })
    }),
  )

  it.effect("rejects reuse of one globally unique message ID across sessions", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const other = SessionV2.ID.make("ses_prompt_other")
      yield* db
        .insert(SessionTable)
        .values({
          id: other,
          project_id: Project.ID.global,
          slug: "other",
          directory: "/project",
          title: "other",
          version: "test",
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      const prompt = Prompt.make({ text: "Fix the failing tests" })

      yield* session.prompt({ id: messageID, sessionID, prompt, resume: false })
      const failure = yield* session
        .prompt({ id: messageID, sessionID: other, prompt, resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID: other, messageID })
    }),
  )

  it.effect("rejects a prompt ID already used by visible Session history", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        text: "Existing history",
      })

      const failure = yield* session
        .prompt({ id: messageID, sessionID, prompt: Prompt.make({ text: "Conflicting prompt" }), resume: false })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "Session.PromptConflictError", sessionID, messageID })
      expect(yield* admitted(messageID)).toBeUndefined()
    }),
  )

  it.effect("starts execution by default after recording the prompt", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Run by default" }) })

      expect(executionCalls).toEqual([])
      yield* waitFor("wake call", () => wakeCalls.length >= 1)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("starts execution when resume is explicitly true", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Run explicitly" }),
        resume: true,
      })

      expect(executionCalls).toEqual([])
      yield* waitFor("wake call", () => wakeCalls.length >= 1)
      expect(wakeCalls).toEqual([sessionID])
    }),
  )

  it.effect("commits a prompt without starting execution", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      const input = yield* session.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Record without reply" }),
        commit: true,
      })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
      expect(yield* admitted(input.id)).toHaveProperty("promotedSeq")
      expect(yield* session.context(sessionID)).toMatchObject([
        { id: input.id, type: "user", text: "Record without reply" },
      ])
    }),
  )

  it.effect("only records the prompt when resume is false", () =>
    Effect.gen(function* () {
      yield* setup
      const session = yield* SessionV2.Service
      executionCalls.length = 0
      wakeCalls.length = 0

      yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Do not run" }), resume: false })

      expect(executionCalls).toEqual([])
      expect(wakeCalls).toEqual([])
    }),
  )

  itWithBlockingWake.effect("returns the durable admission before an advisory wake completes or fails", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const session = yield* SessionV2.Service
      const returned = yield* Deferred.make<SessionInput.Admitted>()
      blockingWakeObservations.length = 0
      blockingWakeStarted = yield* Deferred.make<void>()
      releaseBlockingWake = yield* Deferred.make<void>()

      const run = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Recover queued wake later" }),
          delivery: "queue",
        })
        .pipe(
          Effect.tap((input) => Deferred.succeed(returned, input)),
          Effect.forkChild,
        )
      yield* Effect.addFinalizer(() => Fiber.interrupt(run).pipe(Effect.asVoid))
      yield* Effect.addFinalizer(() =>
        releaseBlockingWake ? Deferred.succeed(releaseBlockingWake, undefined).pipe(Effect.asVoid) : Effect.void,
      )
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          blockingWakeStarted = undefined
          releaseBlockingWake = undefined
        }),
      )

      yield* awaitDeferred("blocking wake start", blockingWakeStarted)
      expect(blockingWakeObservations).toEqual(["committed"])
      const admitted = yield* awaitDeferred("returned durable admission", returned)
      expect(yield* SessionInput.find(db, admitted.id)).toEqual(admitted)

      yield* Deferred.succeed(releaseBlockingWake, undefined)
      expect(yield* Fiber.join(run)).toEqual(admitted)
      expect(yield* SessionInput.pending(db, sessionID, "queue")).toEqual([admitted])
    }),
  )

  itWithInterruptingWake.effect("registers advisory wake before caller cancellation can interrupt after admission commit", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const events = yield* EventV2.Service
      const session = yield* SessionV2.Service
      const scope = yield* Scope.Scope
      interruptingWakeCalls.length = 0
      interruptingWakeStarted = yield* Deferred.make<void>()
      const interruptingWakeScheduled = yield* Deferred.make<void>()
      const runningReady = yield* Deferred.make<Fiber.Fiber<SessionInput.Admitted, unknown>>()

      const unsubscribe = yield* events.listen((event) =>
        event.type === SessionEvent.PromptAdmitted.type
          ? awaitDeferred("running prompt fiber", runningReady).pipe(
              Effect.andThen((running) => Fiber.interrupt(running)),
              Effect.ensuring(Deferred.succeed(interruptingWakeScheduled, undefined)),
              Effect.forkIn(scope),
              Effect.asVoid,
            )
          : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          interruptingWakeStarted = undefined
        }),
      )

      const running = yield* session
        .prompt({
          sessionID,
          prompt: Prompt.make({ text: "Interrupt after commit" }),
          delivery: "queue",
        })
        .pipe(Effect.forkChild)
      yield* Effect.addFinalizer(() => Fiber.interrupt(running).pipe(Effect.asVoid))
      yield* Deferred.succeed(runningReady, running)

      yield* awaitDeferred("advisory wake registration", interruptingWakeStarted)
      yield* awaitDeferred("caller interruption", interruptingWakeScheduled)

      expect(interruptingWakeCalls).toEqual([sessionID])
      expect(yield* SessionInput.pending(db, sessionID, "queue")).toHaveLength(1)
    }),
  )
})
