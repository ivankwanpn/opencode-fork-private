export * as SessionCommand from "./command"

import path from "path"
import type { Part, UserMessage } from "@opencode-ai/sdk/v2/types"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { AgentV2 } from "../agent"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { InstallationVersion } from "../installation/version"
import { Location } from "../location"
import { ModelV2 } from "../model"
import { PluginRuntime } from "../plugin/runtime"
import { ProjectV2 } from "../project"
import { ProviderV2 } from "../provider"
import { ProjectTable } from "../project/sql"
import { WorkspaceV2 } from "../workspace"
import { SessionAttempt } from "./attempt"
import { SessionEvent } from "./event"
import { fromRow } from "./info"
import { SessionInput } from "./input"
import { SessionMessage } from "./message"
import { Prompt, dematerialize } from "./prompt"
import { SessionProjector } from "./projector"
import { SessionSchema } from "./schema"
import { SessionCancellationTable, SessionTable } from "./sql"
import { SessionTurn } from "./turn"
import { SessionV1 } from "../v1/session"
import { Slug } from "../util/slug"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class PromptConflictError extends Schema.TaggedErrorClass<PromptConflictError>()("Session.PromptConflictError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export class ActiveAttemptConflictError extends Schema.TaggedErrorClass<ActiveAttemptConflictError>()(
  "Session.ActiveAttemptConflictError",
  {
    sessionID: SessionSchema.ID,
    attemptID: EventV2.ID,
    expectedAttemptID: EventV2.ID,
  },
) {}

export const TurnConflictError = SessionTurn.ConflictError
export type TurnConflictError = SessionTurn.ConflictError

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("Session.Cancelled", {
  sessionID: SessionSchema.ID,
}) {}

