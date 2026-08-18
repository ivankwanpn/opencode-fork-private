import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import type * as SDK from "@opencode-ai/sdk/v2"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Effect, Exit, Layer, Option, Schema, Scope, Context, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Account } from "@/account/account"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import { legacySessionFromV2 } from "@/compat/native-v1-session"
import { MessageV2 } from "@/session/message-v2"

import { SessionID } from "@/session/schema"
import { Database } from "@opencode-ai/core/database/database"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Config } from "@/config/config"
import { SessionShareRemovalTable, SessionShareRevocationTable, SessionShareTable } from "@opencode-ai/core/share/sql"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionTable } from "@opencode-ai/core/session/sql"

const disabled = process.env["OPENCODE_DISABLE_SHARE"] === "true" || process.env["OPENCODE_DISABLE_SHARE"] === "1"

export type Api = {
  create: string
  sync: (shareID: string) => string
  remove: (shareID: string) => string
  data: (shareID: string) => string
}

export type Req = {
  headers: Record<string, string>
  api: Api
  baseUrl: string
}

const ShareSchema = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  secret: Schema.String,
})
export type Share = typeof ShareSchema.Type

type State = {
  queue: Map<SessionID, Map<string, Data>>
  retries: Set<SessionID>
  scope: Scope.Closeable
  shared: Map<SessionID, Share | null>
}

type Data =
  | {
      type: "session"
      data: SDK.Session
    }
  | {
      type: "message"
      data: SDK.Message
    }
  | {
      type: "part"
      data: SDK.Part
    }
  | {
      type: "session_diff"
      data: SDK.SnapshotFileDiff[]
    }
  | {
      type: "model"
      data: SDK.Model[]
    }

