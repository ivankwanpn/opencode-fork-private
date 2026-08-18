import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { EventV2Bridge } from "@/event-v2-bridge"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ModelV2 } from "@opencode-ai/core/model"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { NamedError } from "@opencode-ai/core/util/error"
import { PromptInput } from "@opencode-ai/schema/prompt-input"
import { SessionV1 } from "@opencode-ai/schema/session-v1"
import { Cause, Context, Effect, Layer, Schema, Scope } from "effect"
import { MessageV2 } from "./message-v2"
import { LegacySessionRead } from "./legacy-session-read"
import { SessionRunState } from "./run-state"
import { MessageID, SessionID } from "./schema"
import { SessionStatus } from "./status"

type InputSession = {
  readonly id: SessionID
  readonly revert?: { readonly messageID: MessageID }
}

export type Selection = {
  readonly agent?: string
  readonly model?: {
    readonly providerID: ProviderV2.ID
    readonly modelID: ModelV2.ID
    readonly protocol?: ModelV2.Protocol
  }
  readonly variant?: string
  readonly tools?: Readonly<Record<string, boolean>>
}

export type InitInput = {
  readonly session: InputSession
  readonly messageID: SessionMessage.ID
  readonly providerID: ProviderV2.ID
  readonly modelID: ModelV2.ID
}

export type PromptExecutionInput = {
  readonly session: InputSession
  readonly id?: SessionMessage.ID
  readonly prompt: PromptInput.Prompt
  readonly selection: Selection
  readonly noReply?: boolean
}

export type CommandExecutionInput = {
  readonly session: InputSession
  readonly id?: SessionMessage.ID
  readonly command: string
  readonly arguments: string
  readonly agent?: AgentV2.ID
  readonly model?: ModelV2.Ref
  readonly variant?: ModelV2.VariantID
  readonly files?: readonly PromptInput.FileAttachment[]
}

export type ShellExecutionInput = {
  readonly session: InputSession
  readonly userID?: SessionMessage.ID
  readonly command: string
  readonly selection: Selection
}

export class InvalidSelectionError extends Schema.TaggedErrorClass<InvalidSelectionError>()(
  "LegacySessionExecution.InvalidSelectionError",
  { agent: Schema.String },
) {}

export class ResponseNotFoundError extends Schema.TaggedErrorClass<ResponseNotFoundError>()(
  "LegacySessionExecution.ResponseNotFoundError",
  { sessionID: SessionID, messageID: MessageID },
) {}