export type CreateInput = {
  readonly id?: SessionSchema.ID
  readonly parentID?: SessionSchema.ID
  readonly title?: string
  readonly agent?: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly location: Location.Ref
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<SessionSchema.Info>
  readonly plan: (sessionID: SessionSchema.ID) => Effect.Effect<string, NotFoundError>
  readonly synthetic: (input: {
    sessionID: SessionSchema.ID
    text: string
    kind?: SessionMessage.SyntheticKind
  }) => Effect.Effect<void, NotFoundError>
  readonly admitSynthetic: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    text: string
    description: string
    delivery?: SessionInput.Delivery
  }) => Effect.Effect<SessionInput.Admitted, NotFoundError | PromptConflictError | Cancelled>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, NotFoundError>
  readonly switchModel: (input: {
    sessionID: SessionSchema.ID
    model: ModelV2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly admit: (input: {
    id?: SessionMessage.ID
    sessionID: SessionSchema.ID
    prompt: PromptInput.Prompt
    delivery?: SessionInput.Delivery
    intent?: SessionInput.Intent
    expectedActiveAttemptID?: EventV2.ID
    plugins?: PluginRuntime.Interface
    agent?: AgentV2.ID
    model?: ModelV2.Ref
    materialize?: (prompt: Prompt, activeAgent?: AgentV2.ID) => Effect.Effect<Prompt>
  }) =>
    Effect.Effect<
      SessionInput.Admitted,
      NotFoundError | PromptConflictError | ActiveAttemptConflictError | TurnConflictError
    >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionCommand") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const global = yield* Global.Service
    const projects = yield* ProjectV2.Service

    const get = Effect.fn("SessionCommand.get")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const requireSession = Effect.fn("SessionCommand.requireSession")(function* (sessionID: SessionSchema.ID) {
      const session = yield* get(sessionID)
      if (!session) return yield* new NotFoundError({ sessionID })
      return session
    })

    const isCancelled = Effect.fn("SessionCommand.isCancelled")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .all<{ root_session_id: string }>(
          sql`
          WITH RECURSIVE ancestors(id) AS (
            SELECT ${sessionID}
            UNION ALL
            SELECT session.parent_id
            FROM session
            JOIN ancestors ON session.id = ancestors.id
            WHERE session.parent_id IS NOT NULL
          )
          SELECT cancellation.root_session_id
          FROM ${SessionCancellationTable} cancellation
          JOIN ancestors ON ancestors.id = cancellation.root_session_id
          LIMIT 1
        `,
        )
        .pipe(Effect.orDie)
      return rows.length > 0
    })

    const admitSynthetic: Interface["admitSynthetic"] = Effect.fn("SessionCommand.admitSynthetic")((input) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          yield* requireSession(input.sessionID)
          if (yield* isCancelled(input.sessionID)) return yield* new Cancelled({ sessionID: input.sessionID })
          const messageID = input.id ?? SessionMessage.ID.create()
          const prompt = Prompt.make({ text: input.text })
          const delivery = input.delivery ?? "steer"
          const synthetic = SessionInput.Synthetic.make({ description: input.description })
          const expected = { sessionID: input.sessionID, prompt, synthetic, delivery }
          const existing = yield* SessionInput.find(db, messageID)
          if (existing) {
            if (!SessionInput.equivalent(existing, expected))
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            return existing
          }
          const commit: () => Effect.Effect<void> = () =>
            isCancelled(input.sessionID).pipe(
              Effect.flatMap((cancelled) =>
                cancelled ? Effect.die(new Cancelled({ sessionID: input.sessionID })) : Effect.void,
              ),
            )
          const recoverAdmissionDefect = (
            defect: unknown,
          ): Effect.Effect<never, Cancelled | PromptConflictError> => {
            if (defect instanceof Cancelled) return Effect.fail(defect)
            if (defect instanceof SessionInput.LifecycleConflict)
              return Effect.fail(new PromptConflictError({ sessionID: input.sessionID, messageID }))
            return Effect.die(defect)
          }
          const admitted = yield* SessionInput.admit(db, events, {
            id: messageID,
            ...expected,
            commit,
          }).pipe(Effect.catchDefect(recoverAdmissionDefect))
          if (!SessionInput.equivalent(admitted, expected))
            return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
          return admitted
        }),
      ),
    )

    return Service.of({
      create: Effect.fn("SessionCommand.create")(function* (input) {
        const sessionID = input.id ?? SessionSchema.ID.create()
        const recorded = yield* get(sessionID)
        if (recorded) return recorded
        const project = yield* projects.resolve(input.location.directory)
        yield* db
          .insert(ProjectTable)
          .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        const info = SessionV1.SessionInfo.make({
          id: sessionID,
          parentID: input.parentID,
          slug: Slug.create(),
          version: InstallationVersion,
          projectID: project.id,
          directory: input.location.directory,
          path: path.relative(project.directory, input.location.directory).replaceAll("\\", "/"),
          workspaceID: input.location.workspaceID ? WorkspaceV2.ID.make(input.location.workspaceID) : undefined,
          title: input.title ?? `New session - ${new Date(now).toISOString()}`,
          agent: input.agent,
          model: input.model
            ? {
                id: ModelV2.ID.make(input.model.id),
                providerID: input.model.providerID,
                variant: input.model.variant,
                protocol: input.model.protocol,
              }
            : undefined,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
        })
        yield* events
          .publish(SessionV1.Event.Created, { sessionID, info }, { location: input.location })
          .pipe(
            Effect.catchDefect((defect) =>
              defect instanceof SessionProjector.SessionAlreadyProjected ? Effect.void : Effect.die(defect),
            ),
          )
        const created = yield* get(sessionID)
        if (!created) return yield* Effect.die(`Created Session was not projected: ${sessionID}`)
        return created
      }),
      plan: Effect.fn("SessionCommand.plan")(function* (sessionID) {
        const row = yield* db
          .select({
            slug: SessionTable.slug,
            directory: SessionTable.directory,
            created: SessionTable.time_created,
            vcs: ProjectTable.vcs,
          })
          .from(SessionTable)
          .innerJoin(ProjectTable, eq(SessionTable.project_id, ProjectTable.id))
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ sessionID })
        const base = row.vcs ? path.join(row.directory, ".opencode", "plans") : path.join(global.data, "plans")
        return path.join(base, `${row.created}-${row.slug}.md`)
      }),
      synthetic: Effect.fn("SessionCommand.synthetic")(function* (input) {
        yield* requireSession(input.sessionID)
        yield* events.publish(SessionEvent.Synthetic, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          text: input.text,
          kind: input.kind,
        })
      }),
      admitSynthetic,
      switchAgent: Effect.fn("SessionCommand.switchAgent")(function* (input) {
        yield* requireSession(input.sessionID)
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          agent: input.agent,
        })
      }),
      switchModel: Effect.fn("SessionCommand.switchModel")(function* (input) {
        const session = yield* requireSession(input.sessionID)
        if (
          session.model?.providerID === input.model.providerID &&
          session.model.id === input.model.id &&
          (session.model.variant ?? "default") === (input.model.variant ?? "default") &&
          session.model.protocol === input.model.protocol
        )
          return
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: yield* DateTime.now,
          model: input.model,
        })
      }),
      admit: Effect.fn("SessionCommand.admit")((input) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const session = yield* requireSession(input.sessionID)
            const messageID = input.id ?? SessionMessage.ID.create()
            const initialPrompt = resolvePrompt(input.prompt)
            const projected = projectPrompt({
              session,
              messageID,
              prompt: initialPrompt,
              agent: input.agent,
              model: input.model,
            })
            const message = PluginRuntime.mutable(projected.message)
            const parts = PluginRuntime.mutable<readonly Part[]>(projected.parts)

            if (input.plugins) {
              yield* input.plugins.run(PluginRuntime.HookName.sessionMessageBefore, {
                sessionID: session.id,
                agent: session.agent,
                model: session.model && {
                  providerID: session.model.providerID,
                  modelID: session.model.id,
                  ...(session.model.variant === undefined || session.model.variant === "default"
                    ? {}
                    : { variant: session.model.variant }),
                },
                messageID,
                message: message.value,
                parts: parts.value,
              })
            }

            const transformedMessage = message.get()
            if (transformedMessage.id !== messageID || transformedMessage.sessionID !== session.id)
              return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            const unresolved = restorePrompt(initialPrompt, messageID, transformedMessage, parts.get())
            const delivery = input.intent?.type === "queue" ? "queue" : input.intent ? "steer" : (input.delivery ?? "steer")
            const existing = yield* SessionInput.find(db, messageID)
            let admitted: SessionInput.Admitted
            if (existing) {
              if (
                existing.sessionID !== input.sessionID ||
                existing.delivery !== delivery ||
                existing.synthetic !== undefined ||
                !SessionInput.samePrompt(dematerialize(existing.prompt), unresolved) ||
                JSON.stringify(existing.intent) !== JSON.stringify(input.intent)
              )
                return yield* new PromptConflictError({
                  sessionID: input.sessionID,
                  messageID,
                })
              admitted = existing
            } else {
              const prompt = input.materialize
                ? yield* input.materialize(
                    unresolved,
                    transformedMessage.agent ? AgentV2.ID.make(transformedMessage.agent) : undefined,
                  )
                : unresolved
              const expected = {
                sessionID: input.sessionID,
                messageID,
                prompt,
                delivery,
                intent: input.intent,
              }
              const expectedActiveAttemptID = input.expectedActiveAttemptID
              const commit = expectedActiveAttemptID
                ? (seq: number) =>
                    SessionAttempt.get(db, input.sessionID).pipe(
                      Effect.flatMap((row) =>
                        row?.attempt_id === expectedActiveAttemptID &&
                        (row.status === "started" || row.status === "responding")
                          ? Effect.void
                          : Effect.die(
                              new ActiveAttemptConflictError({
                                sessionID: input.sessionID,
                                attemptID: row?.attempt_id ?? EventV2.ID.make(""),
                                expectedAttemptID: expectedActiveAttemptID,
                              }),
                            ),
                      ),
                    )
                : undefined
              admitted = yield* SessionInput.admit(db, events, {
                id: messageID,
                sessionID: input.sessionID,
                prompt,
                delivery,
                intent: input.intent,
                expectedActiveAttemptID,
                commit,
              }).pipe(
                Effect.catchDefect(
                  (
                    defect,
                  ): Effect.Effect<never, ActiveAttemptConflictError | PromptConflictError | TurnConflictError> =>
                    defect instanceof ActiveAttemptConflictError
                      ? Effect.fail(defect)
                      : defect instanceof SessionTurn.ConflictError
                        ? Effect.fail(defect)
                      : defect instanceof SessionInput.LifecycleConflict
                        ? Effect.fail(new PromptConflictError({ sessionID: input.sessionID, messageID }))
                        : Effect.die(defect),
                ),
              )
              if (!SessionInput.equivalent(admitted, expected))
                return yield* new PromptConflictError({ sessionID: input.sessionID, messageID })
            }

            const current = yield* requireSession(input.sessionID)
            if (transformedMessage.agent && transformedMessage.agent !== current.agent) {
              yield* events.publish(SessionEvent.AgentSwitched, {
                sessionID: input.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                agent: transformedMessage.agent,
              })
            }
            const transformedModel = transformedMessage.model
            if (
              transformedModel.providerID &&
              transformedModel.modelID &&
              (current.model?.providerID !== transformedModel.providerID ||
                current.model.id !== transformedModel.modelID ||
                (current.model.variant === "default" ? undefined : current.model.variant) !==
                  transformedModel.variant ||
                current.model.protocol !== transformedModel.protocol)
            ) {
              yield* events.publish(SessionEvent.ModelSwitched, {
                sessionID: input.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: yield* DateTime.now,
                model: {
                  providerID: ProviderV2.ID.make(transformedModel.providerID),
                  id: ModelV2.ID.make(transformedModel.modelID),
                  variant:
                    transformedModel.variant === undefined
                      ? undefined
                      : ModelV2.VariantID.make(transformedModel.variant),
                  protocol: transformedModel.protocol,
                },
              })
            }
            return admitted
          }),
        ),
      ),
    })
  }),
)

