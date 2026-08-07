import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
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
import { PermissionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

type CanonicalSelection = {
  agent?: string
  model?: {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    protocol?: ModelV2.Protocol
  }
  variant?: string
  tools?: Record<string, boolean>
}

const requiresLegacyPrompt = (input: typeof PromptPayload.Type) => {
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

const requiresLegacyCommand = (input: typeof CommandPayload.Type) =>
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
    const session = yield* Session.Service
    const sessionV2 = yield* SessionV2.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope

    const resumeCanonical = (legacyID: SessionID, canonicalID: SessionV2.ID) =>
      statusSvc
        .set(legacyID, { type: "busy" })
        .pipe(Effect.andThen(sessionV2.resume(canonicalID)), Effect.ensuring(statusSvc.set(legacyID, { type: "idle" })))

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const requireCanonicalSession = Effect.fn("SessionHttpApi.requireCanonicalSession")(function* (
      sessionID: SessionID,
    ) {
      return yield* SessionError.mapSessionNotFound(sessionV2.get(SessionV2.ID.make(sessionID)))
    })

    const cleanupRevert = Effect.fn("SessionHttpApi.cleanupRevert")(function* (legacy: Session.Info) {
      if (!legacy.revert) return
      const sessionID = SessionV2.ID.make(legacy.id)
      const messageID = SessionMessage.ID.make(legacy.revert.messageID)
      const boundary = yield* sessionV2.message({ sessionID, messageID })
      if (boundary) yield* sessionV2.revert.commit(sessionID).pipe(SessionError.mapSessionNotFound)
      yield* revertSvc.cleanup(legacy)
    })

    const selectCanonical = Effect.fn("SessionHttpApi.selectCanonical")(function* (
      sessionID: SessionID,
      input: CanonicalSelection,
    ) {
      let current = yield* requireCanonicalSession(sessionID)
      const selectedAgent = input.agent === undefined ? undefined : yield* agentSvc.get(input.agent)
      if (input.agent !== undefined && !selectedAgent) return yield* new HttpApiError.BadRequest({})

      if (input.agent !== undefined && current.agent !== input.agent) {
        yield* SessionError.mapSessionNotFound(
          sessionV2.switchAgent({
            sessionID: current.id,
            agent: input.agent,
          }),
        )
        current = yield* requireCanonicalSession(sessionID)
      }

      const requestedModel = input.model ?? selectedAgent?.model
      const selectedVariant = input.variant ?? (input.model === undefined ? selectedAgent?.variant : undefined)
      const baseModel =
        requestedModel ??
        (selectedVariant !== undefined && current.model
          ? {
              providerID: current.model.providerID,
              modelID: current.model.id,
              protocol: current.model.protocol,
            }
          : undefined)
      if (baseModel) {
        const protocol = "protocol" in baseModel ? baseModel.protocol : undefined
        yield* SessionError.mapSessionNotFound(
          sessionV2.switchModel({
            sessionID: current.id,
            model: {
              providerID: baseModel.providerID,
              id: baseModel.modelID,
              variant: selectedVariant === undefined ? undefined : ModelV2.VariantID.make(selectedVariant),
              protocol,
            },
          }),
        )
        current = yield* requireCanonicalSession(sessionID)
      }

      const permissions: PermissionV1.Rule[] = []
      for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: tool, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        yield* session.setPermission({ sessionID, permission: permissions })
        current = yield* requireCanonicalSession(sessionID)
      }

      return current
    })

    const legacyHistory = Effect.fn("SessionHttpApi.legacyHistory")(function* (sessionID: SessionID) {
      const current = yield* requireCanonicalSession(sessionID)
      const canonical = yield* sessionV2
        .messages({
          sessionID: current.id,
          order: "asc",
        })
        .pipe(Effect.catchTag("Session.MessageDecodeError", Effect.die), SessionError.mapSessionNotFound)
      const legacy = yield* SessionError.mapStorageNotFound(session.messages({ sessionID }))
      const merged = new Map(legacy.map((message) => [message.info.id, message]))
      for (const message of MessageV2.toLegacy(current, canonical)) merged.set(message.info.id, message)
      return Array.from(merged.values()).sort((left, right) => left.info.time.created - right.info.time.created)
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
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
      yield* requireSession(ctx.params.sessionID)
      const history = yield* legacyHistory(ctx.params.sessionID)
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
      yield* requireSession(ctx.params.sessionID)
      const found = (yield* legacyHistory(ctx.params.sessionID)).find(
        (message) => message.info.id === ctx.params.messageID,
      )
      if (found) return found
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
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

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.metadata !== undefined) {
        yield* session.setMetadata({ sessionID: ctx.params.sessionID, metadata: ctx.payload.metadata })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload?.messageID,
        }),
      )
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
      yield* sessionV2.interrupt(SessionV2.ID.make(sessionID))
      // Cancellation must reach durable TaskSubmission ownership even when the
      // parent session is idle after returning a background task handle.
      yield* runState.cancel(sessionID)
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* cleanupRevert(legacySession)
      const current = yield* requireCanonicalSession(ctx.params.sessionID)
      yield* sessionV2
        .command({
          id: SessionMessage.ID.make(ctx.payload.messageID),
          sessionID: current.id,
          command: Command.Default.INIT,
          arguments: "",
          model: {
            providerID: ctx.payload.providerID,
            id: ctx.payload.modelID,
          },
          resume: false,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      yield* session.touch(ctx.params.sessionID)
      yield* resumeCanonical(ctx.params.sessionID, current.id).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
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
      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* cleanupRevert(legacySession)
      const history = yield* legacyHistory(ctx.params.sessionID)
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = history.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent
      const current = yield* selectCanonical(ctx.params.sessionID, {
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
      })

      yield* sessionV2
        .compact({
          sessionID: current.id,
          reason: ctx.payload.auto === true ? "auto" : "manual",
        })
        .pipe(SessionError.mapSessionNotFound, SessionError.mapExecutionBusy)
      return true
    })

    const runCanonicalPrompt = Effect.fn("SessionHttpApi.runCanonicalPrompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* cleanupRevert(legacySession)
      let current = yield* selectCanonical(ctx.params.sessionID, {
        agent: ctx.payload.agent,
        model: ctx.payload.model,
        variant: ctx.payload.variant,
        tools: ctx.payload.tools,
      })
      const admitted = yield* sessionV2
        .prompt({
          id: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          sessionID: current.id,
          prompt: toCanonicalPrompt(ctx.payload),
          model: ctx.payload.model
            ? {
                id: ctx.payload.model.modelID,
                providerID: ctx.payload.model.providerID,
                variant:
                  ctx.payload.variant === undefined ? undefined : ModelV2.VariantID.make(ctx.payload.variant),
                protocol: ctx.payload.model.protocol,
              }
            : undefined,
          resume: false,
          commit: ctx.payload.noReply === true,
        })
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Session.PromptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
          Effect.catchTag("Session.ActiveAttemptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      yield* session.touch(ctx.params.sessionID)

      if (ctx.payload.noReply === true) {
        current = yield* requireCanonicalSession(ctx.params.sessionID)
        const user = SessionMessage.User.make({
          id: admitted.id,
          type: "user",
          text: admitted.prompt.text,
          files: admitted.prompt.files,
          agents: admitted.prompt.agents,
          system: admitted.prompt.system,
          tools: admitted.prompt.tools,
          format: admitted.prompt.format,
          time: { created: admitted.timeCreated },
        })
        const projected = MessageV2.toLegacy(current, [user])[0]
        if (!projected) return yield* Effect.die("Admitted prompt did not project to a legacy user message")
        return projected
      }

      yield* resumeCanonical(ctx.params.sessionID, current.id).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const history = yield* legacyHistory(ctx.params.sessionID)
      const userID = MessageID.ascending(admitted.id)
      const userIndex = history.findIndex((message) => message.info.id === userID)
      const response = history.findLast(
        (message, index) => index > userIndex && message.info.role === "assistant" && message.info.parentID === userID,
      )
      if (!response) return yield* new HttpApiError.BadRequest({})
      return response
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      const message = requiresLegacyPrompt(ctx.payload)
        ? yield* promptSvc
            .prompt({
              ...ctx.payload,
              sessionID: ctx.params.sessionID,
            })
            .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
        : yield* runCanonicalPrompt(ctx)
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      if (requiresLegacyPrompt(ctx.payload)) {
        yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
              yield* events.publish(Session.Event.Error, {
                sessionID: ctx.params.sessionID,
                error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
              })
            }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
        return HttpApiSchema.NoContent.make()
      }

      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* cleanupRevert(legacySession)
      const current = yield* selectCanonical(ctx.params.sessionID, {
        agent: ctx.payload.agent,
        model: ctx.payload.model,
        variant: ctx.payload.variant,
        tools: ctx.payload.tools,
      })
      yield* sessionV2
        .prompt({
          id: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          sessionID: current.id,
          prompt: toCanonicalPrompt(ctx.payload),
          resume: false,
          commit: ctx.payload.noReply === true,
        })
        .pipe(
          SessionError.mapSessionNotFound,
          Effect.catchTag("Session.PromptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
          Effect.catchTag("Session.ActiveAttemptConflictError", () => Effect.fail(new HttpApiError.BadRequest({}))),
        )
      yield* session.touch(ctx.params.sessionID)
      if (ctx.payload.noReply !== true) {
        yield* resumeCanonical(ctx.params.sessionID, current.id).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
              yield* events.publish(Session.Event.Error, {
                sessionID: ctx.params.sessionID,
                error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
              })
            }),
          ),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      }
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      if (requiresLegacyCommand(ctx.payload)) {
        return yield* promptSvc
          .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
          .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      }

      yield* cleanupRevert(legacySession)
      const current = yield* requireCanonicalSession(ctx.params.sessionID)
      const model = ctx.payload.model
        ? (() => {
            const [providerID, ...modelID] = ctx.payload.model.split("/")
            return {
              providerID: ProviderV2.ID.make(providerID),
              id: ModelV2.ID.make(modelID.join("/")),
            }
          })()
        : undefined
      const admitted = yield* sessionV2
        .command({
          id: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          sessionID: current.id,
          command: ctx.payload.command,
          arguments: ctx.payload.arguments,
          agent: ctx.payload.agent === undefined ? undefined : AgentV2.ID.make(ctx.payload.agent),
          model,
          variant: ctx.payload.variant ? ModelV2.VariantID.make(ctx.payload.variant) : undefined,
          files: ctx.payload.parts?.map(toCanonicalFile),
          resume: false,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      yield* session.touch(ctx.params.sessionID)
      yield* resumeCanonical(ctx.params.sessionID, current.id).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )

      const history = yield* legacyHistory(ctx.params.sessionID)
      const userID = MessageID.ascending(admitted.id)
      const userIndex = history.findIndex((message) => message.info.id === userID)
      const response = history.findLast(
        (message, index) => index > userIndex && message.info.role === "assistant" && message.info.parentID === userID,
      )
      if (!response) return yield* new HttpApiError.BadRequest({})
      return response
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      const legacySession = yield* requireSession(ctx.params.sessionID)
      yield* cleanupRevert(legacySession)
      let current = yield* selectCanonical(ctx.params.sessionID, {
        agent: ctx.payload.agent,
        model: ctx.payload.model,
      })
      yield* sessionV2
        .shell({
          userID: ctx.payload.messageID ? SessionMessage.ID.make(ctx.payload.messageID) : undefined,
          sessionID: current.id,
          command: ctx.payload.command,
          resume: false,
        })
        .pipe(SessionError.mapSessionNotFound, SessionError.mapExecutionBusy)
      current = yield* requireCanonicalSession(ctx.params.sessionID)
      const canonical = yield* sessionV2
        .messages({
          sessionID: current.id,
          order: "desc",
        })
        .pipe(Effect.catchTag("Session.MessageDecodeError", Effect.die), SessionError.mapSessionNotFound)
      const message = canonical.find((message) => message.type === "shell")
      if (!message) return yield* Effect.die("Completed shell command did not project a canonical message")
      const projected = MessageV2.toLegacy(current, [message]).at(-1)
      if (!projected) return yield* Effect.die("Canonical shell message did not project to a legacy response")
      return projected
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV1.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* Permission.replyCompatible(permissionSvc, {
        requestID: ctx.params.permissionID,
        reply: ctx.payload.response,
      }).pipe(
        Effect.catchTag("Permission.NotFoundError", (error) =>
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
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
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
      return yield* session.updatePart(payload)
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
