import { isMessageNotFoundError, OpenCode, type MessagesListOutput, type SessionsListOutput } from "@opencode-ai/client"
import {
  createOpencodeClient,
  type AssistantMessage,
  type Event,
  type Message,
  type OpencodeClient,
  type Part,
  type SessionMessageResponse,
  type ToolPart,
} from "@opencode-ai/sdk/v2"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Command } from "@/command"
import type { Provider } from "@/provider/provider"
import { legacyEventPayloads, legacyEventProjection } from "@/event-v2-bridge"
import { legacyAgentFromNative, legacyCommandFromNative, legacyProvidersFromNative } from "@/compat/native-v1-catalog"
import { legacySessionFromNative } from "@/compat/native-v1-session"
import { legacyTranscriptFromNative } from "@/compat/native-v1-transcript"
import type { PromptPart } from "./content"

export type SessionInfo = ReturnType<typeof legacySessionFromNative>
export type Transcript = ReturnType<typeof legacyTranscriptFromNative>
export type LegacyAssistantMessage = AssistantMessage
export type LegacyEvent = Event
export type LegacyMessage = Message
export type LegacyPart = Part
export type LegacySessionMessage = SessionMessageResponse
export type LegacyToolPart = ToolPart
export const CompletionCancelled = Symbol("ACPCompletionCancelled")
export type CompletionResponse = Omit<SessionMessageResponse, "info"> & {
  readonly info: AssistantMessage
}
export type CompletionResult = CompletionResponse | typeof CompletionCancelled
export type ModelSelection = {
  readonly providerID: string
  readonly modelID: string
}
export type CompletionInput = {
  readonly sessionID: string
  readonly model: ModelSelection
  readonly variant?: string
  readonly agent?: string
  readonly parts: readonly PromptPart[]
  readonly signal?: AbortSignal
}
export type CommandInput = CompletionInput & {
  readonly command: string
  readonly arguments: string
}
type CompletionSelection = Pick<CompletionInput, "sessionID" | "model" | "variant" | "agent">
export type McpConfig = NonNullable<NonNullable<Parameters<OpencodeClient["mcp"]["add"]>[0]>["config"]>
export type EventEnvelope = {
  readonly directory?: string
  readonly workspace?: string
  readonly payload: Event
}

export type Catalog = {
  readonly providers: Record<ProviderV2.ID, Provider.Info>
  readonly agents: ReadonlyArray<{
    readonly name: string
    readonly mode: "subagent" | "primary" | "all"
    readonly hidden?: boolean
    readonly description?: string
  }>
  readonly commands: readonly Command.Info[]
  readonly configuredModel?: string
}

export interface Interface {
  readonly session: {
    readonly create: (input: {
      readonly directory: string
      readonly agent?: string
      readonly model?: { readonly providerID: string; readonly modelID: string; readonly variant?: string }
    }) => Promise<SessionInfo>
    readonly get: (input: { readonly sessionID: string }) => Promise<SessionInfo>
    readonly list: (input: { readonly directory?: string }) => Promise<readonly SessionInfo[]>
    readonly messages: (input: { readonly sessionID: string; readonly limit?: number }) => Promise<Transcript>
    readonly message: (input: {
      readonly sessionID: string
      readonly messageID: string
    }) => Promise<SessionMessageResponse | undefined>
    readonly fork: (input: { readonly sessionID: string; readonly messageID?: string }) => Promise<SessionInfo>
    readonly interrupt: (input: { readonly sessionID: string }) => Promise<void>
    readonly prompt: (input: CompletionInput) => Promise<CompletionResult>
    readonly command: (input: CommandInput) => Promise<CompletionResult>
    readonly compact: (input: { readonly sessionID: string; readonly signal?: AbortSignal }) => Promise<void>
  }
  readonly events: {
    readonly subscribe: (input?: { readonly signal?: AbortSignal }) => AsyncIterable<EventEnvelope>
  }
  readonly permission: {
    readonly reply: (input: {
      readonly sessionID: string
      readonly requestID: string
      readonly reply: "once" | "always" | "reject"
    }) => Promise<void>
  }
  readonly catalog: {
    readonly load: (directory: string) => Promise<Catalog>
  }
  readonly config: {
    readonly get: (directory: string) => Promise<{ readonly model?: string }>
  }
  readonly mcp: {
    readonly add: (input: {
      readonly directory: string
      readonly name: string
      readonly config: McpConfig
    }) => Promise<void>
  }
}

type GeneratedClients = {
  readonly native: ReturnType<typeof OpenCode.make>
  readonly legacy: OpencodeClient
}

type ClientOptions = Parameters<typeof OpenCode.make>[0]

function generatedClients(options: ClientOptions): GeneratedClients {
  const fetch = options.fetch ?? globalThis.fetch
  const native = OpenCode.make({
    baseUrl: options.baseUrl,
    headers: options.headers,
    fetch,
  })
  const legacy = createOpencodeClient({
    baseUrl: options.baseUrl,
    headers: options.headers,
    fetch,
  })
  return { native, legacy }
}