const partID = (messageID: SessionMessage.ID, type: "text" | "file" | "agent", index: number) =>
  `prt_${messageID}_${type}_${index}`

export const projectPrompt = (input: {
  readonly session: SessionSchema.Info
  readonly messageID: SessionMessage.ID
  readonly prompt: Prompt
  readonly agent?: AgentV2.ID
  readonly model?: ModelV2.Ref
}) => {
  const currentModel = input.model ?? input.session.model
  const model: UserMessage["model"] = currentModel
    ? {
        providerID: currentModel.providerID,
        modelID: currentModel.id,
        ...(currentModel.variant === undefined || currentModel.variant === "default"
          ? {}
          : { variant: currentModel.variant }),
        ...(currentModel.protocol === undefined ? {} : { protocol: currentModel.protocol }),
      }
    : { providerID: "", modelID: "" }
  const message: UserMessage = {
    id: input.messageID,
    sessionID: input.session.id,
    role: "user",
    time: { created: Date.now() },
    agent: input.agent ?? input.session.agent ?? "",
    model,
    system: input.prompt.system,
    tools: input.prompt.tools,
    format: input.prompt.format,
  }
  const parts: Part[] = [
    ...(input.prompt.context ?? []).map(
      (context, index): Part => ({
        id: partID(input.messageID, "text", index + 1),
        sessionID: input.session.id,
        messageID: input.messageID,
        type: "text",
        text: context.text,
        synthetic: true,
        metadata: context.metadata,
      }),
    ),
    {
      id: partID(input.messageID, "text", 0),
      sessionID: input.session.id,
      messageID: input.messageID,
      type: "text",
      text: input.prompt.text,
    },
    ...(input.prompt.files ?? []).map(
      (file, index): Part => ({
        id: partID(input.messageID, "file", index),
        sessionID: input.session.id,
        messageID: input.messageID,
        type: "file",
        mime: file.mime,
        filename: file.name,
        url: file.uri,
        source:
          file.resource && file.source
            ? {
                type: "resource",
                clientName: file.resource.clientName,
                uri: file.resource.uri,
                text: {
                  value: file.source.text,
                  start: file.source.start,
                  end: file.source.end,
                },
              }
            : file.source
              ? {
                  type: "file",
                  path: file.name ?? file.uri,
                  text: {
                    value: file.source.text,
                    start: file.source.start,
                    end: file.source.end,
                  },
                }
              : undefined,
      }),
    ),
    ...(input.prompt.agents ?? []).map(
      (agent, index): Part => ({
        id: partID(input.messageID, "agent", index),
        sessionID: input.session.id,
        messageID: input.messageID,
        type: "agent",
        name: agent.name,
        source: agent.source && {
          value: agent.source.text,
          start: agent.source.start,
          end: agent.source.end,
        },
      }),
    ),
  ]
  return { message, parts }
}