export interface Interface {
  readonly init: () => Effect.Effect<void, unknown>
  readonly url: () => Effect.Effect<string, unknown>
  readonly request: () => Effect.Effect<Req, unknown>
  readonly create: (sessionID: SessionID) => Effect.Effect<Share, unknown>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, unknown>
  readonly stageRemovals: (sessionIDs: readonly SessionID[]) => Effect.Effect<void>
  readonly revokePending: (input?: {
    readonly sessionIDs?: readonly SessionID[]
    readonly directory?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ShareNext") {}

export const use = serviceUse(Service)

function api(resource: string): Api {
  return {
    create: `/api/${resource}`,
    sync: (shareID) => `/api/${resource}/${shareID}/sync`,
    remove: (shareID) => `/api/${resource}/${shareID}`,
    data: (shareID) => `/api/${resource}/${shareID}/data`,
  }
}

const legacyApi = api("share")
const consoleApi = api("shares")

function key(item: Data) {
  switch (item.type) {
    case "session":
      return "session"
    case "message":
      return `message/${item.data.id}`
    case "part":
      return `part/${item.data.messageID}/${item.data.id}`
    case "session_diff":
      return "session_diff"
    case "model":
      return "model"
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const account = yield* Account.Service
    const events = yield* EventV2Bridge.Service
    const cfg = yield* Config.Service
    const { db } = yield* Database.Service
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)
    const provider = yield* Provider.Service
    const session = yield* SessionV2.Service

    function sync(sessionID: SessionID, data: Data[]) {
      return Effect.gen(function* () {
        if (disabled) return
        const share = yield* getCached(sessionID)
        if (!share) return

        const s = yield* InstanceState.get(state)
        const existing = s.queue.get(sessionID)
        if (existing) {
          for (const item of data) {
            existing.set(key(item), item)
          }
          return
        }

        const next = new Map(data.map((item) => [key(item), item]))
        s.queue.set(sessionID, next)
        yield* flush(sessionID).pipe(
          Effect.delay(1000),
          Effect.catchCause((cause) => Effect.logError("share flush failed", { sessionID: sessionID, cause: cause })),
          Effect.forkIn(s.scope),
        )
      })
    }

    const transcriptEvents = new Set<string>([
      SessionEvent.MessageImported.type,
      SessionEvent.TranscriptMutation.MessageRemoved.type,
      SessionEvent.TranscriptMutation.UserTextUpdated.type,
      SessionEvent.TranscriptMutation.UserTextRemoved.type,
      SessionEvent.TranscriptMutation.ContentUpdated.type,
      SessionEvent.TranscriptMutation.ContentRemoved.type,
      SessionEvent.AgentSwitched.type,
      SessionEvent.ModelSwitched.type,
      SessionEvent.Prompted.type,
      SessionEvent.ContextUpdated.type,
      SessionEvent.Synthetic.type,
      SessionEvent.Shell.Started.type,
      SessionEvent.Shell.Ended.type,
      SessionEvent.Step.Started.type,
      SessionEvent.Step.Ended.type,
      SessionEvent.Step.Failed.type,
      SessionEvent.Text.Started.type,
      SessionEvent.Text.Ended.type,
      SessionEvent.Reasoning.Started.type,
      SessionEvent.Reasoning.Ended.type,
      SessionEvent.Tool.Input.Started.type,
      SessionEvent.Tool.Input.Ended.type,
      SessionEvent.Tool.Called.type,
      SessionEvent.Tool.Progress.type,
      SessionEvent.Tool.Success.type,
      SessionEvent.Tool.Failed.type,
      SessionEvent.Compaction.Ended.type,
      SessionEvent.RevertEvent.Committed.type,
    ])

    const syncTranscript = Effect.fn("ShareNext.syncTranscript")(function* (sessionID: SessionID) {
      const info = yield* session.get(SessionV2.ID.make(sessionID))
      const canonical = yield* session.messages({ sessionID: info.id, order: "asc" })
      const messages = MessageV2.toLegacy(info, canonical)
      yield* sync(sessionID, [
        ...messages.map((message) => ({ type: "message" as const, data: message.info })),
        ...messages.flatMap((message) => message.parts.map((part) => ({ type: "part" as const, data: part }))),
      ])
      const models = yield* Effect.forEach(
        Array.from(
          new Map(
            messages
              .filter((message) => message.info.role === "user")
              .map((message) => (message.info as SDK.UserMessage).model)
              .map((model) => [`${model.providerID}/${model.modelID}`, model] as const),
          ).values(),
        ),
        (model) => provider.getModel(ProviderV2.ID.make(model.providerID), ModelV2.ID.make(model.modelID)),
        { concurrency: 8 },
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("share model sync skipped", { sessionID, cause }).pipe(Effect.as([] as SDK.Model[])),
        ),
      )
      if (models.length > 0) yield* sync(sessionID, [{ type: "model", data: models }])
    })

    const state: InstanceState.InstanceState<State> = yield* InstanceState.make<State>(
      Effect.fn("ShareNext.state")(function* (_ctx) {
        const cache: State = { queue: new Map(), retries: new Set(), scope: yield* Scope.make(), shared: new Map() }

        yield* Effect.addFinalizer(() =>
          Scope.close(cache.scope, Exit.void).pipe(
            Effect.andThen(
              Effect.sync(() => {
                cache.queue.clear()
                cache.retries.clear()
                cache.shared.clear()
              }),
            ),
          ),
        )

        if (disabled) return cache

        const watch = <D extends EventV2.Definition>(
          def: D,
          fn: (data: EventV2.Data<D>) => Effect.Effect<void, unknown>,
        ) =>
          events.listen((event) => {
            if (event.type !== def.type || event.location?.directory !== _ctx.directory) return Effect.void
            return fn(event.data as EventV2.Data<D>).pipe(
              Effect.catchCause((cause) =>
                Effect.logError("share subscriber failed", { type: def.type, cause: cause }),
              ),
            )
          })

        yield* watch(SessionEvent.Updated, (data) =>
          Effect.gen(function* () {
            const info = yield* session.get(data.sessionID)
            yield* sync(SessionID.make(info.id), [
              { type: "session", data: structuredClone(legacySessionFromV2(info)) as SDK.Session },
            ])
          }),
        )
        yield* events.listen((event) => {
          if (!transcriptEvents.has(event.type) || event.location?.directory !== _ctx.directory) return Effect.void
          const sessionID = (event.data as { sessionID?: string }).sessionID
          if (!sessionID) return Effect.void
          return syncTranscript(sessionID as SessionID).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("share transcript subscriber failed", { type: event.type, cause }),
            ),
          )
        })
        yield* watch(SessionEvent.Diff, (data) =>
          sync(SessionID.make(data.sessionID), [
            { type: "session_diff", data: structuredClone(data.diff) as SDK.SnapshotFileDiff[] },
          ]),
        )
        yield* watch(SessionEvent.Deleted, (data) =>
          Effect.gen(function* () {
            const sessionID = SessionID.make(data.sessionID)
            const current = yield* InstanceState.get(state)
            current.shared.delete(sessionID)
            current.queue.delete(sessionID)
            yield* revokePending({ sessionIDs: [sessionID] })
          }),
        )

        return cache
      }),
    )

