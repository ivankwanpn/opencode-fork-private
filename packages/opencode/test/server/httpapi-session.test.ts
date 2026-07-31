import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { afterEach, describe, expect } from "bun:test"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Cause, Config, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"
import { layerWebSocketConstructorGlobal } from "effect/unstable/socket/Socket"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { registerAdapter } from "../../src/control-plane/adapters"
import type { WorkspaceAdapter } from "../../src/control-plane/types"
import { Workspace } from "../../src/control-plane/workspace"

import { InstanceBootstrap as InstanceBootstrapService } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import * as HttpSessionError from "../../src/server/routes/instance/httpapi/handlers/session-errors"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID, type SessionID as SessionIDType } from "../../src/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { MessageTable, SessionInputTable, SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as DateTime from "effect/DateTime"
import { eq } from "drizzle-orm"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, provideInstanceEffect, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"
import { pollWithTimeout, testEffect } from "../lib/effect"

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const noopBootstrapLayer = Layer.succeed(
  InstanceBootstrapService.Service,
  InstanceBootstrapService.Service.of({ run: Effect.void }),
)
const appLayer = AppNodeBuilder.build(
  LayerNode.group([InstanceStore.node, Project.node, Session.node, Workspace.node, Database.node, Ripgrep.node]),
  [
    [InstanceStore.bootstrapNode, noopBootstrapLayer],
    [LocationServiceMap.node, locationServiceMapLayer],
  ],
)
const wakeAfterCommitLayer = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return SessionExecution.Service.of({
      active: Effect.succeed(new Set()),
      resume: () => Effect.void,
      exclusive: (_sessionID, work) => work,
      wake: (sessionID) =>
        db
          .select({ promoted: SessionInputTable.promoted_seq, terminal: SessionInputTable.terminal_outcome })
          .from(SessionInputTable)
          .where(eq(SessionInputTable.session_id, sessionID))
          .all()
          .pipe(
            Effect.orDie,
            Effect.flatMap((rows) =>
              rows.some((row) => row.promoted !== null || row.terminal !== null)
                ? Effect.void
                : Effect.die(`Session input was not durable before wake: ${sessionID}`),
            ),
          ),
      wait: () => Effect.void,
      interrupt: () => Effect.void,
    })
  }),
).pipe(Layer.provide(appLayer))
const servedRoutes: Layer.Layer<never, Config.ConfigError, HttpServer.HttpServer> = HttpRouter.serve(
  HttpApiApp.routes,
  {
    disableListenLog: true,
    disableLogger: true,
  },
)
const httpApiLayer = servedRoutes.pipe(
  Layer.provide(wakeAfterCommitLayer),
  Layer.provide(layerWebSocketConstructorGlobal),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
)
const it = testEffect(Layer.mergeAll(appLayer, httpApiLayer))

function pathFor(path: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), path)
}

function createSession(input?: Session.CreateInput) {
  return Session.use.create(input)
}

function createTextMessage(sessionID: SessionIDType, text: string) {
  return Effect.gen(function* () {
    const svc = yield* Session.Service
    const info = yield* svc.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      time: { created: Date.now() },
    })
    const part = yield* svc.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: info.id,
      type: "text",
      text,
    })
    return { info, part }
  })
}

const localAdapter = (directory: string): WorkspaceAdapter => ({
  name: "Local Test",
  description: "Create a local test workspace",
  configure: (info) => ({ ...info, name: "local-test", directory }),
  create: async () => {
    await mkdir(directory, { recursive: true })
  },
  async remove() {},
  target: () => ({ type: "local" as const, directory }),
})

const createLocalWorkspace = (input: { projectID: Project.Info["id"]; type: string; directory: string }) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      registerAdapter(input.projectID, input.type, localAdapter(input.directory))
      return yield* Workspace.Service.use((svc) =>
        svc.create({
          type: input.type,
          branch: null,
          extra: null,
          projectID: input.projectID,
        }),
      )
    }),
    (info) => Workspace.use.remove(info.id).pipe(Effect.ignore),
  )

const insertLegacyAssistantMessage = (sessionID: SessionIDType, seq = 1, time = seq) =>
  Effect.gen(function* () {
    const message = SessionMessage.Assistant.make({
      id: SessionMessage.ID.create(),
      type: "assistant",
      agent: "build",
      model: {
        id: ModelV2.ID.make("model"),
        providerID: ProviderV2.ID.make("provider"),
        variant: ModelV2.VariantID.make("default"),
      },
      time: { created: DateTime.makeUnsafe(time) },
      content: [],
    })
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values([
        {
          id: message.id,
          session_id: sessionID,
          type: message.type,
          seq,
          time_created: time,
          data: {
            time: { created: time },
            agent: message.agent,
            model: message.model,
            content: message.content,
          } as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
        },
      ])
      .run()
      .pipe(Effect.orDie)
    return message
  })

const insertCorruptV2Message = (sessionID: SessionIDType, time = 1) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(SessionMessageTable)
      .values([
        {
          id: SessionMessage.ID.create(),
          session_id: sessionID,
          type: "assistant",
          seq: time,
          time_created: time,
          data: {} as NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>,
        },
      ])
      .run()
      .pipe(Effect.orDie)
  })

const setLegacySummaryDiff = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({
        summary_additions: 1,
        summary_deletions: 0,
        summary_files: 1,
        summary_diffs: [{ additions: 1, deletions: 0 }],
      })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
  })

const getWorkspaceID = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db
      .select({ workspaceID: SessionTable.workspace_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get()
      .pipe(Effect.orDie)
  })

const clearSessionPath = (sessionID: SessionIDType) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ path: null }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
  })

function request(path: string, init?: RequestInit) {
  const url = new URL(path, "http://localhost")
  return HttpClientRequest.fromWeb(new Request(url, init)).pipe(
    HttpClientRequest.setUrl(url.pathname),
    HttpClient.execute,
  )
}

function json<T>(response: HttpClientResponse.HttpClientResponse) {
  if (response.status !== 200) return response.text.pipe(Effect.flatMap((text) => Effect.die(new Error(text))))
  return response.json.pipe(Effect.map((value) => value as T))
}

function responseJson(response: HttpClientResponse.HttpClientResponse) {
  return response.json
}