export const restorePrompt = (
  initial: Prompt,
  messageID: SessionMessage.ID,
  message: UserMessage,
  parts: readonly Part[],
) => {
  const unsupported = parts.find((part) => part.type !== "text" && part.type !== "file" && part.type !== "agent")
  if (unsupported) throw new TypeError(`Unsupported part from session.message.before: ${unsupported.type}`)
  const originalFiles = new Map((initial.files ?? []).map((file, index) => [partID(messageID, "file", index), file]))
  const contextIDs = new Map(
    (initial.context ?? []).map((context, index) => [partID(messageID, "text", index + 1), context]),
  )
  const text = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !contextIDs.has(part.id))
    .map((part) => part.text)
    .join("")
  const context = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && contextIDs.has(part.id))
    .map((part) => ({ text: part.text, metadata: part.metadata ?? contextIDs.get(part.id)?.metadata }))
  const files = parts
    .filter((part) => part.type === "file")
    .map((part) => {
      const original = originalFiles.get(part.id)
      const resource =
        part.source?.type === "resource"
          ? {
              clientName: part.source.clientName,
              uri: part.source.uri,
            }
          : original?.resource && original.source
            ? undefined
            : original?.resource
      const unchanged =
        original !== undefined &&
        original.uri === part.url &&
        original.mime === part.mime &&
        original.name === part.filename &&
        JSON.stringify(original.resource) === JSON.stringify(resource)
      return {
        uri: part.url,
        mime: part.mime,
        name: part.filename,
        description: original?.description,
        resource,
        materialized: unchanged ? original.materialized : undefined,
        source: part.source && {
          text: part.source.text.value,
          start: part.source.text.start,
          end: part.source.text.end,
        },
      }
    })
  const agents = parts
    .filter((part) => part.type === "agent")
    .map((part) => ({
      name: part.name,
      source: part.source && {
        text: part.source.value,
        start: part.source.start,
        end: part.source.end,
      },
    }))
  return Prompt.make({
    text,
    ...(context.length === 0 ? {} : { context }),
    ...(files.length === 0 ? {} : { files }),
    ...(agents.length === 0 ? {} : { agents }),
    ...(message.system === undefined ? {} : { system: message.system }),
    ...(message.tools === undefined ? {} : { tools: message.tools }),
    ...(message.format === undefined ? {} : { format: message.format }),
  })
}

export const resolvePrompt = (input: PromptInput.Prompt) =>
  Prompt.make({
    text: input.text,
    context: input.context,
    agents: input.agents,
    system: input.system,
    tools: input.tools,
    format: input.format,
    files: input.files?.map((file) => {
      const dataMime = file.uri.match(/^data:([^;,]+)[;,]/i)?.[1]
      const target = URL.canParse(file.uri) ? new URL(file.uri).pathname : (file.name ?? file.uri)
      return {
        ...file,
        mime: file.mime ?? dataMime ?? (target.endsWith("/") ? "application/x-directory" : FSUtil.mimeType(target)),
      }
    }),
  })

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, Global.node, ProjectV2.node, SessionProjector.node],
})
