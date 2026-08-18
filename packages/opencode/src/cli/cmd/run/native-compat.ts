import type { Event, GlobalEvent, OpencodeClient, PermissionV2Request } from "@opencode-ai/sdk/v2"
import { legacyEventPayloads, legacyEventProjection } from "@/event-v2-bridge"
import { legacyAgentFromNative, legacyCommandFromNative, legacyProvidersFromNative } from "@/compat/native-v1-catalog"
import { legacySessionFromNative } from "@/compat/native-v1-session"
import { legacyTranscriptFromNative } from "@/compat/native-v1-transcript"
import type { NativeClient } from "./types"

type RequestOptions = { signal?: AbortSignal; throwOnError?: boolean }
type Input = Record<string, any>
type NativeEvent = ReturnType<NativeClient["events"]["subscribe"]> extends AsyncIterable<infer T> ? T : never

const location = (directory?: string) => (directory ? { directory } : undefined)

function model(input: unknown, variant?: string) {
  if (typeof input === "string") {
    const [providerID, ...rest] = input.split("/")
    const id = rest.join("/")
    if (!providerID || !id) return undefined
    return { providerID, id, ...(variant ? { variant } : {}) }
  }
  if (!input || typeof input !== "object") return undefined
  const providerID = Reflect.get(input, "providerID")
  const id = Reflect.get(input, "id") ?? Reflect.get(input, "modelID")
  if (typeof providerID !== "string" || typeof id !== "string") return undefined
  const selected = Reflect.get(input, "variant") ?? variant
  return { providerID, id, ...(typeof selected === "string" ? { variant: selected } : {}) }
}

function prompt(input: Input) {
  const parts = Array.isArray(input.parts) ? input.parts : []
  return {
    text: parts
      .filter((part) => part?.type === "text")
      .map((part) => String(part.text ?? ""))
      .join(""),
    files: parts
      .filter((part) => part?.type === "file")
      .map((part) => ({
        uri: String(part.url),
        mime: typeof part.mime === "string" ? part.mime : undefined,
        name: typeof part.filename === "string" ? part.filename : undefined,
        source:
          part.source?.text && typeof part.source.text.value === "string"
            ? {
                text: part.source.text.value,
                start: Number(part.source.text.start ?? 0),
                end: Number(part.source.text.end ?? 0),
              }
            : undefined,
        resource:
          part.source?.type === "resource"
            ? { clientName: String(part.source.clientName), uri: String(part.source.uri) }
            : undefined,
      })),
    agents: parts
      .filter((part) => part?.type === "agent")
      .map((part) => ({
        name: String(part.name),
        source: part.source
          ? {
              text: String(part.source.value ?? ""),
              start: Number(part.source.start ?? 0),
              end: Number(part.source.end ?? 0),
            }
          : undefined,
      })),
    ...(typeof input.system === "string" ? { system: input.system } : {}),
    ...(input.tools && typeof input.tools === "object" ? { tools: input.tools as Record<string, boolean> } : {}),
  }
}

function permission(input: {
  readonly id: string
  readonly sessionID: string
  readonly action: string
  readonly resources: readonly string[]
  readonly save?: readonly string[]
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly callID: string }
}): PermissionV2Request {
  return {
    id: input.id,
    sessionID: input.sessionID,
    action: input.action,
    resources: [...input.resources],
    metadata: { ...input.metadata },
    ...(input.save ? { save: [...input.save] } : {}),
    ...(input.source
      ? { source: { type: "tool" as const, messageID: input.source.messageID, callID: input.source.callID } }
      : {}),
  }
}

function commandFiles(parts: unknown) {
  if (!Array.isArray(parts)) return undefined
  return parts
    .filter((part) => part?.type === "file")
    .map((part) => ({
      uri: String(part.url),
      mime: typeof part.mime === "string" ? part.mime : undefined,
      name: typeof part.filename === "string" ? part.filename : undefined,
      source:
        part.source?.text && typeof part.source.text.value === "string"
          ? {
              text: part.source.text.value,
              start: Number(part.source.text.start ?? 0),
              end: Number(part.source.text.end ?? 0),
            }
          : undefined,
      resource:
        part.source?.type === "resource"
          ? { clientName: String(part.source.clientName), uri: String(part.source.uri) }
          : undefined,
    }))
}