    const request = Effect.fn("ShareNext.request")(function* () {
      const headers: Record<string, string> = {}
      const active = yield* account.active()
      if (Option.isNone(active) || !active.value.active_org_id) {
        const baseUrl = (yield* cfg.get()).enterprise?.url ?? "https://opncd.ai"
        return { headers, api: legacyApi, baseUrl } satisfies Req
      }

      const token = yield* account.token(active.value.id)
      if (Option.isNone(token)) {
        throw new Error("No active account token available for sharing")
      }

      headers.authorization = `Bearer ${token.value}`
      headers["x-org-id"] = active.value.active_org_id
      return { headers, api: consoleApi, baseUrl: active.value.url } satisfies Req
    })

    const get = Effect.fnUntraced(function* (sessionID: SessionID) {
      const row = yield* db
        .select()
        .from(SessionShareTable)
        .where(eq(SessionShareTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return
      return { id: row.id, secret: row.secret, url: row.url } satisfies Share
    })

    const getCached = Effect.fnUntraced(function* (sessionID: SessionID) {
      const s = yield* InstanceState.get(state)
      if (s.shared.has(sessionID)) {
        const cached = s.shared.get(sessionID)
        return cached === null ? undefined : cached
      }

      const share = yield* get(sessionID)
      s.shared.set(sessionID, share ?? null)
      return share
    })

    const stageRemovals = Effect.fn("ShareNext.stageRemovals")(function* (sessionIDs: readonly SessionID[]) {
      if (sessionIDs.length === 0) return
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              const sessions = yield* tx
                .select({ session_id: SessionTable.id, directory: SessionTable.directory })
                .from(SessionTable)
                .where(inArray(SessionTable.id, sessionIDs))
                .all()
              const rows = yield* tx
                .select({
                  session_id: SessionShareTable.session_id,
                  directory: SessionTable.directory,
                  id: SessionShareTable.id,
                  secret: SessionShareTable.secret,
                  url: SessionShareTable.url,
                })
                .from(SessionShareTable)
                .innerJoin(SessionTable, eq(SessionTable.id, SessionShareTable.session_id))
                .where(inArray(SessionShareTable.session_id, sessionIDs))
                .all()
              yield* Effect.forEach(
                sessions,
                (row) =>
                  tx
                    .insert(SessionShareRemovalTable)
                    .values(row)
                    .onConflictDoUpdate({
                      target: SessionShareRemovalTable.session_id,
                      set: { directory: row.directory },
                    })
                    .run(),
                { discard: true },
              )
              yield* Effect.forEach(
                rows,
                (row) =>
                  tx
                    .insert(SessionShareRevocationTable)
                    .values({ ...row, attempt_count: 0 })
                    .onConflictDoUpdate({
                      target: [SessionShareRevocationTable.session_id, SessionShareRevocationTable.id],
                      set: {
                        directory: row.directory,
                        secret: row.secret,
                        url: row.url,
                        attempt_count: 0,
                      },
                    })
                    .run(),
                { discard: true },
              )
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
    })

    const revoke = Effect.fnUntraced(function* (share: Share) {
      const req = yield* request()
      const response = yield* HttpClientRequest.delete(`${req.baseUrl}${req.api.remove(share.id)}`).pipe(
        HttpClientRequest.setHeaders(req.headers),
        HttpClientRequest.bodyJson({ secret: share.secret }),
        Effect.flatMap((request) => http.execute(request)),
      )
      if ((response.status >= 200 && response.status < 300) || response.status === 404) return
      return yield* Effect.fail(new Error(`Share revocation failed with status ${response.status}`))
    })

    const processPending = Effect.fnUntraced(function* (input?: {
      readonly sessionIDs?: readonly SessionID[]
      readonly directory?: string
    }) {
      if (disabled || input?.sessionIDs?.length === 0) return [] as SessionID[]
      const query = db.select().from(SessionShareRevocationTable)
      const rows = yield* (
        input?.sessionIDs && input.directory
          ? query
              .where(
                and(
                  inArray(SessionShareRevocationTable.session_id, input.sessionIDs),
                  eq(SessionShareRevocationTable.directory, input.directory),
                ),
              )
              .all()
          : input?.sessionIDs
            ? query.where(inArray(SessionShareRevocationTable.session_id, input.sessionIDs)).all()
            : input?.directory
              ? query.where(eq(SessionShareRevocationTable.directory, input.directory)).all()
              : query.all()
      ).pipe(Effect.orDie)

      const failures = yield* Effect.forEach(
        rows,
        (row) =>
          Effect.gen(function* () {
            const current = yield* db
              .transaction(
                (tx) =>
                  Effect.gen(function* () {
                    const active = yield* tx
                      .select({ id: SessionTable.id })
                      .from(SessionTable)
                      .where(eq(SessionTable.id, SessionID.make(row.session_id)))
                      .get()
                    const share = yield* tx
                      .select({ id: SessionShareTable.id, secret: SessionShareTable.secret })
                      .from(SessionShareTable)
                      .where(eq(SessionShareTable.session_id, SessionID.make(row.session_id)))
                      .get()
                    return { active: active !== undefined, share }
                  }),
                { behavior: "immediate" },
              )
              .pipe(Effect.orDie)
            if (current.active && current.share?.id === row.id && current.share.secret === row.secret) return

            yield* revoke({ id: row.id, secret: row.secret, url: row.url })
            yield* db
              .delete(SessionShareRevocationTable)
              .where(
                and(
                  eq(SessionShareRevocationTable.session_id, row.session_id),
                  eq(SessionShareRevocationTable.id, row.id),
                ),
              )
              .run()
              .pipe(Effect.orDie)
            if (!current.active || !current.share) {
              const s = yield* InstanceState.get(state)
              s.shared.delete(SessionID.make(row.session_id))
              s.queue.delete(SessionID.make(row.session_id))
            }
            return
          }).pipe(
            Effect.catchCause((cause) =>
              db
                .update(SessionShareRevocationTable)
                .set({ attempt_count: sql`${SessionShareRevocationTable.attempt_count} + 1` })
                .where(
                  and(
                    eq(SessionShareRevocationTable.session_id, row.session_id),
                    eq(SessionShareRevocationTable.id, row.id),
                  ),
                )
                .run()
                .pipe(
                  Effect.orDie,
                  Effect.andThen(
                    Effect.logWarning("share revocation deferred", {
                      sessionID: row.session_id,
                      shareID: row.id,
                      cause,
                    }),
                  ),
                  Effect.as(SessionID.make(row.session_id)),
                ),
            ),
          ),
        { concurrency: 4 },
      )

      const removalQuery = db.select().from(SessionShareRemovalTable)
      const removals = yield* (
        input?.sessionIDs && input.directory
          ? removalQuery
              .where(
                and(
                  inArray(SessionShareRemovalTable.session_id, input.sessionIDs),
                  eq(SessionShareRemovalTable.directory, input.directory),
                ),
              )
              .all()
          : input?.sessionIDs
            ? removalQuery.where(inArray(SessionShareRemovalTable.session_id, input.sessionIDs)).all()
            : input?.directory
              ? removalQuery.where(eq(SessionShareRemovalTable.directory, input.directory)).all()
              : removalQuery.all()
      ).pipe(Effect.orDie)
      yield* Effect.forEach(
        removals,
        (row) =>
          db
            .transaction(
              (tx) =>
                Effect.gen(function* () {
                  const active = yield* tx
                    .select({ id: SessionTable.id })
                    .from(SessionTable)
                    .where(eq(SessionTable.id, SessionID.make(row.session_id)))
                    .get()
                  if (active) return
                  const pending = yield* tx
                    .select({ id: SessionShareRevocationTable.id })
                    .from(SessionShareRevocationTable)
                    .where(eq(SessionShareRevocationTable.session_id, row.session_id))
                    .get()
                  if (pending) return
                  yield* tx
                    .delete(SessionShareRemovalTable)
                    .where(eq(SessionShareRemovalTable.session_id, row.session_id))
                    .run()
                }),
              { behavior: "immediate" },
            )
            .pipe(Effect.orDie),
        { concurrency: 1, discard: true },
      )
      return failures.filter((sessionID): sessionID is SessionID => sessionID !== undefined)
    })

    const scheduleRetries = Effect.fnUntraced(function* (sessionIDs: readonly SessionID[]) {
      if (sessionIDs.length === 0) return
      const s = yield* InstanceState.get(state)
      yield* Effect.forEach(
        [...new Set(sessionIDs)],
        (sessionID) => {
          if (s.retries.has(sessionID)) return Effect.void
          s.retries.add(sessionID)
          return Stream.fromIterable(["1 second", "5 seconds", "15 seconds"] as const).pipe(
            Stream.mapEffect((delay) =>
              Effect.sleep(delay).pipe(
                Effect.andThen(processPending({ sessionIDs: [sessionID] })),
                Effect.map((failures) => failures.includes(sessionID)),
              ),
            ),
            Stream.takeUntil((pending) => !pending),
            Stream.runDrain,
            Effect.ensuring(Effect.sync(() => s.retries.delete(sessionID))),
            Effect.forkIn(s.scope),
            Effect.asVoid,
          )
        },
        { discard: true },
      )
    })

    const revokePending = Effect.fn("ShareNext.revokePending")(function* (input?: {
      readonly sessionIDs?: readonly SessionID[]
      readonly directory?: string
    }) {
      yield* scheduleRetries(yield* processPending(input))
    })

    const flush = Effect.fn("ShareNext.flush")(function* (sessionID: SessionID) {
      if (disabled) return
      const s = yield* InstanceState.get(state)
      const queued = s.queue.get(sessionID)
      if (!queued) return

      s.queue.delete(sessionID)

      const share = yield* getCached(sessionID)
      if (!share) return

      const req = yield* request()
      const res = yield* HttpClientRequest.post(`${req.baseUrl}${req.api.sync(share.id)}`).pipe(
        HttpClientRequest.setHeaders(req.headers),
        HttpClientRequest.bodyJson({ secret: share.secret, data: Array.from(queued.values()) }),
        Effect.flatMap((r) => http.execute(r)),
      )

      if (res.status >= 400) {
        yield* Effect.logWarning("failed to sync share", {
          sessionID: sessionID,
          shareID: share.id,
          status: res.status,
        })
      }
    })

    const full = Effect.fn("ShareNext.full")(function* (sessionID: SessionID) {
      yield* Effect.logInfo("full sync", { sessionID: sessionID })
      const current = yield* session.get(SessionV2.ID.make(sessionID))
      const canonical = yield* session.messages({ sessionID: current.id, order: "asc" })
      const info = legacySessionFromV2(current)
      const diffs: SDK.SnapshotFileDiff[] = []
      const messages = MessageV2.toLegacy(current, canonical)
      const models = yield* Effect.forEach(
        Array.from(
          new Map(
            messages
              .filter((msg) => msg.info.role === "user")
              .map((msg) => (msg.info as SDK.UserMessage).model)
              .map((item) => [`${item.providerID}/${item.modelID}`, item] as const),
          ).values(),
        ),
        (item) => provider.getModel(ProviderV2.ID.make(item.providerID), ModelV2.ID.make(item.modelID)),
        { concurrency: 8 },
      )

      yield* sync(sessionID, [
        { type: "session", data: info },
        ...messages.map((item) => ({ type: "message" as const, data: item.info })),
        ...messages.flatMap((item) => item.parts.map((part) => ({ type: "part" as const, data: part }))),
        { type: "session_diff", data: diffs },
        { type: "model", data: models },
      ])
    })

    const init = Effect.fn("ShareNext.init")(function* () {
      yield* InstanceState.get(state)
      if (disabled) return
      const ctx = yield* InstanceState.context
      yield* revokePending({ directory: ctx.directory })
    })

    const url = Effect.fn("ShareNext.url")(function* () {
      return (yield* request()).baseUrl
    })

    const create = Effect.fn("ShareNext.create")(function* (sessionID: SessionID) {
      if (disabled) return { id: "", url: "", secret: "" }
      yield* Effect.logInfo("creating share", { sessionID: sessionID })
      const preflight = yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              const removal = yield* tx
                .select({ session_id: SessionShareRemovalTable.session_id })
                .from(SessionShareRemovalTable)
                .where(eq(SessionShareRemovalTable.session_id, sessionID))
                .get()
              if (removal) return { type: "removing" as const }
              const existing = yield* tx
                .select()
                .from(SessionShareTable)
                .where(eq(SessionShareTable.session_id, sessionID))
                .get()
              if (existing)
                return {
                  type: "existing" as const,
                  share: { id: existing.id, secret: existing.secret, url: existing.url },
                }
              const active = yield* tx
                .select({ directory: SessionTable.directory })
                .from(SessionTable)
                .where(eq(SessionTable.id, sessionID))
                .get()
              if (!active) return { type: "missing" as const }
              return { type: "create" as const, directory: active.directory }
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      if (preflight.type === "removing") return yield* Effect.fail(new Error("Session is being removed"))
      if (preflight.type === "missing") return yield* Effect.fail(new Error(`Session not found: ${sessionID}`))
      if (preflight.type === "existing") {
        const s = yield* InstanceState.get(state)
        s.shared.set(sessionID, preflight.share)
        return preflight.share
      }

      const req = yield* request()
      const result = yield* HttpClientRequest.post(`${req.baseUrl}${req.api.create}`).pipe(
        HttpClientRequest.setHeaders(req.headers),
        HttpClientRequest.bodyJson({ sessionID }),
        Effect.flatMap((r) => httpOk.execute(r)),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ShareSchema)),
      )
      const persisted = yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              const removal = yield* tx
                .select({ session_id: SessionShareRemovalTable.session_id })
                .from(SessionShareRemovalTable)
                .where(eq(SessionShareRemovalTable.session_id, sessionID))
                .get()
              const active = yield* tx
                .select({ id: SessionTable.id })
                .from(SessionTable)
                .where(eq(SessionTable.id, sessionID))
                .get()
              const existing = yield* tx
                .select()
                .from(SessionShareTable)
                .where(eq(SessionShareTable.session_id, sessionID))
                .get()
              if (!active || removal || existing) {
                yield* tx
                  .insert(SessionShareRevocationTable)
                  .values({
                    session_id: sessionID,
                    directory: preflight.directory,
                    id: result.id,
                    secret: result.secret,
                    url: result.url,
                    attempt_count: 0,
                  })
                  .onConflictDoUpdate({
                    target: [SessionShareRevocationTable.session_id, SessionShareRevocationTable.id],
                    set: {
                      directory: preflight.directory,
                      secret: result.secret,
                      url: result.url,
                      attempt_count: 0,
                    },
                  })
                  .run()
                if (existing && !removal && active)
                  return {
                    type: "existing" as const,
                    share: { id: existing.id, secret: existing.secret, url: existing.url },
                  }
                return { type: "orphan" as const }
              }
              yield* tx
                .insert(SessionShareTable)
                .values({ session_id: sessionID, id: result.id, secret: result.secret, url: result.url })
                .run()
              return { type: "created" as const }
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      if (persisted.type !== "created") {
        yield* revokePending({ sessionIDs: [sessionID] })
        if (persisted.type === "existing") return persisted.share
        return yield* Effect.fail(new Error("Session was removed while its share was being created"))
      }
      const s = yield* InstanceState.get(state)
      s.shared.set(sessionID, result)
      yield* full(sessionID).pipe(
        Effect.catchCause((cause) => Effect.logError("share full sync failed", { sessionID: sessionID, cause: cause })),
        Effect.forkIn(s.scope),
      )
      return result
    })

    const remove = Effect.fn("ShareNext.remove")(function* (sessionID: SessionID) {
      if (disabled) return
      yield* Effect.logInfo("removing share", { sessionID: sessionID })
      const s = yield* InstanceState.get(state)
      const share = yield* getCached(sessionID)
      if (!share) {
        s.shared.delete(sessionID)
        s.queue.delete(sessionID)
        return
      }

      yield* revoke(share)
      yield* db
        .transaction(() =>
          Effect.gen(function* () {
            yield* db.delete(SessionShareTable).where(eq(SessionShareTable.session_id, sessionID)).run()
            yield* db
              .delete(SessionShareRevocationTable)
              .where(
                and(
                  eq(SessionShareRevocationTable.session_id, sessionID),
                  eq(SessionShareRevocationTable.id, share.id),
                ),
              )
              .run()
          }),
        )
        .pipe(Effect.orDie)
      s.shared.delete(sessionID)
      s.queue.delete(sessionID)
    })

    return Service.of({ init, url, request, create, remove, stageRemovals, revokePending })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Account.node, EventV2Bridge.node, Config.node, Database.node, httpClient, Provider.node, SessionV2.node],
})

export * as ShareNext from "./share-next"