function sessionLifecycle(
  native: GeneratedClients["native"],
  interrupts: Map<string, number>,
): Pick<Interface["session"], "create" | "get" | "list" | "messages" | "message" | "fork" | "interrupt"> {
  const location = (directory: string) => ({ directory })

  async function nativeMessages(sessionID: string, limit?: number) {
    const data: MessagesListOutput["data"][number][] = []
    let cursor: string | undefined
    while (limit === undefined || data.length < limit) {
      const page = await native.messages.list({
        sessionID,
        limit: Math.min(limit === undefined ? 100 : limit - data.length, 100),
        ...(cursor ? { cursor } : { order: "asc" }),
      })
      data.push(...page.data)
      const next = page.cursor.next ?? undefined
      if (!next || next === cursor) break
      cursor = next
    }
    return limit === undefined ? data : data.slice(0, limit)
  }

  const session: Pick<Interface["session"], "create" | "get" | "list" | "messages" | "message" | "fork" | "interrupt"> =
    {
      create: async (input: Parameters<Interface["session"]["create"]>[0]) =>
        legacySessionFromNative(
          await native.sessions.create({
            agent: input.agent,
            model: input.model
              ? {
                  providerID: input.model.providerID,
                  id: input.model.modelID,
                  ...(input.model.variant ? { variant: input.model.variant } : {}),
                }
              : undefined,
            location: location(input.directory),
          }),
        ),
      get: async (input: Parameters<Interface["session"]["get"]>[0]) =>
        legacySessionFromNative(await native.sessions.get(input)),
      list: async (input: Parameters<Interface["session"]["list"]>[0]) => {
        const data: SessionsListOutput["data"][number][] = []
        let cursor: string | undefined
        while (true) {
          const page = await native.sessions.list({
            directory: input.directory,
            order: "desc",
            limit: 100,
            ...(cursor ? { cursor } : {}),
          })
          data.push(...page.data)
          const next = page.cursor.next ?? undefined
          if (!next || next === cursor) break
          cursor = next
        }
        return data.map(legacySessionFromNative)
      },
      messages: async (input: Parameters<Interface["session"]["messages"]>[0]) =>
        legacyTranscriptFromNative({
          session: await native.sessions.get({ sessionID: input.sessionID }),
          messages: await nativeMessages(input.sessionID, input.limit),
        }),
      message: async (input: Parameters<Interface["session"]["message"]>[0]) => {
        const message = await native.sessions.message(input).catch((error) => {
          if (isMessageNotFoundError(error)) return undefined
          throw error
        })
        if (!message) return undefined
        const projected = await session.messages({ sessionID: input.sessionID })
        return projected.find((item) => item.info.id === message.id)
      },
      fork: async (input: Parameters<Interface["session"]["fork"]>[0]) =>
        legacySessionFromNative(await native.sessions.fork(input)),
      interrupt: async (input: Parameters<Interface["session"]["interrupt"]>[0]) => {
        const previous = interrupts.get(input.sessionID) ?? 0
        const next = previous + 1
        interrupts.set(input.sessionID, next)
        try {
          await native.sessions.interrupt(input)
        } catch (error) {
          if (interrupts.get(input.sessionID) === next) interrupts.set(input.sessionID, previous)
          throw error
        }
      },
    }

  return session
}

function sessionCompletion(
  native: GeneratedClients["native"],
  lifecycle: Pick<Interface["session"], "messages">,
  interrupts: Map<string, number>,
): Pick<Interface["session"], "prompt" | "command" | "compact"> {
  async function select(input: CompletionSelection) {
    if (input.agent) {
      await native.sessions.switchAgent({
        sessionID: input.sessionID,
        agent: input.agent,
      })
    }
    if (input.model) {
      await native.sessions.switchModel({
        sessionID: input.sessionID,
        model: {
          providerID: input.model.providerID,
          id: input.model.modelID,
          ...(input.variant ? { variant: input.variant } : {}),
        },
      })
    }
  }

  async function completed(
    sessionID: string,
    admittedID: string,
    interruptEpoch: number,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    await native.sessions.wait({ sessionID }, { signal })
    const messages = await lifecycle.messages({ sessionID })
    const assistant = messages.find(
      (message): message is CompletionResponse =>
        message.info.role === "assistant" &&
        message.info.parentID === admittedID &&
        message.info.time.completed !== undefined,
    )
    if (!assistant) {
      if ((interrupts.get(sessionID) ?? 0) > interruptEpoch) return CompletionCancelled
      throw new Error(`Completed assistant message not found for ${admittedID}`)
    }
    return assistant
  }

  return {
    prompt: async (input) => {
      await select(input)
      const interruptEpoch = interrupts.get(input.sessionID) ?? 0
      const admitted = await native.sessions.prompt(
        {
          sessionID: input.sessionID,
          prompt: prompt(input.parts),
          resume: true,
        },
        { signal: input.signal },
      )
      return completed(input.sessionID, admitted.id, interruptEpoch, input.signal)
    },
    command: async (input) => {
      await select(input)
      const interruptEpoch = interrupts.get(input.sessionID) ?? 0
      const admitted = await native.sessions.command(
        {
          sessionID: input.sessionID,
          command: input.command,
          arguments: input.arguments,
          agent: input.agent,
          model: {
            providerID: input.model.providerID,
            id: input.model.modelID,
            ...(input.variant ? { variant: input.variant } : {}),
          },
          files: prompt(input.parts).files,
          resume: true,
        },
        { signal: input.signal },
      )
      return completed(input.sessionID, admitted.id, interruptEpoch, input.signal)
    },
    compact: async (input) => {
      await native.sessions.compact({ sessionID: input.sessionID }, { signal: input.signal })
      await native.sessions.wait({ sessionID: input.sessionID }, { signal: input.signal })
    },
  }
}