function cliEventPayloads(projectLegacy: ReturnType<typeof legacyEventProjection>, source: NativeEvent) {
  if (source.type === "session.next.status") {
    return [
      {
        id: source.id,
        type: source.type,
        properties: source.data,
      } satisfies Extract<Event, { type: "session.next.status" }>,
    ]
  }

  return legacyEventPayloads(
    projectLegacy,
    source as unknown as Parameters<typeof legacyEventPayloads>[1],
  ).map((event) => event as Event)
}

export function createNativeCompatClient(input: { native: NativeClient; directory?: string }): OpencodeClient {
  const native = input.native
  const permissionSessions = new Map<string, string>()
  const questionSessions = new Map<string, string>()
  const projectLegacy = legacyEventProjection()
  const loc = (directory?: string) => location(directory ?? input.directory)

  const remember = (event: Event) => {
    if (event.type === "permission.asked") permissionSessions.set(event.properties.id, event.properties.sessionID)
    if (event.type === "permission.replied") permissionSessions.delete(event.properties.requestID)
    if (event.type === "question.asked") questionSessions.set(event.properties.id, event.properties.sessionID)
    if (event.type === "question.replied" || event.type === "question.rejected")
      questionSessions.delete(event.properties.requestID)
    return event
  }

  async function* projected(options?: RequestOptions): AsyncGenerator<Event> {
    for await (const source of native.events.subscribe({ signal: options?.signal })) {
      for (const event of cliEventPayloads(projectLegacy, source)) {
        yield remember(event)
      }
    }
  }

  async function* global(options?: RequestOptions): AsyncGenerator<GlobalEvent> {
    for await (const source of native.events.subscribe({ signal: options?.signal })) {
      for (const payload of cliEventPayloads(projectLegacy, source)) {
        const event = remember(payload)
        yield {
          directory: source.location?.directory,
          workspace: source.location?.workspaceID,
          payload: event,
        } as GlobalEvent
      }
    }
  }

  const client = {
    session: {
      list: async (value?: Input) => {
        const result = await native.sessions.list({
          directory: value?.directory ?? input.directory,
          limit: value?.limit ?? 100,
          order: "desc",
        })
        return { data: result.data.map(legacySessionFromNative) }
      },
      create: async (value: Input) => {
        const created = await native.sessions.create({
          agent: value.agent,
          model: model(value.model),
          location: input.directory ? { directory: input.directory } : undefined,
        })
        const updated = value.title
          ? await native.sessions.update({ sessionID: created.id, title: value.title })
          : created
        return { data: legacySessionFromNative(updated) }
      },
      messages: async (value: Input) => {
        const [session, messages] = await Promise.all([
          native.sessions.get({ sessionID: value.sessionID }),
          native.messages.list({ sessionID: value.sessionID, limit: value.limit, order: "asc" }),
        ])
        return {
          data: legacyTranscriptFromNative({
            session,
            messages: messages.data as unknown as Parameters<typeof legacyTranscriptFromNative>[0]["messages"],
          }),
        }
      },
      children: async (value: Input) => ({
        data: (await native.sessions.children({ sessionID: value.sessionID })).map(legacySessionFromNative),
      }),
      status: async () => {
        const active = await native.sessions.active()
        return { data: Object.fromEntries(Object.keys(active).map((id) => [id, { type: "busy" as const }])) }
      },
      prompt: async (value: Input, options?: RequestOptions) => {
        if (value.agent) await native.sessions.switchAgent({ sessionID: value.sessionID, agent: value.agent })
        const selected = model(value.model, value.variant)
        if (selected) await native.sessions.switchModel({ sessionID: value.sessionID, model: selected })
        const data = await native.sessions.prompt(
          {
            sessionID: value.sessionID,
            id: value.messageID,
            prompt: prompt(value),
            resume: true,
          },
          { signal: options?.signal },
        )
        return { data }
      },
      promptAsync: async (value: Input, options?: RequestOptions) => {
        await client.session.prompt(value, options)
        return { data: true }
      },
      command: async (value: Input, options?: RequestOptions) => ({
        data: await native.sessions.command(
          {
            sessionID: value.sessionID,
            id: value.messageID,
            command: value.command,
            arguments: value.arguments ?? "",
            agent: value.agent,
            model: model(value.model, value.variant),
            files: commandFiles(value.parts),
            resume: true,
          },
          { signal: options?.signal },
        ),
      }),
      shell: async (value: Input, options?: RequestOptions) => {
        await native.sessions.shell(
          {
            sessionID: value.sessionID,
            command: value.command,
            agent: value.agent,
            model: model(value.model, value.variant),
            resume: true,
          },
          { signal: options?.signal },
        )
        return { data: true }
      },
    },
    event: {
      subscribe: async (options?: RequestOptions) => ({ stream: projected(options) }),
    },
    global: {
      event: async (options?: RequestOptions) => ({ stream: global(options) }),
    },
    permission: {
      list: async () => {
        const result = await native.permissions.listRequests({ location: loc() })
        for (const item of result.data) permissionSessions.set(item.id, item.sessionID)
        return { data: result.data.map(permission) }
      },
      reply: async (value: Input) => {
        const sessionID = value.sessionID ?? permissionSessions.get(value.requestID)
        if (!sessionID) throw new Error(`Permission session not found: ${value.requestID}`)
        await native.permissions.reply({ sessionID, requestID: value.requestID, reply: value.reply })
        return { data: true }
      },
    },
    question: {
      list: async () => {
        const result = await native.questions.listRequests({ location: loc() })
        for (const item of result.data) questionSessions.set(item.id, item.sessionID)
        return { data: result.data }
      },
      reply: async (value: Input) => {
        const sessionID = value.sessionID ?? questionSessions.get(value.requestID)
        if (!sessionID) throw new Error(`Question session not found: ${value.requestID}`)
        await native.questions.reply({ sessionID, requestID: value.requestID, answers: value.answers })
        return { data: true }
      },
      reject: async (value: Input) => {
        const sessionID = value.sessionID ?? questionSessions.get(value.requestID)
        if (!sessionID) throw new Error(`Question session not found: ${value.requestID}`)
        await native.questions.reject({ sessionID, requestID: value.requestID })
        return { data: true }
      },
    },
    app: {
      agents: async (value?: Input) => ({
        data: (await native.agents.list({ location: loc(value?.directory) })).data.map((agent) =>
          legacyAgentFromNative(agent as unknown as Parameters<typeof legacyAgentFromNative>[0]),
        ),
      }),
    },
    command: {
      list: async (value?: Input) => ({
        data: (await native.commands.list({ location: loc(value?.directory) })).data.map(legacyCommandFromNative),
      }),
    },
    experimental: {
      resource: {
        list: async (value?: Input) => ({
          data: (await native.mcps.resources({ location: loc(value?.directory) })).data,
        }),
      },
      session: {
        background: async (value: Input) => ({
          data: await native.sessions.background({ sessionID: value.sessionID }),
        }),
      },
    },
    config: {
      get: async () => ({ data: (await native.config.get({ location: loc() })).data }),
      providers: async (value?: Input) => {
        const target = { location: loc(value?.directory) }
        const result = legacyProvidersFromNative(
          (await native.providers.catalog(target)).data as unknown as Parameters<typeof legacyProvidersFromNative>[0],
        )
        return { data: { providers: result.providers, default: result.defaults } }
      },
    },
    provider: {
      list: async (value?: Input) => {
        const target = { location: loc(value?.directory) }
        const result = legacyProvidersFromNative(
          (await native.providers.catalog(target)).data as unknown as Parameters<typeof legacyProvidersFromNative>[0],
        )
        return { data: { all: result.providers, connected: result.providers, default: result.defaults } }
      },
    },
    path: {
      get: async () => {
        const result = await native.location.get({ location: loc() })
        return {
          data: {
            directory: result.directory,
            worktree: result.project.directory,
            home: result.directory,
            state: result.directory,
            config: result.directory,
          },
        }
      },
    },
  }

  return client as unknown as OpencodeClient
}
