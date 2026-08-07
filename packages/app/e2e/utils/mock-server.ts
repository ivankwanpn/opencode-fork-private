import type { Page, Route } from "@playwright/test"

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[]
  session?: (sessionID: string) => ({ id: string } & Record<string, unknown>) | undefined
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  vcsDiff?: unknown[]
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => unknown
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  events?: () => unknown[]
  eventRetry?: number
  todos?: (sessionID: string) => unknown[]
  permissions?: unknown[] | (() => unknown[])
  questions?: unknown[] | (() => unknown[])
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: unknown
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const cursors = new Map<string, string>()
  let nextCursor = 0

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
    ).port
    if (url.port !== targetPort && url.port !== appPort) return route.fallback()

    const path = url.pathname
    if (path === "/api/health") return json(route, { healthy: true, version: "999.0.12-test", pid: 1 })
    if (path === "/api/capability") return json(route, { backgroundSubagents: false })
    if (path === "/api/event") return sse(route, currentEvents(config.events?.(), config.directory), config.eventRetry)

    if (path === "/api/session/active") return json(route, { data: activeSessions(config.sessionStatus) })
    if (path === "/api/session")
      return json(route, {
        data: config.sessions.map((session) => currentSession(session, config.directory)),
        cursor: {},
      })

    const messageMatch = path.match(/^\/api\/session\/([^/]+)\/message\/([^/]+)$/)
    if (messageMatch) {
      const sessionID = decodeURIComponent(messageMatch[1]!)
      const messageID = decodeURIComponent(messageMatch[2]!)
      config.onMessage?.({ sessionID, messageID })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const message =
        config.message?.(sessionID, messageID) ??
        config.pageMessages(sessionID, 200).items.find((item) => legacyMessageID(item) === messageID)
      const current = currentMessages(message).find((item) => item.id === messageID)
      if (!current) return json(route, { _tag: "MessageNotFoundError", sessionID, messageID }, undefined, 404)
      return json(route, { data: current })
    }

    const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const sessionID = decodeURIComponent(messagesMatch[1]!)
      const token = url.searchParams.get("cursor") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before)
        return json(route, { _tag: "InvalidCursorError", message: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID, before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const pageData = config.pageMessages(sessionID, Number(url.searchParams.get("limit") ?? 80), before)
      config.onMessages?.({ sessionID, before, phase: "end" })
      const cursor = pageData.cursor ? `cursor_${++nextCursor}` : undefined
      if (cursor) cursors.set(cursor, pageData.cursor!)
      return json(route, {
        data: pageData.items.flatMap(currentMessages).toReversed(),
        cursor: { next: cursor },
      })
    }

    const todoMatch = path.match(/^\/api\/session\/([^/]+)\/todo$/)
    if (todoMatch) return json(route, { data: config.todos?.(decodeURIComponent(todoMatch[1]!)) ?? [] })

    const childrenMatch = path.match(/^\/api\/session\/([^/]+)\/children$/)
    if (childrenMatch) {
      const sessionID = decodeURIComponent(childrenMatch[1]!)
      return json(route, {
        data: config.sessions
          .filter((session) => session.parentID === sessionID)
          .map((session) => currentSession(session, config.directory)),
      })
    }

    if (/^\/api\/session\/[^/]+\/diff$/.test(path)) return json(route, { data: [] })

    const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
    if (sessionMatch) {
      const sessionID = decodeURIComponent(sessionMatch[1]!)
      const session = config.session?.(sessionID) ?? config.sessions.find((item) => item.id === sessionID)
      if (!session) return json(route, { _tag: "SessionNotFoundError", sessionID: sessionMatch[1] }, undefined, 404)
      return json(route, { data: currentSession(session, config.directory) })
    }

    if (path === "/api/fs/list" && config.fileList) {
      const value = await config.fileList(url.searchParams.get("path") ?? "")
      return json(route, located(config, fileEntries(value)))
    }
    if (path === "/api/fs/read" && config.fileContent) {
      const filePath = url.searchParams.get("path") ?? ""
      return json(route, located(config, fileContent(filePath, await config.fileContent(filePath))))
    }
    if (path === "/api/fs/find" && config.findFiles) {
      const type = url.searchParams.get("type") ?? undefined
      const value = config.findFiles({
        query: url.searchParams.get("query") ?? "",
        dirs: type === "directory" ? "true" : type === "file" ? "false" : undefined,
        limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
      })
      return json(route, located(config, fileEntries(value)))
    }

    if (path === "/api/permission/request")
      return json(
        route,
        located(config, typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? [])),
      )
    if (path === "/api/question/request")
      return json(
        route,
        located(config, typeof config.questions === "function" ? config.questions() : (config.questions ?? [])),
      )

    const projectMatch = path.match(/^\/api\/project\/([^/]+)$/)
    if (projectMatch && route.request().method() === "PATCH") {
      const update: unknown = route.request().postDataJSON()
      return json(route, {
        ...(record(config.project) ? config.project : {}),
        ...(record(update) ? update : {}),
        id: decodeURIComponent(projectMatch[1]!),
      })
    }

    const staticRoutes: Record<string, unknown> = {
      "/api/location": location(config),
      "/api/path": {
        state: config.directory,
        config: config.directory,
        worktree: config.directory,
        directory: config.directory,
        home: "C:/OpenCode",
      },
      "/api/project": [config.project],
      "/api/project/current": {
        id: projectID(config),
        directory: config.directory,
      },
      "/api/agent": located(config, [
        {
          id: "build",
          name: "build",
          mode: "primary",
          hidden: false,
          request: { settings: {}, headers: {}, body: {} },
          permissions: [],
        },
      ]),
      "/api/config": located(config, {}),
      "/api/provider/catalog": located(config, config.provider),
      "/api/provider": located(config, []),
      "/api/model": located(config, []),
      "/api/command": located(config, []),
      "/api/skill": located(config, []),
      "/api/lsp": located(config, []),
      "/api/formatter": located(config, []),
      "/api/mcp": located(config, {}),
      "/api/mcp/resource": located(config, {}),
      "/api/reference": located(config, []),
      "/api/vcs": located(config, { branch: "main", default_branch: "main" }),
      "/api/vcs/status": located(config, []),
      "/api/vcs/diff": located(config, config.vcsDiff ?? []),
      "/api/workspace/adapter": located(config, []),
      "/api/workspace": located(config, []),
      "/api/workspace/status": located(config, []),
      "/api/pty/shells": located(config, []),
      "/api/pty": located(config, []),
      "/api/plugins": { marketplaces: [], plugins: [] },
    }
    if (path in staticRoutes) return json(route, staticRoutes[path])

    if (url.port === targetPort && targetPort !== appPort)
      return json(route, { _tag: "NotFoundError", message: `No mock route for ${path}` }, undefined, 404)
    return route.fallback()
  })
}

