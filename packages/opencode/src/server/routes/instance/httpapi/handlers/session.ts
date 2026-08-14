import { PermissionV2 } from "@opencode-ai/core/permission"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { SessionV2 } from "@opencode-ai/core/session"
import { toV2Rules } from "@opencode-ai/core/session/info"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { legacySessionFromV2 } from "@/compat/native-v1-session"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { LegacySessionExecution } from "@/session/legacy-session-execution"
import { Session, cancelBackgroundJobs, childTitlePrefix } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { DateTime, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import { ApiNotFoundError, PermissionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

const mapExecutionBadRequest = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    SessionError.mapStorageNotFound,
    SessionError.mapSessionNotFound,
    Effect.mapError((error) => (Schema.is(ApiNotFoundError)(error) ? error : new HttpApiError.BadRequest({}))),
  )

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

const hasUnsupportedPromptShape = (input: typeof PromptPayload.Type) => {
  if (input.parts[0]?.type !== "text") return true

  let filesComplete = false
  for (const [index, part] of input.parts.entries()) {
    if (part.id !== undefined || part.type === "subtask") return true
    if (part.type === "text") {
      if (
        index !== 0 ||
        part.synthetic !== undefined ||
        part.ignored !== undefined ||
        part.time !== undefined ||
        part.metadata !== undefined
      )
        return true
      continue
    }
    if (part.type === "file") {
      if (filesComplete || (part.source !== undefined && part.source.type !== "resource")) return true
      continue
    }
    filesComplete = true
  }
  return false
}

const toCanonicalFile = (part: SessionV1.FilePartInput): PromptInput.FileAttachment =>
  PromptInput.FileAttachment.make({
    uri: part.url,
    mime: part.mime,
    name: part.filename,
    source: part.source && {
      text: part.source.text.value,
      start: part.source.text.start,
      end: part.source.text.end,
    },
    resource:
      part.source?.type === "resource"
        ? {
            clientName: part.source.clientName,
            uri: part.source.uri,
          }
        : undefined,
  })

const hasUnsupportedCommandShape = (input: typeof CommandPayload.Type) =>
  input.parts?.some(
    (part) => part.id !== undefined || (part.source !== undefined && part.source.type !== "resource"),
  ) ?? false

const toCanonicalPrompt = (input: typeof PromptPayload.Type): PromptInput.Prompt => {
  const files = input.parts.filter((part): part is SessionV1.FilePartInput => part.type === "file").map(toCanonicalFile)
  const agents = input.parts
    .filter((part): part is SessionV1.AgentPartInput => part.type === "agent")
    .map((part) => ({
      name: part.name,
      source: part.source && {
        text: part.source.value,
        start: part.source.start,
        end: part.source.end,
      },
    }))

  return PromptInput.Prompt.make({
    text: input.parts
      .filter((part): part is SessionV1.TextPartInput => part.type === "text")
      .map((part) => part.text)
      .join(""),
    ...(files.length === 0 ? {} : { files }),
    ...(agents.length === 0 ? {} : { agents }),
    ...(input.system === undefined ? {} : { system: input.system }),
    ...(input.tools === undefined ? {} : { tools: input.tools }),
    ...(input.format === undefined ? {} : { format: input.format }),
  })
}

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const sessionExecution = yield* LegacySessionExecution.Service
    const shareSvc = yield* SessionShare.Service
    const revertSvc = yield* SessionV2.Service
    const canonical = yield* SessionV2.Service
    const scope = yield* Scope.Scope
    const runState = yield* SessionRunState.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const locations = yield* LocationServiceMap.Service

    const location = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      const ctx = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      return yield* effect.pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({
              directory: AbsolutePath.make(ctx.directory),
              ...(workspaceID === undefined ? {} : { workspaceID }),
            }),
          ),
        ),
      )
    })

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const query = ctx.query
      const ctxState = yield* InstanceState.context
      const directory = query.directory ? yield* InstanceState.directory : undefined
      const scoped = query.scope === "project"
      const hasSubpath = query.path !== undefined && query.path !== ""
      // V1 parity: scope=project suppresses the directory filter; path="" disables
      // both filters; a truthy path selects exact-or-prefix (plus the core impl's
      // pathless-directory fallback when directory is also given).
      const includeDirectory = (query.path === undefined || hasSubpath) && !scoped && directory !== undefined
      const input: Extract<SessionV2.ListInput, { project: unknown }> = {
        project: ctxState.project.id,
        orderBy: "updated",
        ...(!hasSubpath ? {} : { subpath: RelativePath.make(query.path) }),
        ...(!includeDirectory ? {} : { directory: AbsolutePath.make(directory) }),
        ...(query.roots === undefined ? {} : { parentID: query.roots ? null : undefined }),
        ...(query.start === undefined ? {} : { start: query.start }),
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.limit === undefined ? { limit: 100 } : { limit: query.limit }),
      }
      const items = yield* canonical.list(input)
      return items.map(legacySessionFromV2)
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      const info = yield* canonical.get(SessionV2.ID.make(sessionID)).pipe(SessionError.mapSessionNotFound)
      return legacySessionFromV2(info)
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const kids = yield* canonical.children(SessionV2.ID.make(ctx.params.sessionID)).pipe(SessionError.mapSessionNotFound)
      return kids.map(legacySessionFromV2)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      const before = ctx.query.before
        ? yield* Effect.try({
            try: () => MessageV2.cursor.decode(ctx.query.before!),
            catch: () => new HttpApiError.BadRequest({}),
          })
        : undefined
      const current = yield* revertSvc
        .get(SessionV2.ID.make(ctx.params.sessionID))
        .pipe(SessionError.mapSessionNotFound)
      const history = MessageV2.toLegacy(
        current,
        yield* revertSvc
          .messages({ sessionID: current.id, order: "asc" })
          .pipe(SessionError.mapSessionNotFound, Effect.catchTag("Session.MessageDecodeError", Effect.die)),
      )
      if (ctx.query.limit === undefined || ctx.query.limit === 0) return history

      const boundary = before ? history.findIndex((message) => message.info.id === before.id) : history.length
      const available = before
        ? boundary >= 0
          ? history.slice(0, boundary)
          : history.filter(
              (message) =>
                message.info.time.created < before.time ||
                (message.info.time.created === before.time && message.info.id < before.id),
            )
        : history
      const more = available.length > ctx.query.limit
      const items = available.slice(-ctx.query.limit)
      const oldest = items[0]
      const cursor =
        more && oldest
          ? MessageV2.cursor.encode({
              id: oldest.info.id,
              time: oldest.info.time.created,
            })
          : undefined
      if (!cursor) return items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", cursor)
      return HttpServerResponse.jsonUnsafe(items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      const current = yield* revertSvc.get(sessionID).pipe(SessionError.mapSessionNotFound)
      const found = yield* revertSvc.message({
        sessionID,
        messageID: SessionMessage.ID.make(ctx.params.messageID),
      })
      if (!found) {
        return yield* new ApiNotFoundError({
          name: "NotFoundError",
          data: { message: `Message not found: ${ctx.params.messageID}` },
        })
      }
      const projected = MessageV2.toLegacy(
        current,
        yield* revertSvc
          .messages({ sessionID, order: "asc" })
          .pipe(SessionError.mapSessionNotFound, Effect.catchTag("Session.MessageDecodeError", Effect.die)),
      ).find((message) => message.info.id === ctx.params.messageID)
      if (projected) return projected
      return yield* new ApiNotFoundError({
        name: "NotFoundError",
        data: { message: `Message not found: ${ctx.params.messageID}` },
      })
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      const payload = ctx.payload
      const ctxState = yield* InstanceState.context
      const workspaceID = yield* InstanceState.workspaceID
      const created = yield* canonical.create({
        ...(payload?.parentID === undefined ? {} : { parentID: SessionV2.ID.make(payload.parentID) }),
        ...(payload?.title === undefined
          ? payload?.parentID === undefined
            ? {}
            : { title: `${childTitlePrefix}${new Date().toISOString()}` }
          : { title: payload.title }),
        ...(payload?.agent === undefined ? {} : { agent: AgentV2.ID.make(payload.agent) }),
        ...(payload?.model === undefined
          ? {}
          : {
              model: {
                id: ModelV2.ID.make(payload.model.id),
                providerID: ProviderV2.ID.make(payload.model.providerID),
                ...(payload.model.variant === undefined ? {} : { variant: ModelV2.VariantID.make(payload.model.variant) }),
                ...(payload.model.protocol === undefined ? {} : { protocol: payload.model.protocol }),
              },
            }),
        ...(payload?.metadata === undefined ? {} : { metadata: payload.metadata }),
        ...(payload?.permission === undefined ? {} : { permissions: toV2Rules(payload.permission) }),
        location: Location.Ref.make({
          directory: AbsolutePath.make(ctxState.directory),
          ...((payload?.workspaceID ?? workspaceID) === undefined
            ? {}
            : { workspaceID: payload?.workspaceID ?? workspaceID }),
        }),
      })

      if (created.parentID === undefined) {
        const flags = yield* RuntimeFlags.Service
        const cfg = yield* Config.Service
        const conf = yield* cfg.get()
        if (flags.autoShare || conf.share === "auto") {
          // Same fire-and-forget auto-share as the removed SessionShare.create:
          // disabled-config and share failures are logged and swallowed.
          yield* Effect.gen(function* () {
            const shareConf = yield* cfg.get()
            if (shareConf.share === "disabled") return
            const shareNext = yield* ShareNext.Service
            const result = yield* shareNext.create(SessionID.make(created.id))
            yield* canonical.update({ sessionID: created.id, share: { url: result.url } })
          }).pipe(Effect.ignore, Effect.forkIn(scope))
        }
      }

      return yield* requireSession(SessionID.make(created.id)).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const collectDescendants = Effect.fnUntraced(function* (
      sessionID: SessionV2.ID,
    ): Effect.fn.Return<SessionV2.ID[], never, never> {
      const kids = yield* canonical.children(sessionID).pipe(Effect.orDie)
      const nested = yield* Effect.forEach(kids, (kid) => collectDescendants(kid.id), {
        concurrency: "unbounded",
      })
      return [...kids.map((kid) => kid.id), ...nested.flat()]
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      const hasInstance = yield* InstanceState.context.pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      )
      if (hasInstance) {
        const background = yield* BackgroundJob.Service
        // V1 canceled jobs per session during its recursion; the V2 core
        // recursion does not know BackgroundJob, so cancel the whole subtree
        // up front (root + descendants) before the core removes it.
        const descendants = yield* collectDescendants(sessionID)
        for (const id of [sessionID, ...descendants]) {
          yield* cancelBackgroundJobs(background, SessionID.make(id))
        }
      }
      yield* canonical.remove(sessionID).pipe(SessionError.mapSessionNotFound)
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload
      if (payload.title !== undefined || payload.metadata !== undefined || payload.time?.archived !== undefined) {
        yield* canonical
          .update({
            sessionID,
            ...(payload.title === undefined ? {} : { title: payload.title }),
            ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
            ...(payload.time?.archived === undefined ? {} : { archived: DateTime.makeUnsafe(payload.time.archived) }),
          })
          .pipe(SessionError.mapSessionNotFound)
      }
      if (payload.permission !== undefined) {
        const current = yield* canonical.permissions(sessionID).pipe(SessionError.mapSessionNotFound)
        // V1 merged the current rules with the payload via Permission.merge,
        // which is flat concatenation; the V2 column shape concatenates the
        // same way (last-match-wins at evaluation time).
        yield* canonical
          .setPermissions({ sessionID, permissions: [...current, ...toV2Rules(payload.permission)] })
          .pipe(SessionError.mapSessionNotFound)
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      const sessionID = SessionV2.ID.make(ctx.params.sessionID)
      const history = yield* canonical.messages({ sessionID, order: "asc" }).pipe(
        Effect.catchTag("Session.MessageDecodeError", Effect.die),
        SessionError.mapSessionNotFound,
      )
      const cutoff = ctx.payload?.messageID
      let messages = history
      if (cutoff !== undefined) {
        // Cut at the cutoff's TRANSCRIPT index (ruling 3): the old lexicographic
        // filter could copy an arbitrary subset when imported IDs sort outside
        // transcript order. An unknown cutoff is a client error.
        const index = history.findIndex((message) => String(message.id) === String(cutoff))
        if (index < 0) return yield* new HttpApiError.BadRequest({})
        messages = history.slice(0, index)
      }
      const forked = yield* canonical.fork({ sessionID, messages }).pipe(SessionError.mapSessionNotFound)
      return yield* requireSession(SessionID.make(forked.id))
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: { params: { sessionID: SessionID } }) {
      const sessionID = SessionID.make(ctx.params.sessionID)
      yield* sessionExecution.abort(sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* mapExecutionBadRequest(
        sessionExecution.init({
          session: legacySession,
          messageID: SessionMessage.ID.make(ctx.payload.messageID),
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        }),
      )
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc
        .summarize({
          sessionID: ctx.params.sessionID,
          model: { providerID: ctx.payload.providerID, id: ctx.payload.modelID },
          auto: ctx.payload.auto,
        })
        .pipe(
          SessionError.mapStorageNotFound,
          SessionError.mapSessionNotFound,
          SessionError.mapExecutionBusy,
        )
      return true
    })

    const runCanonicalPrompt = Effect.fn("SessionHttpApi.runCanonicalPrompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      return yield* mapExecutionBadRequest(
        sessionExecution.prompt({
          session: legacySession,
          id: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          prompt: toCanonicalPrompt(ctx.payload),
          selection: {
            agent: ctx.payload.agent,
            model: ctx.payload.model,
            variant: ctx.payload.variant,
            tools: ctx.payload.tools,
          },
          noReply: ctx.payload.noReply,
        }),
      )
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      if (hasUnsupportedPromptShape(ctx.payload)) return yield* new HttpApiError.BadRequest({})
      const message = yield* runCanonicalPrompt(ctx)
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      if (hasUnsupportedPromptShape(ctx.payload)) return yield* new HttpApiError.BadRequest({})

      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* mapExecutionBadRequest(
        sessionExecution.promptAsync({
          session: legacySession,
          id: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          prompt: toCanonicalPrompt(ctx.payload),
          selection: {
            agent: ctx.payload.agent,
            model: ctx.payload.model,
            variant: ctx.payload.variant,
            tools: ctx.payload.tools,
          },
          noReply: ctx.payload.noReply,
        }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      if (hasUnsupportedCommandShape(ctx.payload)) return yield* new HttpApiError.BadRequest({})

      const model = ctx.payload.model
        ? (() => {
            const [providerID, ...modelID] = ctx.payload.model.split("/")
            return {
              providerID: ProviderV2.ID.make(providerID),
              id: ModelV2.ID.make(modelID.join("/")),
            }
          })()
        : undefined
      return yield* mapExecutionBadRequest(
        sessionExecution.command({
          session: legacySession,
          id: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          command: ctx.payload.command,
          arguments: ctx.payload.arguments,
          agent: ctx.payload.agent === undefined ? undefined : AgentV2.ID.make(ctx.payload.agent),
          model,
          variant: ctx.payload.variant ? ModelV2.VariantID.make(ctx.payload.variant) : undefined,
          files: ctx.payload.parts?.map(toCanonicalFile),
        }),
      )
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      return yield* sessionExecution
        .shell({
          session: legacySession,
          userID: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          command: ctx.payload.command,
          selection: {
            agent: ctx.payload.agent,
            model: ctx.payload.model,
          },
        })
        .pipe(
          SessionError.mapSessionNotFound,
          SessionError.mapExecutionBusy,
          Effect.catchTag("LegacySessionExecution.InvalidSelectionError", () =>
            Effect.fail(new HttpApiError.BadRequest({})),
          ),
        )
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const current = yield* revertSvc
        .get(SessionV2.ID.make(ctx.params.sessionID))
        .pipe(SessionError.mapSessionNotFound)
      const canonical = yield* revertSvc
        .messages({ sessionID: current.id, order: "asc" })
        .pipe(SessionError.mapSessionNotFound, Effect.catchTag("Session.MessageDecodeError", Effect.die))
      const boundary = MessageV2.resolveRevertBoundary(current, canonical, ctx.payload)
      if (boundary.status === "unsupported" || (ctx.payload.partID && boundary.status === "not-found")) {
        return yield* new HttpApiError.BadRequest({})
      }
      if (boundary.status === "not-found") return yield* requireSession(ctx.params.sessionID)
      const boundaryIndex = canonical.findIndex((message) => message.id === boundary.messageID)
      if (boundaryIndex < 0) return yield* new HttpApiError.BadRequest({})
      const removedMessageIDs = canonical
        .slice(boundaryIndex + (boundary.contentIndex === undefined ? 0 : 1))
        .map((message) => message.id)
      yield* revertSvc.revert
        .stage({
          sessionID: current.id,
          messageID: boundary.messageID,
          partID: boundary.partID,
          contentIndex: boundary.contentIndex,
          removedMessageIDs,
        })
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Session.MessageNotFoundError", () => Effect.void),
          Effect.catchTag("Snapshot.Error", () =>
            Effect.fail(new ApiNotFoundError({ name: "NotFoundError", data: { message: "Snapshot failed" } })),
          ),
        )
      return yield* requireSession(ctx.params.sessionID)
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* revertSvc.revert
        .clear(SessionV2.ID.make(ctx.params.sessionID))
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Snapshot.Error", () =>
            Effect.fail(new ApiNotFoundError({ name: "NotFoundError", data: { message: "Snapshot failed" } })),
          ),
        )
      return yield* requireSession(ctx.params.sessionID)
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV2.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* location(
        Effect.gen(function* () {
          const permission = yield* PermissionV2.Service
          yield* permission.reply({
            requestID: ctx.params.permissionID,
            reply: ctx.payload.response,
          })
        }),
      ).pipe(
        Effect.catchTag("PermissionV2.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* revertSvc.transcript
        .removeMessage({
          sessionID: SessionV2.ID.make(ctx.params.sessionID),
          messageID: SessionMessage.ID.make(ctx.params.messageID),
        })
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Session.MessageNotFoundError", () =>
            Effect.fail(
              new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Message not found: ${ctx.params.messageID}` },
              }),
            ),
          ),
        )
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      const current = yield* revertSvc.get(SessionV2.ID.make(ctx.params.sessionID)).pipe(SessionError.mapSessionNotFound)
      const message = yield* revertSvc.message({
        sessionID: current.id,
        messageID: SessionMessage.ID.make(ctx.params.messageID),
      })
      if (!message) return yield* new HttpApiError.BadRequest({})
      const content = MessageV2.resolveTranscriptContent(current, [message], ctx.params)
      if (content.status !== "resolved") return yield* new HttpApiError.BadRequest({})
      if (content.kind === "user") {
        yield* revertSvc.transcript
          .removeUserText({
            sessionID: current.id,
            messageID: content.message.id,
            partID: ctx.params.partID,
          })
          .pipe(
            SessionError.mapSessionNotFound,
            Effect.catchTag("Session.MessageNotFoundError", () => Effect.fail(new HttpApiError.BadRequest({}))),
          )
        return true
      }
      if (!content.isLast) return yield* new HttpApiError.BadRequest({})
      yield* revertSvc.transcript
        .removeContent({
          sessionID: current.id,
          assistantMessageID: content.message.id,
          contentIndex: content.contentIndex,
          partID: ctx.params.partID,
        })
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Session.MessageNotFoundError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof SessionV1.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as SessionV1.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      const current = yield* revertSvc.get(SessionV2.ID.make(ctx.params.sessionID)).pipe(SessionError.mapSessionNotFound)
      const message = yield* revertSvc.message({
        sessionID: current.id,
        messageID: SessionMessage.ID.make(ctx.params.messageID),
      })
      if (!message) return yield* new HttpApiError.BadRequest({})
      const content = MessageV2.resolveTranscriptContent(current, [message], ctx.params)
      if (
        content.status !== "resolved" ||
        (payload.type !== "text" && payload.type !== "reasoning") ||
        content.part.type !== payload.type
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      if (content.kind === "user") {
        if (payload.type !== "text") return yield* new HttpApiError.BadRequest({})
        yield* revertSvc.transcript
          .updateUserText({
            sessionID: current.id,
            messageID: content.message.id,
            partID: ctx.params.partID,
            text: payload.text,
          })
          .pipe(
            SessionError.mapSessionNotFound,
            Effect.catchTag("Session.MessageNotFoundError", () => Effect.fail(new HttpApiError.BadRequest({}))),
          )
        return payload
      }
      if (content.content.type !== payload.type) return yield* new HttpApiError.BadRequest({})
      yield* revertSvc.transcript
        .updateContent({
          sessionID: current.id,
          assistantMessageID: content.message.id,
          contentIndex: content.contentIndex,
          partID: ctx.params.partID,
          content: { ...content.content, text: payload.text },
        })
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Session.MessageNotFoundError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      return payload
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