function events(native: GeneratedClients["native"]): Interface["events"]["subscribe"] {
  return async function* events(input) {
    const projectLegacy = legacyEventProjection()
    for await (const source of native.events.subscribe({ signal: input?.signal })) {
      for (const payload of projectEvent(projectLegacy, source as Parameters<typeof legacyEventPayloads>[1])) {
        yield {
          directory: source.location?.directory,
          workspace: source.location?.workspaceID,
          payload,
        }
      }
    }
  }
}

function projectEvent(
  projectLegacy: ReturnType<typeof legacyEventProjection>,
  source: Parameters<typeof legacyEventPayloads>[1],
): readonly Event[] {
  try {
    return legacyEventPayloads(projectLegacy, source).map((payload) => payload as Event)
  } catch {
    return []
  }
}

function permission(native: GeneratedClients["native"]): Interface["permission"] {
  return {
    reply: (input) =>
      native.permissions.reply({
        sessionID: input.sessionID,
        requestID: input.requestID,
        reply: input.reply,
      }),
  }
}

function config(native: GeneratedClients["native"]): Interface["config"] {
  return {
    get: async (directory) => {
      const data = (await native.config.get({ location: { directory } })).data
      if (!data || typeof data !== "object" || Array.isArray(data) || !("model" in data)) return {}
      return typeof data.model === "string" ? { model: data.model } : {}
    },
  }
}

function catalog(native: GeneratedClients["native"]): Interface["catalog"] {
  const configuration = config(native)
  return {
    load: async (directory) => {
      const target = { location: { directory } }
      const [providerCatalog, agents, commands, skills, configured] = await Promise.all([
        native.providers.catalog(target),
        native.agents.list(target),
        native.commands.list(target),
        native.skills.list(target),
        configuration.get(directory),
      ])
      const projected = legacyProvidersFromNative(providerCatalog.data)
      const projectedCommands = commands.data.map(legacyCommandFromNative)
      const commandNames = new Set(projectedCommands.map((command) => command.name))
      return {
        providers: Object.fromEntries(projected.providers.map((provider) => [provider.id, provider])) as Record<
          ProviderV2.ID,
          Provider.Info
        >,
        agents: agents.data.map(legacyAgentFromNative),
        commands: [
          ...projectedCommands,
          ...skills.data
            .filter((skill) => !commandNames.has(skill.name))
            .map((skill) => ({
              name: skill.name,
              description: skill.description,
              source: "skill" as const,
              template: skill.content,
              hints: [],
            })),
        ].toSorted((a, b) => a.name.localeCompare(b.name)),
        configuredModel: configured.model,
      }
    },
  }
}

function mcp(legacy: GeneratedClients["legacy"]): Interface["mcp"] {
  return {
    add: async (input) => {
      await legacy.mcp.add(
        {
          directory: input.directory,
          name: input.name,
          config: input.config,
        },
        { throwOnError: true },
      )
    },
  }
}

function prompt(parts: readonly PromptPart[]) {
  return {
    text: parts
      .filter((part): part is Extract<PromptPart, { type: "text" }> => part.type === "text" && part.ignored !== true)
      .map((part) => part.text)
      .join(""),
    files: parts
      .filter((part): part is Extract<PromptPart, { type: "file" }> => part.type === "file")
      .map((part) => ({
        uri: part.url,
        mime: part.mime,
        name: part.filename,
        source: part.source?.text
          ? {
              text: part.source.text.value,
              start: part.source.text.start,
              end: part.source.text.end,
            }
          : undefined,
        resource:
          part.source?.type === "resource" ? { clientName: part.source.clientName, uri: part.source.uri } : undefined,
      })),
  }
}

export function make(options: ClientOptions): Interface {
  const clients = generatedClients(options)
  const interrupts = new Map<string, number>()
  const lifecycle = sessionLifecycle(clients.native, interrupts)
  const completion = sessionCompletion(clients.native, lifecycle, interrupts)
  return {
    session: { ...lifecycle, ...completion },
    events: { subscribe: events(clients.native) },
    permission: permission(clients.native),
    catalog: catalog(clients.native),
    config: config(clients.native),
    mcp: mcp(clients.legacy),
  }
}

export * as ACPClient from "./client"