function currentSession(session: { id: string } & Record<string, unknown>, fallbackDirectory: string) {
  const time = record(session.time) ? session.time : {}
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: number(time.created),
      updated: number(time.updated),
      ...(typeof time.archived === "number" ? { archived: time.archived } : {}),
    },
    title: session.title ?? session.id,
    location: {
      directory: typeof session.directory === "string" ? session.directory : fallbackDirectory,
      ...(typeof session.workspaceID === "string" ? { workspaceID: session.workspaceID } : {}),
    },
    ...(typeof session.path === "string" ? { subpath: session.path } : {}),
  }
}

function currentMessages(value: unknown): Record<string, unknown>[] {
  if (!record(value)) return []
  if (typeof value.type === "string" && typeof value.id === "string") return [value]
  if (!record(value.info) || !Array.isArray(value.parts) || typeof value.info.id !== "string") return []
  if (value.info.role === "user") return currentUserMessage(value.info, value.parts)
  if (value.info.role === "assistant") return [currentAssistantMessage(value.info, value.parts)]
  return []
}

function currentUserMessage(info: Record<string, unknown>, parts: unknown[]) {
  const created = number(record(info.time) ? info.time.created : undefined)
  const agent = typeof info.agent === "string" ? info.agent : "build"
  const model = currentModel(info.model)
  const id = info.id as string
  return [
    {
      id: `${id}:agent`,
      type: "agent-switched",
      agent,
      time: { created },
    },
    ...(model
      ? [
          {
            id: `${id}:model`,
            type: "model-switched",
            model,
            time: { created },
          },
        ]
      : []),
    {
      id,
      type: "user",
      text: parts
        .filter((part) => record(part) && part.type === "text" && typeof part.text === "string")
        .map((part) => (part as Record<string, unknown>).text)
        .join(""),
      files: parts.flatMap(currentFileAttachment),
      agents: parts.flatMap(currentAgentAttachment),
      metadata: info.summary === undefined ? undefined : { summary: info.summary },
      time: { created },
    },
  ]
}