function requestJson<T>(path: string, init?: RequestInit) {
  return request(path, init).pipe(Effect.flatMap(json<T>))
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("session HttpApi", () => {
  it.effect("maps busy sessions to public session busy errors", () =>
    Effect.gen(function* () {
      const sessionID = SessionID.descending()
      const exit = yield* HttpSessionError.mapBusy(Effect.fail(new Session.BusyError({ sessionID }))).pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "SessionBusyError",
          sessionID,
          message: `Session is busy: ${sessionID}`,
        })
      }
    }),
  )

  it.instance(
    "returns declared not found errors for read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const missingSession = SessionID.descending()
        const missingSessionBody = {
          name: "NotFoundError",
          data: { message: `Session not found: ${missingSession}` },
        }

        const get = yield* request(pathFor(SessionPaths.get, { sessionID: missingSession }), { headers })
        expect(get.status).toBe(404)
        expect(yield* responseJson(get)).toEqual(missingSessionBody)

        const children = yield* request(pathFor(SessionPaths.children, { sessionID: missingSession }), { headers })
        expect(children.status).toBe(404)
        expect(yield* responseJson(children)).toEqual(missingSessionBody)

        const todo = yield* request(pathFor(SessionPaths.todo, { sessionID: missingSession }), { headers })
        expect(todo.status).toBe(404)
        expect(yield* responseJson(todo)).toEqual(missingSessionBody)

        const messages = yield* request(pathFor(SessionPaths.messages, { sessionID: missingSession }), { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(missingSessionBody)

        const remove = yield* request(pathFor(SessionPaths.remove, { sessionID: missingSession }), {
          headers,
          method: "DELETE",
        })
        expect(remove.status).toBe(404)
        expect(yield* responseJson(remove)).toEqual(missingSessionBody)

        const prompt = yield* request(pathFor(SessionPaths.prompt, { sessionID: missingSession }), {
          headers: { ...headers, "content-type": "application/json" },
          method: "POST",
          body: JSON.stringify({ agent: "build", noReply: true, parts: [{ type: "text", text: "hello" }] }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(missingSessionBody)

        const abort = yield* request(pathFor(SessionPaths.abort, { sessionID: missingSession }), {
          headers,
          method: "POST",
        })
        expect(abort.status).toBe(200)
        expect(yield* responseJson(abort)).toBe(true)

        const session = yield* createSession({ title: "missing message" })
        const missingMessage = MessageID.ascending()
        const message = yield* request(
          pathFor(SessionPaths.message, { sessionID: session.id, messageID: missingMessage }),
          { headers },
        )
        expect(message.status).toBe(404)
        expect(yield* responseJson(message)).toEqual({
          name: "NotFoundError",
          data: { message: `Message not found: ${missingMessage}` },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves read routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const parent = yield* createSession({ title: "parent" })
        const child = yield* createSession({ title: "child", parentID: parent.id })
        const message = yield* createTextMessage(parent.id, "hello")
        yield* createTextMessage(parent.id, "world")

        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?roots=true`, { headers })
        expect(listed.map((item) => item.id)).toContain(parent.id)
        expect(Object.hasOwn(listed[0]!, "parentID")).toBe(false)

        expect(yield* requestJson<Record<string, unknown>>(SessionPaths.status, { headers })).toEqual({})

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.get, { sessionID: parent.id }), { headers }),
        ).toMatchObject({ id: parent.id, title: "parent" })

        expect(
          (yield* requestJson<Session.Info[]>(pathFor(SessionPaths.children, { sessionID: parent.id }), {
            headers,
          })).map((item) => item.id),
        ).toEqual([child.id])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.todo, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        expect(
          yield* requestJson<unknown[]>(pathFor(SessionPaths.diff, { sessionID: parent.id }), { headers }),
        ).toEqual([])

        const messages = yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1`, {
          headers,
        })
        const messagePage = yield* json<SessionV1.WithParts[]>(messages)
        const nextCursor = messages.headers["x-next-cursor"]
        expect(nextCursor).toBeTruthy()
        expect(messagePage[0]?.parts[0]).toMatchObject({ type: "text" })

        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?before=${nextCursor}`, {
            headers,
          })).status,
        ).toBe(400)
        expect(
          (yield* request(`${pathFor(SessionPaths.messages, { sessionID: parent.id })}?limit=1&before=invalid`, {
            headers,
          })).status,
        ).toBe(400)

        expect(
          yield* requestJson<SessionV1.WithParts>(
            pathFor(SessionPaths.message, { sessionID: parent.id, messageID: message.info.id }),
            { headers },
          ),
        ).toMatchObject({ info: { id: message.info.id } })

        yield* insertLegacyAssistantMessage(parent.id)

        expect(
          (yield* requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${parent.id}/message`, {
            headers,
          })).data.some((item) => item.type === "assistant"),
        ).toBeTrue()
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.live(
    "uses the persisted session directory for prompt requests",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("ok", { usage: { input: 1, output: 1 } })

        const config = testProviderConfig(llm.url)
        const sessionDirectory = yield* tmpdirScoped({ git: true, config })
        const requestDirectory = yield* tmpdirScoped({ git: true, config })
        const session = yield* createSession({ title: "directory regression" }).pipe(
          provideInstanceEffect(sessionDirectory),
        )

        const response = yield* request(
          `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(requestDirectory)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              parts: [{ type: "text", text: "which directory?" }],
            }),
          },
        )

        expect(response.status).toBe(200)
        const assistant = yield* json<SessionV1.WithParts>(response)
        expect(assistant.info.role === "assistant" ? assistant.info.path : undefined).toEqual({
          cwd: sessionDirectory,
          root: sessionDirectory,
        })
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live("projects canonical no-reply prompts through the legacy response", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig("http://127.0.0.1:1/v1") })
      const session = yield* createSession({ title: "no-reply compatibility" }).pipe(provideInstanceEffect(directory))
      const messageID = MessageID.ascending()
      const route = `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`
      const response = yield* request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageID,
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          noReply: true,
          system: "Prompt-only policy",
          tools: { read: false },
          format: {
            type: "json_schema",
            schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
          },
          parts: [{ type: "text", text: "record only" }],
        }),
      })

      expect(response.status).toBe(200)
      expect(yield* json<SessionV1.WithParts>(response)).toMatchObject({
        info: {
          id: messageID,
          role: "user",
          system: "Prompt-only policy",
          tools: { read: false },
          format: { type: "json_schema", schema: { type: "object" } },
        },
        parts: [{ type: "text", text: "record only" }],
      })
      const history = yield* requestJson<SessionV1.WithParts[]>(
        `${pathFor(SessionPaths.messages, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
      )
      expect(history.map((message) => message.info.id)).toContain(messageID)
      const canonical = yield* Database.Service.use(({ db }) =>
        db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
          .get()
          .pipe(Effect.orDie),
      )
      expect(canonical?.data).toMatchObject({
        system: "Prompt-only policy",
        tools: { read: false },
        format: { type: "json_schema", schema: { type: "object" } },
      })
    }),
  )

  it.live(
    "runs legacy structured-output prompts through canonical V2 execution",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.tool("StructuredOutput", { answer: "canonical" })
        const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig(llm.url) })
        const session = yield* createSession({ title: "structured compatibility" }).pipe(
          provideInstanceEffect(directory),
        )
        const messageID = MessageID.ascending()
        const route = `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`
        const response = yield* request(route, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messageID,
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            format: {
              type: "json_schema",
              schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
            },
            parts: [{ type: "text", text: "return one answer" }],
          }),
        })

        expect(response.status).toBe(200)
        expect(yield* json<SessionV1.WithParts>(response)).toMatchObject({
          info: {
            role: "assistant",
            structured: { answer: "canonical" },
          },
        })
        const history = yield* requestJson<SessionV1.WithParts[]>(
          `${pathFor(SessionPaths.messages, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
        )
        expect(history).toContainEqual(
          expect.objectContaining({
            info: expect.objectContaining({
              id: messageID,
              role: "user",
              format: expect.objectContaining({ type: "json_schema" }),
            }),
          }),
        )
        const rows = yield* Database.Service.use(({ db }) =>
          Effect.all({
            legacy: db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie),
            canonical: db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
              .get()
              .pipe(Effect.orDie),
          }),
        )
        expect(rows.legacy).toBeUndefined()
        expect(rows.canonical?.data).toMatchObject({ format: { type: "json_schema" } })
        expect(yield* llm.calls).toBe(1)
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live(
    "runs the legacy init wrapper through the canonical command path",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("init done", { usage: { input: 1, output: 1 } })
        const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig(llm.url) })
        const session = yield* createSession({ title: "init compatibility" }).pipe(provideInstanceEffect(directory))
        const messageID = MessageID.ascending()
        const response = yield* request(
          `${pathFor(SessionPaths.init, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID,
              providerID: "test",
              modelID: "test-model",
            }),
          },
        )

        expect(response.status).toBe(200)
        expect(yield* json<boolean>(response)).toBeTrue()
        const rows = yield* Database.Service.use(({ db }) =>
          Effect.all({
            legacy: db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie),
            canonical: db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
              .get()
              .pipe(Effect.orDie),
          }),
        )
        expect(rows.legacy).toBeUndefined()
        expect(rows.canonical?.data).toMatchObject({ text: expect.stringContaining("AGENTS.md") })
        expect(yield* llm.calls).toBe(1)
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live(
    "runs legacy commands through canonical V2 expansion and execution",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("command done", { usage: { input: 1, output: 1 } })
        const base = testProviderConfig(llm.url)
        const directory = yield* tmpdirScoped({
          git: true,
          config: {
            ...base,
            provider: {
              test: {
                ...base.provider.test,
                models: {
                  "test-model": {
                    ...base.provider.test.models["test-model"],
                    variants: { high: { reasoningEffort: "high" } },
                  },
                },
              },
            },
            command: {
              review: {
                template: "Review $ARGUMENTS",
              },
            },
          },
        })
        const session = yield* createSession({ title: "command compatibility" }).pipe(provideInstanceEffect(directory))
        const messageID = MessageID.ascending()
        const route = `${pathFor(SessionPaths.command, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`
        const response = yield* request(route, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messageID,
            command: "review",
            arguments: "src tests",
            agent: "build",
            model: "test/test-model",
            variant: "high",
          }),
        })

        expect(response.status).toBe(200)
        expect(yield* json<SessionV1.WithParts>(response)).toMatchObject({
          info: { role: "assistant", parentID: messageID },
          parts: expect.arrayContaining([expect.objectContaining({ type: "text", text: "command done" })]),
        })
        const history = yield* requestJson<SessionV1.WithParts[]>(
          `${pathFor(SessionPaths.messages, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
        )
        expect(history).toContainEqual(
          expect.objectContaining({
            info: expect.objectContaining({ id: messageID, role: "user" }),
            parts: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Review src tests" })]),
          }),
        )
        const rows = yield* Database.Service.use(({ db }) =>
          Effect.all({
            legacy: db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie),
            canonical: db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
              .get()
              .pipe(Effect.orDie),
            messages: db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.session_id, session.id))
              .all()
              .pipe(Effect.orDie),
          }),
        )
        expect(rows.legacy).toBeUndefined()
        expect(rows.canonical?.data).toMatchObject({ text: "Review src tests" })
        expect(rows.messages.find((row) => row.type === "assistant")?.data).toMatchObject({
          model: { providerID: "test", id: "test-model", variant: "high" },
        })
        expect(yield* llm.calls).toBe(1)
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live(
    "keeps loss-sensitive command attachments on the legacy path",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("legacy command done", { usage: { input: 1, output: 1 } })
        const base = testProviderConfig(llm.url)
        const directory = yield* tmpdirScoped({
          git: true,
          config: {
            ...base,
            command: {
              inspect: {
                template: "Inspect attachment",
              },
            },
          },
        })
        const session = yield* createSession({ title: "legacy command attachment" }).pipe(
          provideInstanceEffect(directory),
        )
        const messageID = MessageID.ascending()
        const partID = PartID.ascending()
        const response = yield* request(
          `${pathFor(SessionPaths.command, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID,
              command: "inspect",
              arguments: "",
              agent: "build",
              model: "test/test-model",
              parts: [
                {
                  id: partID,
                  type: "file",
                  mime: "text/plain",
                  filename: "note.txt",
                  url: "data:text/plain;base64,bm90ZQ==",
                },
              ],
            }),
          },
        )

        expect(response.status).toBe(200)
        const rows = yield* Database.Service.use(({ db }) =>
          Effect.all({
            legacy: db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie),
            canonical: db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
              .get()
              .pipe(Effect.orDie),
          }),
        )
        expect(rows.legacy).toBeDefined()
        expect(rows.canonical).toBeUndefined()
        expect(yield* llm.calls).toBe(1)
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live("materializes MCP resource prompt parts canonically while retaining other sourced-file fallbacks", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({
        git: true,
        config: testProviderConfig("http://127.0.0.1:1/v1"),
      })
      const session = yield* createSession({
        title: "canonical MCP resource",
      }).pipe(provideInstanceEffect(directory))
      const messageID = MessageID.ascending()
      const response = yield* request(
        `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messageID,
            agent: "build",
            model: {
              providerID: "test",
              modelID: "test-model",
            },
            noReply: true,
            parts: [
              { type: "text", text: "Read the guide" },
              {
                type: "file",
                mime: "text/plain",
                filename: "guide",
                url: "mcp://guide",
                source: {
                  type: "resource",
                  clientName: "docs",
                  uri: "mcp://guide",
                  text: {
                    value: "@guide",
                    start: 9,
                    end: 15,
                  },
                },
              },
            ],
          }),
        },
      )

      expect(response.status).toBe(200)
      const rows = yield* Database.Service.use(({ db }) =>
        Effect.all({
          legacy: db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie),
          admitted: db
            .select()
            .from(SessionInputTable)
            .where(eq(SessionInputTable.id, SessionMessage.ID.make(messageID)))
            .get()
            .pipe(Effect.orDie),
        }),
      )
      expect(rows.legacy).toBeUndefined()
      expect(rows.admitted?.prompt).toMatchObject({
        text: "Read the guide",
        files: [
          {
            uri: "mcp://guide",
            mime: "text/plain",
            name: "guide",
            source: {
              text: "@guide",
              start: 9,
              end: 15,
            },
            resource: {
              clientName: "docs",
              uri: "mcp://guide",
            },
            materialized: [
              {
                type: "error",
                message: "MCP resource guide was not found",
              },
            ],
          },
        ],
      })
    }),
  )

  it.live("keeps loss-sensitive prompt payloads on the legacy path", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig("http://127.0.0.1:1/v1") })
      const cases = [
        {
          name: "text metadata",
          parts: [{ type: "text", text: "metadata", metadata: { source: "legacy" } }],
        },
        {
          name: "ignored text",
          parts: [{ type: "text", text: "ignored", ignored: true }],
        },
        {
          name: "synthetic text",
          parts: [{ type: "text", text: "synthetic", synthetic: true }],
        },
        {
          name: "custom part ID",
          parts: [{ id: PartID.ascending(), type: "text", text: "custom ID" }],
        },
        {
          name: "file source",
          parts: [
            { type: "text", text: "sourced file" },
            {
              type: "file",
              mime: "text/plain",
              filename: "note.txt",
              url: "data:text/plain;base64,bm90ZQ==",
              source: {
                type: "file",
                path: "note.txt",
                text: { value: "note", start: 0, end: 4 },
              },
            },
          ],
        },
        {
          name: "noncanonical ordering",
          parts: [
            { type: "text", text: "ordered" },
            { type: "agent", name: "build" },
            {
              type: "file",
              mime: "text/plain",
              filename: "late.txt",
              url: "data:text/plain;base64,bGF0ZQ==",
            },
          ],
        },
      ] as const

      for (const item of cases) {
        const session = yield* createSession({ title: item.name }).pipe(provideInstanceEffect(directory))
        const messageID = MessageID.ascending()
        const response = yield* request(
          `${pathFor(SessionPaths.prompt, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messageID,
              agent: "build",
              model: { providerID: "test", modelID: "test-model" },
              noReply: true,
              parts: item.parts,
            }),
          },
        )
        expect(response.status).toBe(200)

        const rows = yield* Database.Service.use(({ db }) =>
          Effect.all({
            legacy: db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).get().pipe(Effect.orDie),
            canonical: db
              .select()
              .from(SessionMessageTable)
              .where(eq(SessionMessageTable.id, SessionMessage.ID.make(messageID)))
              .get()
              .pipe(Effect.orDie),
          }),
        )
        expect(rows.legacy, item.name).toBeDefined()
        expect(rows.canonical, item.name).toBeUndefined()
      }
    }),
  )

  it.live(
    "wakes canonical execution for legacy async prompts",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("async reply", { usage: { input: 1, output: 1 } })
        const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig(llm.url) })
        const session = yield* createSession({ title: "async compatibility" }).pipe(provideInstanceEffect(directory))
        const route = `${pathFor(SessionPaths.promptAsync, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`
        const response = yield* request(route, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "reply asynchronously" }],
          }),
        })

        expect(response.status).toBe(204)
        const assistant = yield* pollWithTimeout(
          request(
            `${pathFor(SessionPaths.messages, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
          ).pipe(
            Effect.flatMap(json<SessionV1.WithParts[]>),
            Effect.map((messages) =>
              messages.find(
                (message) =>
                  message.info.role === "assistant" &&
                  message.parts.some((part) => part.type === "text" && part.text === "async reply"),
              ),
            ),
          ),
          "Legacy prompt_async did not produce a projected canonical assistant",
          "10 seconds",
        )
        expect(assistant.info.role).toBe("assistant")
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live("commits canonical no-reply async prompts without waking execution", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig(llm.url) })
      const session = yield* createSession({ title: "async no-reply compatibility" }).pipe(
        provideInstanceEffect(directory),
      )
      const messageID = MessageID.ascending()
      const route = (path: string) => `${path}?directory=${encodeURIComponent(directory)}`
      const response = yield* request(route(pathFor(SessionPaths.promptAsync, { sessionID: session.id })), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageID,
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          noReply: true,
          parts: [{ type: "text", text: "record asynchronously" }],
        }),
      })

      expect(response.status).toBe(204)
      const history = yield* requestJson<SessionV1.WithParts[]>(
        route(pathFor(SessionPaths.messages, { sessionID: session.id })),
      )
      expect(history).toContainEqual(
        expect.objectContaining({
          info: expect.objectContaining({ id: messageID, role: "user" }),
          parts: expect.arrayContaining([expect.objectContaining({ type: "text", text: "record asynchronously" })]),
        }),
      )
      expect(yield* llm.calls).toBe(0)
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )

  it.live("projects manual canonical summaries through legacy history", () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      yield* llm.text("manual summary", { usage: { input: 1, output: 1 } })
      const base = testProviderConfig(llm.url)
      const config = {
        ...base,
        provider: {
          test: {
            ...base.provider.test,
            models: {
              ...base.provider.test.models,
              "summary-model": {
                ...base.provider.test.models["test-model"],
                id: "summary-model",
                name: "Summary Model",
              },
            },
          },
        },
      }
      const directory = yield* tmpdirScoped({ git: true, config })
      const session = yield* createSession({ title: "manual summarize compatibility" }).pipe(
        provideInstanceEffect(directory),
      )
      const route = (path: string) => `${path}?directory=${encodeURIComponent(directory)}`
      const prompt = yield* request(route(pathFor(SessionPaths.prompt, { sessionID: session.id })), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          noReply: true,
          parts: [{ type: "text", text: "preserve this manual context" }],
        }),
      })
      expect(prompt.status).toBe(200)

      const summarize = yield* request(route(pathFor(SessionPaths.summarize, { sessionID: session.id })), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerID: "test", modelID: "summary-model" }),
      })
      expect(summarize.status).toBe(200)
      expect(yield* json<boolean>(summarize)).toBeTrue()

      const history = yield* requestJson<SessionV1.WithParts[]>(
        route(pathFor(SessionPaths.messages, { sessionID: session.id })),
      )
      expect(
        history.some(
          (message) =>
            message.info.role === "user" &&
            message.parts.some((part) => part.type === "compaction" && part.auto === false),
        ),
      ).toBeTrue()
      expect(
        history.some(
          (message) =>
            message.info.role === "assistant" &&
            message.info.summary === true &&
            message.parts.some((part) => part.type === "text" && part.text === "manual summary"),
        ),
      ).toBeTrue()
      const selected = yield* Database.Service.use(({ db }) =>
        db
          .select({ model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, session.id))
          .get()
          .pipe(Effect.orDie),
      )
      expect(selected?.model).toMatchObject({ providerID: "test", id: "summary-model" })
      expect(yield* llm.calls).toBe(1)
    }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )

  it.live(
    "continues after automatic canonical summaries",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.text("auto summary", { usage: { input: 1, output: 1 } })
        yield* llm.text("continued after summary", { usage: { input: 1, output: 1 } })
        const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig(llm.url) })
        const session = yield* createSession({ title: "automatic summarize compatibility" }).pipe(
          provideInstanceEffect(directory),
        )
        const route = (path: string) => `${path}?directory=${encodeURIComponent(directory)}`
        const prompt = yield* request(route(pathFor(SessionPaths.prompt, { sessionID: session.id })), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            noReply: true,
            parts: [{ type: "text", text: "short auto history" }],
          }),
        })
        expect(prompt.status).toBe(200)

        const summarize = yield* request(route(pathFor(SessionPaths.summarize, { sessionID: session.id })), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providerID: "test", modelID: "test-model", auto: true }),
        })
        expect(summarize.status).toBe(200)
        expect(yield* json<boolean>(summarize)).toBeTrue()

        const history = yield* requestJson<SessionV1.WithParts[]>(
          route(pathFor(SessionPaths.messages, { sessionID: session.id })),
        )
        expect(
          history.some(
            (message) =>
              message.info.role === "user" &&
              message.parts.some((part) => part.type === "compaction" && part.auto === true),
          ),
        ).toBeTrue()
        expect(
          history.some(
            (message) =>
              message.info.role === "assistant" &&
              message.info.summary === true &&
              message.parts.some((part) => part.type === "text" && part.text === "auto summary"),
          ),
        ).toBeTrue()
        expect(
          history.some(
            (message) =>
              message.info.role === "assistant" &&
              message.info.summary !== true &&
              message.parts.some((part) => part.type === "text" && part.text === "continued after summary"),
          ),
        ).toBeTrue()
        expect(yield* llm.calls).toBe(2)
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live(
    "rejects legacy summarize while canonical execution is active",
    () =>
      Effect.gen(function* () {
        const llm = yield* TestLLMServer
        yield* llm.hang
        const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig(llm.url) })
        const session = yield* createSession({ title: "busy summarize compatibility" }).pipe(
          provideInstanceEffect(directory),
        )
        const route = (path: string) => `${path}?directory=${encodeURIComponent(directory)}`
        const prompt = yield* request(route(pathFor(SessionPaths.promptAsync, { sessionID: session.id })), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: "build",
            model: { providerID: "test", modelID: "test-model" },
            parts: [{ type: "text", text: "stay active" }],
          }),
        })
        expect(prompt.status).toBe(204)
        yield* llm.wait(1)

        const summarize = yield* request(route(pathFor(SessionPaths.summarize, { sessionID: session.id })), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ providerID: "test", modelID: "test-model" }),
        })
        const body = yield* responseJson(summarize)
        yield* request(route(pathFor(SessionPaths.abort, { sessionID: session.id })), { method: "POST" })

        expect(summarize.status).toBe(409)
        expect(body).toMatchObject({
          _tag: "SessionBusyError",
          sessionID: session.id,
          message: `Session is busy: ${session.id}`,
        })
      }).pipe(Effect.provide(TestLLMServer.layer), Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
    30_000,
  )

  it.live("preserves legacy shell message IDs in canonical history", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true, config: testProviderConfig("http://127.0.0.1:1/v1") })
      const session = yield* createSession({ title: "shell compatibility" }).pipe(provideInstanceEffect(directory))
      const messageID = MessageID.ascending()
      const route = `${pathFor(SessionPaths.shell, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`
      const response = yield* request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messageID,
          agent: "build",
          model: { providerID: "test", modelID: "test-model" },
          command: "node -e \"process.stdout.write('shell-ok')\"",
        }),
      })

      expect(response.status).toBe(200)
      const assistant = yield* json<SessionV1.WithParts>(response)
      expect(assistant).toMatchObject({
        info: { role: "assistant", parentID: messageID },
        parts: [{ type: "tool", state: { status: "completed", output: "shell-ok" } }],
      })
      const history = yield* requestJson<SessionV1.WithParts[]>(
        `${pathFor(SessionPaths.messages, { sessionID: session.id })}?directory=${encodeURIComponent(directory)}`,
      )
      expect(history.some((message) => message.info.id === messageID && message.info.role === "user")).toBeTrue()
      expect(
        history.some((message) => message.info.role === "assistant" && message.info.parentID === messageID),
      ).toBeTrue()
    }).pipe(Effect.provide(AppNodeBuilder.build(CrossSpawnSpawner.node))),
  )

  it.instance(
    "returns v2 public request errors for cursor and workspace query failures",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const session = yield* createSession({ title: "v2 cursor" })
        const firstMessage = yield* insertLegacyAssistantMessage(session.id, 1, 2)
        const secondMessage = yield* insertLegacyAssistantMessage(session.id, 2, 1)

        const sessionPage = yield* request(
          `/api/session?${new URLSearchParams({
            limit: "1",
            order: "asc",
            directory: test.directory,
            search: "v2",
          })}`,
          { headers },
        )
        const sessionCursor = (yield* json<{ data: Session.Info[]; cursor: { next?: string } }>(sessionPage)).cursor
          .next
        expect(sessionCursor).toBeTruthy()
        expect(JSON.parse(Buffer.from(sessionCursor!, "base64url").toString("utf8"))).toMatchObject({
          order: "asc",
          directory: test.directory,
          search: "v2",
          anchor: { id: session.id, direction: "next" },
        })

        const sessionNextPage = yield* request(`/api/session?cursor=${sessionCursor}`, { headers })
        expect(sessionNextPage.status).toBe(200)

        const invalidSessionCursor = yield* request(`/api/session?cursor=invalid`, { headers })
        expect(invalidSessionCursor.status).toBe(400)
        expect(yield* responseJson(invalidSessionCursor)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Invalid cursor",
        })

        const invalidWorkspace = yield* request(`/api/session?workspace=bad`, { headers })
        expect(invalidWorkspace.status).toBe(400)
        expect(yield* responseJson(invalidWorkspace)).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "Query",
        })

        const messagePage = yield* request(`/api/session/${session.id}/message?limit=1`, { headers })
        const messageBody = yield* json<{ data: SessionMessage.Message[]; cursor: { next?: string } }>(messagePage)
        const messageCursor = messageBody.cursor.next
        expect(messageCursor).toBeTruthy()
        expect(messageBody.data.map((message) => message.id)).toEqual([firstMessage.id])
        expect(JSON.parse(Buffer.from(messageCursor!, "base64url").toString("utf8"))).toEqual({
          id: firstMessage.id,
          order: "desc",
          direction: "next",
        })

        const nextMessagePage = yield* request(`/api/session/${session.id}/message?cursor=${messageCursor}`, {
          headers,
        })
        expect(
          (yield* json<{ data: SessionMessage.Message[] }>(nextMessagePage)).data.map((message) => message.id),
        ).toEqual([secondMessage.id])

        const legacyMessageCursor = Buffer.from(
          JSON.stringify({ id: firstMessage.id, time: 2, order: "desc", direction: "next" }),
        ).toString("base64url")
        const legacyMessagePage = yield* request(`/api/session/${session.id}/message?cursor=${legacyMessageCursor}`, {
          headers,
        })
        expect(
          (yield* json<{ data: SessionMessage.Message[] }>(legacyMessagePage)).data.map((message) => message.id),
        ).toEqual([secondMessage.id])

        const messageCursorWithOrder = yield* request(
          `/api/session/${session.id}/message?cursor=${messageCursor}&order=asc`,
          { headers },
        )
        expect(messageCursorWithOrder.status).toBe(400)
        expect(yield* responseJson(messageCursorWithOrder)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Cursor cannot be combined with order",
        })

        const invalidMessageCursor = yield* request(`/api/session/${session.id}/message?cursor=invalid`, { headers })
        expect(invalidMessageCursor.status).toBe(400)
        expect(yield* responseJson(invalidMessageCursor)).toMatchObject({
          _tag: "InvalidCursorError",
          message: "Invalid cursor",
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns v2 public not found errors for missing sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const missing = SessionID.descending()
        const expected = {
          _tag: "SessionNotFoundError",
          sessionID: missing,
          message: `Session not found: ${missing}`,
        }

        const messages = yield* request(`/api/session/${missing}/message`, { headers })
        expect(messages.status).toBe(404)
        expect(yield* responseJson(messages)).toEqual(expected)

        const context = yield* request(`/api/session/${missing}/context`, { headers })
        expect(context.status).toBe(404)
        expect(yield* responseJson(context)).toEqual(expected)

        const compact = yield* request(`/api/session/${missing}/compact`, { method: "POST", headers })
        expect(compact.status).toBe(404)
        expect(yield* responseJson(compact)).toEqual(expected)

        const wait = yield* request(`/api/session/${missing}/wait`, { method: "POST", headers })
        expect(wait.status).toBe(404)
        expect(yield* responseJson(wait)).toEqual(expected)

        const prompt = yield* request(`/api/session/${missing}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ prompt: { text: "hello" } }),
        })
        expect(prompt.status).toBe(404)
        expect(yield* responseJson(prompt)).toEqual(expected)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "durably records one v2 prompt for exact message-ID retries",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const session = yield* createSession({ title: "v2 prompt recording" })

        const recordPrompt = () =>
          request(`/api/session/${session.id}/prompt`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ id: "msg_http_prompt", prompt: { text: "hello" }, resume: false }),
          })
        const first = yield* recordPrompt()
        const retried = yield* recordPrompt()
        type PromptBody = { id: string; prompt: { text: string }; delivery: string; promotedSeq?: number }
        const firstBody = yield* json<{ data: PromptBody }>(first)
        const retriedBody = yield* json<{ data: PromptBody }>(retried)
        expect(first.status).toBe(200)
        expect(retried.status).toBe(200)
        expect(retriedBody).toEqual(firstBody)
        expect(firstBody).toMatchObject({
          data: { id: "msg_http_prompt", prompt: { text: "hello" }, delivery: "steer" },
        })

        const messages = yield* requestJson<{ data: PromptBody[] }>(`/api/session/${session.id}/message`, {
          headers,
        })
        expect(messages.data).toHaveLength(0)
        const admitted = yield* Database.Service.use(({ db }) =>
          db
            .select()
            .from(SessionInputTable)
            .where(eq(SessionInputTable.id, SessionMessage.ID.make("msg_http_prompt")))
            .get()
            .pipe(Effect.orDie),
        )
        expect(admitted).toMatchObject({
          id: "msg_http_prompt",
          session_id: session.id,
          delivery: "steer",
          promoted_seq: null,
        })
        const conflict = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: "msg_http_prompt", prompt: { text: "goodbye" } }),
        })
        expect(conflict.status).toBe(409)
        expect(yield* responseJson(conflict)).toEqual({
          _tag: "ConflictError",
          message: "Prompt message ID conflicts with an existing durable record: msg_http_prompt",
          resource: "msg_http_prompt",
        })

        const wakeID = SessionMessage.ID.make("msg_http_wake")
        const wake = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ id: wakeID, prompt: { text: "hello again" } }),
        })
        expect(wake.status).toBe(200)
        const message = yield* pollWithTimeout(
          requestJson<{ data: SessionMessage.Message[] }>(`/api/session/${session.id}/message`, { headers }).pipe(
            Effect.map(({ data }) => data.find((message) => message.id === wakeID)),
          ),
          "V2 prompt was not promoted after wake",
          "10 seconds",
        )
        expect(message).toMatchObject({ id: wakeID, type: "user" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "lists pending v2 inputs by delivery and admitted order",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "v2 input list" })
        const inputs = [
          { id: "msg_http_queue_first", delivery: "queue" },
          { id: "msg_http_steer", delivery: "steer" },
          { id: "msg_http_queue_second", delivery: "queue" },
        ]

        for (const input of inputs) {
          const response = yield* request(`/api/session/${session.id}/prompt`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              id: input.id,
              prompt: { text: input.id },
              delivery: input.delivery,
              resume: false,
            }),
          })
          expect(response.status).toBe(200)
        }

        const all = yield* requestJson<{ data: Array<{ id: string; admittedSeq: number; delivery: string }> }>(
          `/api/session/${session.id}/input`,
          { headers },
        )
        expect(all.data.map((input) => input.id)).toEqual(inputs.map((input) => input.id))
        expect(all.data.map((input) => input.admittedSeq)).toEqual([1, 2, 3])

        const queued = yield* requestJson<{ data: Array<{ id: string; delivery: string }> }>(
          `/api/session/${session.id}/input?delivery=queue`,
          { headers },
        )
        expect(queued.data.map((input) => input.id)).toEqual(["msg_http_queue_first", "msg_http_queue_second"])
        expect(queued.data.every((input) => input.delivery === "queue")).toBeTrue()

        const steered = yield* requestJson<{ data: Array<{ id: string; delivery: string }> }>(
          `/api/session/${session.id}/input?delivery=steer`,
          { headers },
        )
        expect(steered.data.map((input) => input.id)).toEqual(["msg_http_steer"])
      }),
    { git: true, config: { formatter: false, lsp: false } },
    30_000,
  )

  it.instance(
    "looks up v2 inputs by exact session identity",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "v2 input lookup" })
        const other = yield* createSession({ title: "v2 other input lookup" })
        const inputID = "msg_http_exact_input"
        const missingID = "msg_http_missing_input"

        const admitted = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers,
          body: JSON.stringify({ id: inputID, prompt: { text: "exact" }, resume: false }),
        })
        expect(admitted.status).toBe(200)

        const found = yield* request(`/api/session/${session.id}/input/${inputID}`, { headers })
        expect(found.status).toBe(200)
        expect(yield* responseJson(found)).toMatchObject({ data: { id: inputID, sessionID: session.id } })

        const missing = yield* request(`/api/session/${session.id}/input/${missingID}`, { headers })
        expect(missing.status).toBe(404)
        expect(yield* responseJson(missing)).toMatchObject({
          _tag: "SessionInputNotFoundError",
          sessionID: session.id,
          inputID: missingID,
        })

        const otherSession = yield* request(`/api/session/${other.id}/input/${inputID}`, { headers })
        expect(otherSession.status).toBe(404)
        expect(yield* responseJson(otherSession)).toMatchObject({
          _tag: "SessionInputNotFoundError",
          sessionID: other.id,
          inputID,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
    30_000,
  )

  it.instance(
    "promotes v2 inputs idempotently and maps input conflicts",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "v2 input promotion" })
        const promoteID = "msg_http_promote_input"
        const cancelID = "msg_http_cancel_input"

        for (const id of [promoteID, cancelID]) {
          const admitted = yield* request(`/api/session/${session.id}/prompt`, {
            method: "POST",
            headers,
            body: JSON.stringify({ id, prompt: { text: id }, resume: false }),
          })
          expect(admitted.status).toBe(200)
        }

        const first = yield* request(`/api/session/${session.id}/input/${promoteID}/promote`, {
          method: "POST",
          headers,
        })
        const replay = yield* request(`/api/session/${session.id}/input/${promoteID}/promote`, {
          method: "POST",
          headers,
        })
        expect(first.status).toBe(200)
        expect(replay.status).toBe(200)
        expect(yield* responseJson(replay)).toEqual(yield* responseJson(first))

        const pending = yield* requestJson<{ data: Array<{ id: string }> }>(`/api/session/${session.id}/input`, {
          headers,
        })
        expect(pending.data.map((input) => input.id)).toEqual([cancelID])

        const cancel = yield* request(`/api/session/${session.id}/input/${cancelID}`, {
          method: "DELETE",
          headers,
        })
        expect(cancel.status).toBe(204)

        const promoteCancelled = yield* request(`/api/session/${session.id}/input/${cancelID}/promote`, {
          method: "POST",
          headers,
        })
        expect(promoteCancelled.status).toBe(409)
        expect(yield* responseJson(promoteCancelled)).toMatchObject({
          _tag: "SessionInputConflictError",
          sessionID: session.id,
          inputID: cancelID,
        })

        const cancelPromoted = yield* request(`/api/session/${session.id}/input/${promoteID}`, {
          method: "DELETE",
          headers,
        })
        expect(cancelPromoted.status).toBe(409)
        expect(yield* responseJson(cancelPromoted)).toMatchObject({
          _tag: "SessionInputConflictError",
          sessionID: session.id,
          inputID: promoteID,
        })

        const missingPromote = yield* request(`/api/session/${session.id}/input/msg_http_unknown/promote`, {
          method: "POST",
          headers,
        })
        expect(missingPromote.status).toBe(409)
        const missingCancel = yield* request(`/api/session/${session.id}/input/msg_http_unknown`, {
          method: "DELETE",
          headers,
        })
        expect(missingCancel.status).toBe(409)
      }),
    { git: true, config: { formatter: false, lsp: false } },
    30_000,
  )

  it.instance(
    "wakes v2 input execution only after promotion is durable",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "v2 input wake ordering" })
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const inputID = "msg_http_wake_order"

        const admitted = yield* request(`/api/session/${session.id}/prompt`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: inputID,
            prompt: { text: "wake after commit" },
            delivery: "steer",
            resume: false,
          }),
        })
        expect(admitted.status).toBe(200)

        const promoted = yield* request(`/api/session/${session.id}/input/${inputID}/promote`, {
          method: "POST",
          headers,
        })
        expect(promoted.status).toBe(200)
        expect((yield* json<{ data: { id: string; promotedSeq: number } }>(promoted)).data).toMatchObject({
          id: inputID,
          promotedSeq: expect.any(Number),
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
    30_000,
  )

  it.instance(
    "compacts an idle v2 session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const session = yield* createSession({ title: "v2 compact" })

        const compact = yield* request(`/api/session/${session.id}/compact`, { method: "POST", headers })
        expect(compact.status).toBe(204)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "waits for an idle v2 session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const session = yield* createSession({ title: "v2 wait" })

        const wait = yield* request(`/api/session/${session.id}/wait`, { method: "POST", headers })
        expect(wait.status).toBe(204)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns safe v2 unknown errors for corrupt projected messages",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "v2 corrupt message" })
        yield* insertCorruptV2Message(session.id)

        const messages = yield* request(`/api/session/${session.id}/message`, {
          headers: { "x-opencode-directory": test.directory },
        })
        const messagesBody = yield* responseJson(messages)
        expect(messages.status).toBe(500)
        expect(messagesBody).toMatchObject({
          _tag: "UnknownError",
          message: "Unexpected server error. Check server logs for details.",
        })
        expect((messagesBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
        expect(JSON.stringify(messagesBody)).not.toContain("assistant")

        const context = yield* request(`/api/session/${session.id}/context`, {
          headers: { "x-opencode-directory": test.directory },
        })
        const contextBody = yield* responseJson(context)
        expect(context.status).toBe(500)
        expect(contextBody).toMatchObject({
          _tag: "UnknownError",
          message: "Unexpected server error. Check server logs for details.",
        })
        expect((contextBody as { ref?: unknown }).ref).toMatch(/^err_[0-9a-f-]{8}$/)
        expect(JSON.stringify(contextBody)).not.toContain("assistant")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves sessions with migrated summary diffs missing file details",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* createSession({ title: "legacy diff" })
        yield* setLegacySummaryDiff(session.id)

        const response = yield* request(pathFor(SessionPaths.get, { sessionID: session.id }), {
          headers: { "x-opencode-directory": test.directory },
        })

        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).summary?.diffs).toEqual([{ additions: 1, deletions: 0 }])
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves lifecycle mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }

        const createdEmpty = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
        })
        expect(createdEmpty.id).toBeTruthy()

        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created" }),
        })
        expect(created.title).toBe("created")

        const updated = yield* requestJson<Session.Info>(pathFor(SessionPaths.update, { sessionID: created.id }), {
          method: "PATCH",
          headers,
          body: JSON.stringify({ title: "updated", time: { archived: 1 } }),
        })
        expect(updated).toMatchObject({ id: created.id, title: "updated", time: { archived: 1 } })

        const forked = yield* requestJson<Session.Info>(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
        })
        expect(forked.id).not.toBe(created.id)

        const forkedWithoutContentType = yield* requestJson<Session.Info>(
          pathFor(SessionPaths.fork, { sessionID: created.id }),
          {
            method: "POST",
            headers: { "x-opencode-directory": test.directory },
          },
        )
        expect(forkedWithoutContentType.id).not.toBe(created.id)

        const invalidFork = yield* request(pathFor(SessionPaths.fork, { sessionID: created.id }), {
          method: "POST",
          headers,
          body: "{",
        })
        expect(invalidFork.status).toBe(400)

        const forkedWhitespace = yield* requestJson<Session.Info>(
          pathFor(SessionPaths.fork, { sessionID: created.id }),
          {
            method: "POST",
            headers,
            body: "  \n",
          },
        )
        expect(forkedWhitespace.id).not.toBe(created.id)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.abort, { sessionID: created.id }), {
            method: "POST",
            headers,
          }),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(pathFor(SessionPaths.remove, { sessionID: created.id }), {
            method: "DELETE",
            headers,
          }),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "persists selected workspace id when creating a session",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const project = yield* Project.use.fromDirectory(test.directory)
        const workspace = yield* createLocalWorkspace({
          projectID: project.project.id,
          type: "session-create-workspace",
          directory: path.join(test.directory, ".workspace-local"),
        })

        const created = yield* requestJson<Session.Info>(`${SessionPaths.create}?workspace=${workspace.id}`, {
          method: "POST",
          headers: { "x-opencode-directory": test.directory, "content-type": "application/json" },
          body: JSON.stringify({ title: "workspace session" }),
        })
        const messages = yield* request(
          `${pathFor(SessionPaths.messages, { sessionID: created.id })}?workspace=${workspace.id}`,
          {
            headers: { "x-opencode-directory": test.directory },
          },
        )

        expect(created).toMatchObject({ id: created.id, workspaceID: workspace.id })
        expect(messages.status).toBe(200)
        expect(yield* getWorkspaceID(created.id)).toEqual({ workspaceID: workspace.id })
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "validates archived timestamp values",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "archived" })
        const body = JSON.stringify({ time: { archived: -1 } })

        const response = yield* request(pathFor(SessionPaths.update, { sessionID: session.id }), {
          method: "PATCH",
          headers,
          body,
        })
        expect(response.status).toBe(200)
        expect((yield* json<Session.Info>(response)).time.archived).toBe(-1)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "uses project-scoped path and directory precedence",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const currentDir = path.join(test.directory, "packages", "opencode", "src")
        yield* Effect.promise(() => mkdir(currentDir, { recursive: true }))

        const store = yield* InstanceStore.Service
        const { pathSession, pathlessSession } = yield* store.provide(
          { directory: currentDir },
          Effect.gen(function* () {
            return {
              pathSession: yield* createSession(),
              pathlessSession: yield* createSession(),
            }
          }).pipe(Effect.provideService(TestInstance, { directory: currentDir })),
        )
        yield* clearSessionPath(pathlessSession.id)

        const query = new URLSearchParams({
          scope: "project",
          path: "packages/opencode/src",
          directory: currentDir,
        })
        const headers = { "x-opencode-directory": test.directory }
        const sessions = (yield* json<Session.Info[]>(
          yield* request(`${SessionPaths.list}?${query}`, { headers }),
        )).map((item) => item.id)

        expect(sessions).toContain(pathSession.id)
        expect(sessions).not.toContain(pathlessSession.id)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "lists sessions created through an equivalent directory hint",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const hint = test.directory + path.sep
        const headers = { "x-opencode-directory": hint, "content-type": "application/json" }
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "hinted" }),
        })

        const query = new URLSearchParams({ directory: hint, roots: "true" })
        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?${query}`, { headers })
        expect(listed.map((item) => item.id)).toContain(created.id)

        const globalQuery = new URLSearchParams({ directory: hint })
        const global = yield* requestJson<Session.Info[]>(`${ExperimentalPaths.session}?${globalQuery}`, { headers })
        expect(global.map((item) => item.id)).toContain(created.id)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
  )

  it.instance(
    "lists Windows sessions for equivalent directory spellings",
    () =>
      Effect.gen(function* () {
        if (process.platform !== "win32") return
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const created = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "windows spelling" }),
        })

        const forwardSlashes = test.directory.replaceAll("\\", "/")
        const lowercaseDrive = test.directory.replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
        const trailingSeparator = `${test.directory}\\`
        for (const spelling of [forwardSlashes, lowercaseDrive, trailingSeparator]) {
          const query = new URLSearchParams({ directory: spelling, roots: "true" })
          const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?${query}`, { headers })
          expect({ spelling, ids: listed.map((item) => item.id) }).toEqual({ spelling, ids: [created.id] })
        }
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
    { timeout: 15000 },
  )

  it.instance(
    "lists Windows sessions created through the global worktree sentinel",
    () =>
      Effect.gen(function* () {
        if (process.platform !== "win32") return
        const globalWorktreeSentinel = "/"
        const headers = { "x-opencode-directory": globalWorktreeSentinel, "content-type": "application/json" }
        const driveRootSession = yield* requestJson<Session.Info>(SessionPaths.create, {
          method: "POST",
          headers,
          body: JSON.stringify({ title: "created at drive root" }),
        })
        expect(driveRootSession.directory).toMatch(/^[A-Za-z]:\\$/)

        const query = new URLSearchParams({ directory: globalWorktreeSentinel, roots: "true" })
        const listed = yield* requestJson<Session.Info[]>(`${SessionPaths.list}?${query}`, { headers })
        expect(listed.map((item) => item.id)).toContain(driveRootSession.id)
      }),
    { git: true, config: { formatter: false, lsp: false, share: "disabled" } },
    { timeout: 15000 },
  )

  it.instance(
    "serves paginated message link headers",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory }
        const session = yield* createSession({ title: "messages" })
        yield* createTextMessage(session.id, "first")
        yield* createTextMessage(session.id, "second")
        const route = `${pathFor(SessionPaths.messages, { sessionID: session.id })}?limit=1`

        const response = yield* request(route, { headers })

        expect(response.headers["x-next-cursor"]).toBeTruthy()
        expect(response.headers["link"]).toContain("limit=1")
        expect(response.headers["access-control-expose-headers"]?.toLowerCase()).toContain("x-next-cursor")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves message mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "messages" })
        const first = yield* createTextMessage(session.id, "first")
        const second = yield* createTextMessage(session.id, "second")

        const updated = yield* requestJson<SessionV1.Part>(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: first.info.id,
            partID: first.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...first.part, text: "updated" }),
          },
        )
        expect(updated).toMatchObject({ id: first.part.id, type: "text", text: "updated" })

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deletePart, {
              sessionID: session.id,
              messageID: first.info.id,
              partID: first.part.id,
            }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)

        expect(
          yield* requestJson<boolean>(
            pathFor(SessionPaths.deleteMessage, { sessionID: session.id, messageID: second.info.id }),
            { method: "DELETE", headers },
          ),
        ).toBe(true)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects part updates whose path and body ids disagree",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "part mismatch" })
        const message = yield* createTextMessage(session.id, "first")
        const response = yield* request(
          pathFor(SessionPaths.updatePart, {
            sessionID: session.id,
            messageID: message.info.id,
            partID: message.part.id,
          }),
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ ...message.part, id: PartID.ascending() }),
          },
        )

        expect(response.status).toBe(400)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves remaining non-LLM session mutation routes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const headers = { "x-opencode-directory": test.directory, "content-type": "application/json" }
        const session = yield* createSession({ title: "remaining" })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
            method: "POST",
            headers,
            body: JSON.stringify({ messageID: MessageID.ascending() }),
          }),
        ).toMatchObject({ id: session.id })

        expect(
          yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
            method: "POST",
            headers,
          }),
        ).toMatchObject({ id: session.id })

        const permissionID = String(PermissionV1.ID.ascending())
        const permission = yield* request(
          pathFor(SessionPaths.permissions, {
            sessionID: session.id,
            permissionID,
          }),
          {
            method: "POST",
            headers,
            body: JSON.stringify({ response: "once" }),
          },
        )
        expect(permission.status).toBe(404)
        expect(yield* responseJson(permission)).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: permissionID,
          message: `Permission request not found: ${permissionID}`,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