const make = Effect.gen(function* () {
  const agent = yield* Agent.Service
  const events = yield* EventV2Bridge.Service
  const read = yield* LegacySessionRead.Service
  const runState = yield* SessionRunState.Service
  const canonical = yield* SessionV2.Service
  const status = yield* SessionStatus.Service
  const scope = yield* Scope.Scope

  const cleanupRevert = Effect.fn("LegacySessionExecution.cleanupRevert")(function* (session: InputSession) {
    if (!session.revert) return
    const sessionID = SessionV2.ID.make(session.id)
    const boundary = yield* canonical.message({
      sessionID,
      messageID: SessionMessage.ID.make(session.revert.messageID),
    })
    if (boundary) yield* canonical.revert.commit(sessionID)
  })

  const resume = Effect.fn("LegacySessionExecution.resume")(function* (sessionID: SessionID) {
    yield* status.set(sessionID, { type: "busy" })
    yield* canonical.resume(SessionV2.ID.make(sessionID)).pipe(Effect.ensuring(status.set(sessionID, { type: "idle" })))
  })

  const select = Effect.fn("LegacySessionExecution.select")(function* (sessionID: SessionID, input: Selection) {
    const current = yield* read.get(sessionID)
    const selectedAgent = input.agent === undefined ? undefined : yield* agent.get(input.agent)
    if (input.agent !== undefined && !selectedAgent) return yield* new InvalidSelectionError({ agent: input.agent })

    const selected =
      input.agent !== undefined && current.agent !== input.agent
        ? yield* canonical
            .switchAgent({ sessionID: current.id, agent: input.agent })
            .pipe(Effect.andThen(read.get(sessionID)))
        : current
    const requestedModel = input.model ?? selectedAgent?.model
    const selectedVariant = input.variant ?? (input.model === undefined ? selectedAgent?.variant : undefined)
    const baseModel =
      requestedModel ??
      (selectedVariant !== undefined && selected.model
        ? {
            providerID: selected.model.providerID,
            modelID: selected.model.id,
            protocol: selected.model.protocol,
          }
        : undefined)
    const modeled = baseModel
      ? yield* canonical
          .switchModel({
            sessionID: selected.id,
            model: {
              providerID: baseModel.providerID,
              id: baseModel.modelID,
              variant: selectedVariant === undefined ? undefined : ModelV2.VariantID.make(selectedVariant),
              protocol: "protocol" in baseModel ? baseModel.protocol : undefined,
            },
          })
          .pipe(Effect.andThen(read.get(sessionID)))
      : selected
    const permissions: PermissionV2.Rule[] = Object.entries(input.tools ?? {}).map(([tool, enabled]) => ({
      action: tool,
      effect: enabled ? "allow" : "deny",
      resource: "*",
    }))
    if (permissions.length === 0) return modeled
    yield* canonical.setPermissions({ sessionID: SessionV2.ID.make(sessionID), permissions })
    return yield* read.get(sessionID)
  })

  const response = Effect.fn("LegacySessionExecution.response")(function* (
    sessionID: SessionID,
    inputID: SessionMessage.ID,
  ) {
    const history = yield* read.history(sessionID)
    const userID = MessageID.ascending(inputID)
    const userIndex = history.findIndex((message) => message.info.id === userID)
    const message = history.findLast(
      (message, index) => index > userIndex && message.info.role === "assistant" && message.info.parentID === userID,
    )
    if (message) return message
    return yield* new ResponseNotFoundError({ sessionID, messageID: userID })
  })

  const admitPrompt = Effect.fn("LegacySessionExecution.admitPrompt")(function* (input: PromptExecutionInput) {
    yield* cleanupRevert(input.session)
    const current = yield* select(input.session.id, input.selection)
    const admitted = yield* canonical.prompt({
      id: input.id,
      sessionID: current.id,
      prompt: input.prompt,
      model: input.selection.model
        ? {
            id: input.selection.model.modelID,
            providerID: input.selection.model.providerID,
            variant:
              input.selection.variant === undefined ? undefined : ModelV2.VariantID.make(input.selection.variant),
            protocol: input.selection.model.protocol,
          }
        : undefined,
      resume: false,
      commit: input.noReply === true,
    })
    yield* canonical.update({ sessionID: current.id }).pipe(Effect.orDie)
    return { admitted, current }
  })

  const abort = Effect.fn("LegacySessionExecution.abort")(function* (sessionID: SessionID) {
    yield* canonical.interrupt(SessionV2.ID.make(sessionID))
    // A parent can already be idle after returning a background task handle.
    yield* runState.cancel(sessionID)
  })

  const init = Effect.fn("LegacySessionExecution.init")(function* (input: InitInput) {
    yield* cleanupRevert(input.session)
    const current = yield* read.get(input.session.id)
    yield* canonical.command({
      id: input.messageID,
      sessionID: current.id,
      command: Command.Default.INIT,
      arguments: "",
      model: { providerID: input.providerID, id: input.modelID },
      resume: false,
    })
    yield* canonical.update({ sessionID: current.id }).pipe(Effect.orDie)
    yield* resume(input.session.id)
  })

  const prompt = Effect.fn("LegacySessionExecution.prompt")(function* (input: PromptExecutionInput) {
    const admitted = yield* admitPrompt(input)
    if (input.noReply === true) {
      const current = yield* read.get(input.session.id)
      const user = SessionMessage.User.make({
        id: admitted.admitted.id,
        type: "user",
        text: admitted.admitted.prompt.text,
        files: admitted.admitted.prompt.files,
        agents: admitted.admitted.prompt.agents,
        system: admitted.admitted.prompt.system,
        tools: admitted.admitted.prompt.tools,
        format: admitted.admitted.prompt.format,
        time: { created: admitted.admitted.timeCreated },
      })
      const projected = MessageV2.toLegacy(current, [user])[0]
      if (!projected) return yield* Effect.die("Admitted prompt did not project to a legacy user message")
      return projected
    }
    yield* resume(input.session.id)
    return yield* response(input.session.id, admitted.admitted.id)
  })

  const promptAsync = Effect.fn("LegacySessionExecution.promptAsync")(function* (input: PromptExecutionInput) {
    const admitted = yield* admitPrompt(input)
    if (input.noReply === true) return
    yield* resume(input.session.id).pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          yield* Effect.logError("prompt_async failed", { sessionID: input.session.id, cause })
          yield* events.publish(SessionV1.Event.Error, {
            sessionID: input.session.id,
            error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
          })
        }),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )
    return admitted.admitted
  })

  const command = Effect.fn("LegacySessionExecution.command")(function* (input: CommandExecutionInput) {
    yield* cleanupRevert(input.session)
    const current = yield* read.get(input.session.id)
    const admitted = yield* canonical.command({
      id: input.id,
      sessionID: current.id,
      command: input.command,
      arguments: input.arguments,
      agent: input.agent,
      model: input.model,
      variant: input.variant,
      files: input.files,
      resume: false,
    })
    yield* canonical.update({ sessionID: current.id }).pipe(Effect.orDie)
    yield* resume(input.session.id)
    return yield* response(input.session.id, admitted.id)
  })

  const shell = Effect.fn("LegacySessionExecution.shell")(function* (input: ShellExecutionInput) {
    yield* cleanupRevert(input.session)
    const current = yield* select(input.session.id, input.selection)
    yield* canonical.shell({
      userID: input.userID,
      sessionID: current.id,
      command: input.command,
      resume: false,
    })
    const selected = yield* read.get(input.session.id)
    const messages = yield* canonical
      .messages({ sessionID: selected.id, order: "desc" })
      .pipe(Effect.catchTag("Session.MessageDecodeError", Effect.die))
    const message = messages.find((message) => message.type === "shell")
    if (!message) return yield* Effect.die("Completed shell command did not project a canonical message")
    const projected = MessageV2.toLegacy(selected, [message]).at(-1)
    if (!projected) return yield* Effect.die("Canonical shell message did not project to a legacy response")
    return projected
  })

  return { abort, init, prompt, promptAsync, command, shell }
})

export type Interface = Effect.Success<typeof make>

export class Service extends Context.Service<Service, Interface>()("@opencode/LegacySessionExecution") {}

export const layer = Layer.effect(Service, make)

export * as LegacySessionExecution from "./legacy-session-execution"