function currentAssistantMessage(info: Record<string, unknown>, parts: unknown[]) {
  const time = record(info.time) ? info.time : {}
  const model = currentModel({
    providerID: info.providerID,
    modelID: info.modelID,
    variant: info.variant,
    protocol: info.protocol,
  }) ?? { providerID: "", id: "" }
  return {
    id: info.id as string,
    type: "assistant",
    agent: typeof info.agent === "string" ? info.agent : typeof info.mode === "string" ? info.mode : "build",
    model,
    content: parts.flatMap((part) => currentAssistantContent(part, number(time.created))),
    finish: typeof info.finish === "string" ? info.finish : undefined,
    cost: typeof info.cost === "number" ? info.cost : undefined,
    tokens: record(info.tokens) ? info.tokens : undefined,
    error: currentError(info.error),
    time: {
      created: number(time.created),
      ...(typeof time.completed === "number" ? { completed: time.completed } : {}),
    },
  }
}

function currentAssistantContent(value: unknown, fallbackCreated: number): Record<string, unknown>[] {
  if (!record(value)) return []
  if (value.type === "text" && typeof value.text === "string") return [{ type: "text", text: value.text }]
  if (value.type === "reasoning" && typeof value.text === "string") {
    const time = record(value.time) ? value.time : {}
    return [
      {
        type: "reasoning",
        text: value.text,
        state: record(value.metadata) ? value.metadata : undefined,
        time: {
          created: typeof time.start === "number" ? time.start : fallbackCreated,
          ...(typeof time.end === "number" ? { completed: time.end } : {}),
        },
      },
    ]
  }
  if (value.type !== "tool" || typeof value.id !== "string") return []
  const state = record(value.state) ? value.state : {}
  const time = record(state.time) ? state.time : {}
  const created = typeof time.start === "number" ? time.start : fallbackCreated
  return [
    {
      type: "tool",
      id: value.id,
      name: typeof value.tool === "string" ? value.tool : "tool",
      providerState:
        record(value.metadata) && record(value.metadata.providerState) ? value.metadata.providerState : undefined,
      providerResultState:
        record(value.metadata) && record(value.metadata.providerResultState)
          ? value.metadata.providerResultState
          : undefined,
      state: currentToolState(state),
      time: {
        created,
        ...(state.status === "pending" ? {} : { ran: created }),
        ...(typeof time.end === "number" ? { completed: time.end } : {}),
      },
    },
  ]
}

function currentToolState(state: Record<string, unknown>) {
  if (state.status === "pending") {
    return {
      status: "streaming",
      input: typeof state.raw === "string" ? state.raw : jsonString(state.input),
    }
  }
  const input = record(state.input) ? state.input : {}
  const metadata = record(state.metadata) ? state.metadata : {}
  const structured = {
    ...metadata,
    ...(typeof state.title === "string" ? { title: state.title } : {}),
  }
  if (state.status === "running") return { status: "running", input, structured, content: [] }
  if (state.status === "error") {
    return {
      status: "error",
      input,
      structured,
      content: [],
      error: { type: "unknown", message: text(state.error) },
    }
  }
  return {
    status: "completed",
    input,
    structured,
    content: [
      ...(state.output === undefined ? [] : [{ type: "text", text: text(state.output) }]),
      ...(Array.isArray(state.attachments) ? state.attachments.flatMap(currentToolAttachment) : []),
    ],
  }
}

function currentFileAttachment(value: unknown) {
  if (!record(value) || value.type !== "file") return []
  const uri = typeof value.url === "string" ? value.url : typeof value.uri === "string" ? value.uri : ""
  return [
    {
      uri,
      data: "",
      mime: typeof value.mime === "string" ? value.mime : "application/octet-stream",
      name: typeof value.filename === "string" ? value.filename : undefined,
      source: { type: "uri", uri },
      mention: mention(value.source),
    },
  ]
}

function currentAgentAttachment(value: unknown) {
  if (!record(value) || (value.type !== "agent" && value.type !== "subtask")) return []
  const name = typeof value.name === "string" ? value.name : typeof value.agent === "string" ? value.agent : undefined
  if (!name) return []
  return [{ name, mention: mention(value.source) }]
}

function currentToolAttachment(value: unknown) {
  if (!record(value) || value.type !== "file") return []
  return [
    {
      type: "file",
      uri: typeof value.url === "string" ? value.url : "",
      mime: typeof value.mime === "string" ? value.mime : "application/octet-stream",
      name: typeof value.filename === "string" ? value.filename : undefined,
    },
  ]
}

function currentModel(value: unknown) {
  if (!record(value)) return
  const providerID = typeof value.providerID === "string" ? value.providerID : undefined
  const id = typeof value.id === "string" ? value.id : typeof value.modelID === "string" ? value.modelID : undefined
  if (!providerID || !id) return
  return {
    providerID,
    id,
    ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
    ...(typeof value.protocol === "string" ? { protocol: value.protocol } : {}),
  }
}

function currentError(value: unknown) {
  if (!record(value)) return
  const data = record(value.data) ? value.data : {}
  const message =
    typeof value.message === "string" ? value.message : typeof data.message === "string" ? data.message : "Error"
  const name = typeof value.name === "string" ? value.name : typeof value.type === "string" ? value.type : "unknown"
  return { type: name.toLowerCase(), message }
}

function currentEvents(events: unknown[] | undefined, fallbackDirectory: string) {
  return (events ?? []).flatMap((value, index) => {
    if (!record(value)) return []
    if (typeof value.type === "string") {
      return [
        {
          ...value,
          id: typeof value.id === "string" ? value.id : `evt_mock_${index}`,
          created: typeof value.created === "number" ? value.created : Date.now() + index,
          data: value.data ?? {},
          location: record(value.location) ? value.location : { directory: fallbackDirectory },
        },
      ]
    }
    if (!record(value.payload) || typeof value.payload.type !== "string") return []
    return [
      {
        id: typeof value.payload.id === "string" ? value.payload.id : `evt_mock_${index}`,
        created: Date.now() + index,
        type: value.payload.type,
        data: value.payload.properties ?? {},
        location: {
          directory: typeof value.directory === "string" ? value.directory : fallbackDirectory,
          ...(typeof value.workspace === "string" ? { workspaceID: value.workspace } : {}),
        },
      },
    ]
  })
}

function activeSessions(value: unknown) {
  if (!record(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([sessionID, status]) =>
      record(status) && (status.type === "busy" || status.type === "running") ? [[sessionID, { type: "running" }]] : [],
    ),
  )
}

function fileEntries(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ path: item, type: "file" }]
    if (!record(item) || typeof item.path !== "string") return []
    return [{ path: item.path, type: item.type === "directory" ? "directory" : "file" }]
  })
}

function fileContent(path: string, value: unknown) {
  const content = record(value) ? value : {}
  const encoding = content.type === "binary" || content.encoding === "base64" ? "base64" : "utf8"
  return {
    uri: path,
    name: path.split("/").at(-1),
    content: typeof content.content === "string" ? content.content : "",
    encoding,
    mime:
      typeof content.mimeType === "string"
        ? content.mimeType
        : encoding === "base64"
          ? "application/octet-stream"
          : "text/plain",
  }
}

export function mockLocatedResponse(input: { directory: string; projectID: string; data: unknown }) {
  return {
    location: {
      directory: input.directory,
      project: { id: input.projectID, directory: input.directory },
    },
    data: input.data,
  }
}

export function mockPtyResponse(input: { directory: string; projectID: string; id: string; title: string }) {
  return mockLocatedResponse({
    directory: input.directory,
    projectID: input.projectID,
    data: {
      id: input.id,
      title: input.title,
      command: "",
      args: [],
      cwd: input.directory,
      status: "running",
      pid: 1,
    },
  })
}

function located(config: MockServerConfig, data: unknown) {
  return mockLocatedResponse({ directory: config.directory, projectID: projectID(config), data })
}

function location(config: MockServerConfig) {
  return {
    directory: config.directory,
    project: { id: projectID(config), directory: config.directory },
  }
}

function projectID(config: MockServerConfig) {
  return record(config.project) && typeof config.project.id === "string" ? config.project.id : "project"
}

function legacyMessageID(value: unknown) {
  return record(value) && record(value.info) && typeof value.info.id === "string" ? value.info.id : undefined
}

function mention(value: unknown) {
  if (!record(value)) return
  const source = record(value.text) ? value.text : value
  const text =
    typeof source.value === "string" ? source.value : typeof source.text === "string" ? source.text : undefined
  if (!text || typeof source.start !== "number" || typeof source.end !== "number") return
  return { text, start: source.start, end: source.end }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function number(value: unknown) {
  return typeof value === "number" ? value : 0
}

function text(value: unknown) {
  if (typeof value === "string") return value
  return jsonString(value)
}

function jsonString(value: unknown) {
  if (value === undefined) return ""
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function json(route: Route, body: unknown, headers?: Record<string, string>, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}
