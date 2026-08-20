import type { Config, Path, Project, ProviderAuthResponse, SessionNextStatusInfo } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { type Accessor, batch, createMemo, getOwner, onCleanup, onMount, untrack } from "solid-js"
import { createStore, produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { ServerSDK } from "./server-sdk"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearProviderRev,
  loadAgentsQuery,
  loadCommands,
  loadCompatibleConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import {
  applyDirectoryEvent,
  applyDirectorySessionCreated,
  applyGlobalEvent,
  isAgentConfigDisposal,
} from "./global-sync/event-reducer"
import { estimateRootSessionTotal, loadRootSessions } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta, State } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
import { formatServerError, isRequestCancelled } from "@/utils/server-errors"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { SolidQueryOptions } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"
import { PathKey } from "@/utils/path-key"
import { createDirSyncContext } from "./directory-sync"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { createRefCountMap } from "@/utils/refcount"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { retry } from "@opencode-ai/core/util/retry"
import type { ServerScope } from "@/utils/server-scope"
import { createHomeSessionIndexCache } from "./global-sync/home-session-index"
import { persisted } from "@/utils/persist"
import type { ServerApi } from "@/utils/server"
import type {
  McpListInput,
  McpListOutput,
  McpResource,
  McpResourceCatalogInput,
  McpResourceCatalogOutput,
  McpServer,
  SessionActiveOutput,
} from "@opencode-ai/client/promise"
import { toggleMcp } from "./global-sync/mcp"
import { createServerSession, type ServerSession, type SessionActivity } from "./server-session"
import { extractArray } from "@/utils/response-helpers"
import { toHomeSessionEvent } from "@/utils/session-snapshot"
import {
  notifySessionTabsReconcile,
  notifySessionTabsRemoved,
  sessionTabsRemovedFromServerEvent,
} from "@/components/titlebar-session-events"
import { agentOverride, normalizedAgentOverride, type AgentOverride } from "./agent-config"

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

type McpListApi = {
  readonly list: (input?: McpListInput) => Promise<McpListOutput>
}

type McpResourceApi = {
  readonly resource: {
    readonly catalog: (input?: McpResourceCatalogInput) => Promise<McpResourceCatalogOutput>
  }
}

const extractMcpResources = (result: McpResourceCatalogOutput) => {
  const body = result && typeof result === "object" && "data" in result ? result.data : undefined
  if (body && typeof body === "object" && "resources" in body && Array.isArray(body.resources)) {
    return body.resources as McpResource[]
  }
  return extractArray<McpResource>(result)
}

type ApiQueryOptions<T, K extends readonly unknown[]> = SolidQueryOptions<T, Error, T, K> & {
  initialData?: undefined
  queryKey: K
}

// The app still accepts the legacy client package, whose SessionActive type
// only declares `{ type: "running" }`. V2 servers may include the turn
// identity in that same value, so widen the local boundary without trusting
// unvalidated network data (activeSessionTurn performs the runtime check).
type ActiveSessionStatus = SessionActiveOutput[string] & {
  readonly turnID?: string
  readonly phase?: "pending" | "active"
  readonly activity?: SessionActivity
}
type ActiveSessionMap = Record<string, ActiveSessionStatus>

type SessionActiveApi = {
  readonly active: () => Promise<ActiveSessionMap>
}

export const loadMcpQuery = (
  scope: ServerScope,
  directory: string,
  api: McpListApi,
  apiForGeneration?: () => Promise<ServerApi>,
): ApiQueryOptions<Record<string, McpServer["status"]>, readonly [ServerScope, string, "mcp"]> =>
  queryOptions<
    Record<string, McpServer["status"]>,
    Error,
    Record<string, McpServer["status"]>,
    readonly [ServerScope, string, "mcp"]
  >({
    queryKey: [scope, directory, "mcp"] as const,
    queryFn: async () =>
      (await apiForGeneration?.())?.mcp
        .list({ location: { directory } })
        .then((result) => Object.fromEntries(extractArray(result).map((server) => [server.name, server.status]))) ??
      api
        .list({ location: { directory } })
        .then((result) => Object.fromEntries(extractArray(result).map((server) => [server.name, server.status]))),
  })

export const loadMcpResourcesQuery = (
  scope: ServerScope,
  directory: string,
  api: McpResourceApi,
  apiForGeneration?: () => Promise<ServerApi>,
): ApiQueryOptions<Record<string, McpResource>, readonly [ServerScope, string, "mcpResources"]> =>
  queryOptions<
    Record<string, McpResource>,
    Error,
    Record<string, McpResource>,
    readonly [ServerScope, string, "mcpResources"]
  >({
    queryKey: [scope, directory, "mcpResources"] as const,
    queryFn: async () =>
      (await apiForGeneration?.())?.mcp.resource
        .catalog({ location: { directory } })
        .then((result) =>
          Object.fromEntries(
            extractMcpResources(result).map((resource) => [`${resource.server}:${resource.uri}`, resource]),
          ),
        ) ??
      api.resource
        .catalog({ location: { directory } })
        .then((result) =>
          Object.fromEntries(
            extractMcpResources(result).map((resource) => [`${resource.server}:${resource.uri}`, resource]),
          ),
        ),
    placeholderData: {},
  })

export const loadLspQuery = (
  scope: ServerScope,
  directory: string,
  api: ServerApi["lsp"],
  apiForGeneration?: () => Promise<ServerApi>,
) =>
  queryOptions({
    queryKey: [scope, directory, "lsp"] as const,
    queryFn: async () => {
      const current = (await apiForGeneration?.())?.lsp ?? api
      return (await current.status({ location: { directory } })).data.slice()
    },
  })

export const loadActiveSessionsQuery = (
  scope: ServerScope,
  api: SessionActiveApi,
): ApiQueryOptions<ActiveSessionMap, readonly [ServerScope, "activeSessions"]> =>
  queryOptions<ActiveSessionMap, Error, ActiveSessionMap, readonly [ServerScope, "activeSessions"]>({
    queryKey: [scope, "activeSessions"] as const,
    queryFn: () => api.active(),
    enabled: true,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

export async function refreshProviderQueries(input: {
  bootstrap: { refetch: () => Promise<unknown> }
  queryClient: {
    invalidateQueries: (filters: {
      queryKey?: readonly unknown[]
      predicate?: (query: { queryKey: readonly unknown[] }) => boolean
    }) => Promise<unknown>
  }
  scope: ServerScope
}) {
  await input.bootstrap.refetch()
  await Promise.all([
    input.queryClient.invalidateQueries({ queryKey: [input.scope, null, "providers"] }),
    input.queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === input.scope && query.queryKey[2] === "providers",
    }),
  ])
}

export type ConfigUpdateOptions = {
  refreshProviders?: boolean
}

export function isProviderCatalogEvent(type: string) {
  return type === "catalog.updated" || type === "integration.updated" || type === "integration.connection.updated"
}

export function isCommandCatalogEvent(type: string) {
  return type === "catalog.updated" || type === "command.updated"
}

function activeSessionTurn(status: unknown) {
  if (!status || typeof status !== "object") return
  if (!("turnID" in status) || typeof status.turnID !== "string") return
  if (!("phase" in status) || (status.phase !== "pending" && status.phase !== "active")) return
  return { turnID: status.turnID, phase: status.phase } as const
}

function activeSessionActivity(status: unknown) {
  if (!status || typeof status !== "object" || !("activity" in status)) return
  const activity = status.activity
  if (
    activity !== "compacting" &&
    activity !== "dispatching" &&
    activity !== "responding" &&
    activity !== "running-tool" &&
    activity !== "waiting-user"
  )
    return
  return activity
}

export function seedActiveSessionStatuses(
  session: Pick<ServerSession, "data" | "set"> & {
    setTurn?: (sessionID: string, turnID: string, phase: "pending" | "active") => void
    setActivity?: (sessionID: string, activity: SessionActivity) => void
  },
  active: ActiveSessionMap | Record<string, SessionNextStatusInfo>,
) {
  for (const sessionID of Object.keys(active)) {
    const status = active[sessionID]
    const turn = activeSessionTurn(status)
    if (turn) session.setTurn?.(sessionID, turn.turnID, turn.phase)
    const activity = activeSessionActivity(status)
    if (activity) session.setActivity?.(sessionID, activity)
    if (session.data.session_status[sessionID] !== undefined) continue
    session.set("session_status", sessionID, status?.type === "running" ? { type: "busy" } : status)
  }
}

export function reconcileActiveSessionStatuses(
  session: Pick<ServerSession, "data" | "set"> & {
    setTurn?: (sessionID: string, turnID: string, phase: "pending" | "active") => void
    clearTurn?: (sessionID: string) => void
    setActivity?: (sessionID: string, activity: SessionActivity) => void
    clearActivity?: (sessionID: string) => void
  },
  active: ActiveSessionMap | Record<string, SessionNextStatusInfo>,
) {
  const reload = new Set([
    ...Object.keys(active),
    ...Object.entries(session.data.session_status)
      .filter(([, status]) => status.type !== "idle")
      .map(([sessionID]) => sessionID),
  ])

  for (const [sessionID, status] of Object.entries(active)) {
    const turn = activeSessionTurn(status)
    if (turn) session.setTurn?.(sessionID, turn.turnID, turn.phase)
    else session.clearTurn?.(sessionID)
    const activity = activeSessionActivity(status)
    if (activity) session.setActivity?.(sessionID, activity)
    else session.clearActivity?.(sessionID)
  }
  for (const sessionID of Object.keys(session.data.session_status)) {
    if (!active[sessionID]) {
      session.clearTurn?.(sessionID)
      session.clearActivity?.(sessionID)
    }
  }

  session.set(
    "session_status",
    produce((draft) => {
      for (const sessionID of Object.keys(draft)) {
        const status = active[sessionID]
        if (status) {
          draft[sessionID] = status.type === "running" ? { type: "busy" } : status
          continue
        }
        if (draft[sessionID]?.type === "busy") draft[sessionID] = { type: "idle" }
      }

      for (const [sessionID, status] of Object.entries(active)) {
        draft[sessionID] = status.type === "running" ? { type: "busy" } : status
      }
    }),
  )

  return [...reload]
}

function makeQueryOptionsApi(scope: ServerScope, serverAPI: ServerApi, apiForGeneration: () => Promise<ServerApi>) {
  return {
    globalConfig: () => loadCompatibleConfigQuery(scope, serverAPI.config, apiForGeneration),
    projects: () => loadProjectsQuery(scope, serverAPI.project, apiForGeneration),
    providers: (directory: PathKey | null) => loadProvidersQuery(scope, directory, serverAPI, apiForGeneration),
    path: (directory: PathKey | null) => loadPathQuery(scope, directory, serverAPI.path, apiForGeneration),
    agents: (directory: PathKey) => loadAgentsQuery(scope, directory, serverAPI.agent, apiForGeneration),
    references: (directory: PathKey) => loadReferencesQuery(scope, directory, serverAPI.reference, apiForGeneration),
    mcp: (directory: PathKey) => loadMcpQuery(scope, directory, serverAPI.mcp, apiForGeneration),
    mcpResources: (directory: PathKey) => loadMcpResourcesQuery(scope, directory, serverAPI.mcp, apiForGeneration),
    lsp: (directory: PathKey) => loadLspQuery(scope, directory, serverAPI.lsp, apiForGeneration),
    sessions: (directory: PathKey) => ({ queryKey: [scope, directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

export function createServerSyncContextInner(serverSDK: ServerSDK) {
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("ServerSync must be created within owner")

  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()
  const requestRevisions = new Map<string, { permission: number; question: number }>()

  const pendingRequestRevision = (directory: string) => {
    const key = directoryKey(directory)
    const current = requestRevisions.get(key) ?? { permission: 0, question: 0 }
    requestRevisions.set(key, current)
    return {
      permission: () => requestRevisions.get(key)?.permission ?? 0,
      question: () => requestRevisions.get(key)?.question ?? 0,
    }
  }

  const bumpPendingRequestRevision = (directory: string, type: string) => {
    const key = directoryKey(directory)
    const current = requestRevisions.get(key) ?? { permission: 0, question: 0 }
    if (type.startsWith("permission.")) {
      requestRevisions.set(key, { ...current, permission: current.permission + 1 })
      return
    }
    if (type.startsWith("question.")) requestRevisions.set(key, { ...current, question: current.question + 1 })
  }

  const session = createServerSession(undefined, serverSDK.api.session, serverSDK.api.message, {
    api: serverSDK.api,
    apiForGeneration: serverSDK.apiForGeneration,
    activeSessions: () => serverSDK.apiForGeneration().then((api) => api.session.active()),
  })
  const queryOptionsApi = makeQueryOptionsApi(serverSDK.scope, serverSDK.api, serverSDK.apiForGeneration)

  const [configQuery, providerQuery, pathQuery] = useQueries(() => ({
    queries: [queryOptionsApi.globalConfig(), queryOptionsApi.providers(null), queryOptionsApi.path(null)],
  }))
  const activeSessionsQuery = useQuery(() =>
    loadActiveSessionsQuery(serverSDK.scope, {
      active: async () => {
        const active = await serverSDK.apiForGeneration().then((api) => api.session.active())
        seedActiveSessionStatuses(session, active)
        for (const sessionID of Object.keys(active)) {
          void session.resolve(sessionID).catch(() => undefined)
        }
        return active
      },
    }),
  )
  const refreshSessionStatuses = async () => {
    const result = await activeSessionsQuery.refetch()
    if (result.data === undefined) return
    reconcileActiveSessionStatuses(session, result.data)
    return result.data
  }

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return !bootstrap.isPending
    },
    project: [],
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
      if (pathQuery.isLoading) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get provider() {
      const EMPTY = { all: new Map(), connected: [], default: {} }
      if (providerQuery.isLoading) return EMPTY
      return providerQuery.data ?? EMPTY
    },
    get config() {
      if (configQuery.isLoading) return {}
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })

  const queryClient = useQueryClient()
  const homeSessions = createHomeSessionIndexCache(queryClient, ServerConnection.key(serverSDK.server))

  let bootedAt = 0
  let bootingRoot = false
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const bootstrap = useQuery(() => ({
    queryKey: [serverSDK.scope, "bootstrap"],
    queryFn: async () => {
      await bootstrapGlobal({
        serverAPI: serverSDK.api,
        apiForGeneration: serverSDK.apiForGeneration,
        scope: serverSDK.scope,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
      return bootedAt
    },
  }))

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: [serverSDK.scope, "bootstrap"] }),
    bootstrapInstance,
  })

  const loadDirectoryCommands = (directory: string, setStore: SetStoreFunction<State>) =>
    serverSDK
      .apiForGeneration()
      .then((api) => loadCommands(directory, api.command, serverSDK.apiForGeneration))
      .then((commands) => setStore("command", commands))

  const children = createChildStoreManager({
    owner,
    scope: serverSDK.scope,
    persist: persisted,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onMcp: (directory, setStore) => {
      void loadDirectoryCommands(directory, setStore).catch((err) => {
        if (isRequestCancelled(err)) return
        showToast({
          variant: "error",
          title: language.t("toast.project.reloadFailed.title", { project: getFilename(directory) }),
          description: formatServerError(err, language.t),
        })
      })
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      requestRevisions.delete(key)
      clearProviderRev(serverSDK.scope, key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      provider: globalStore.provider,
    },
  })

  const refreshCommands = (directory: string) => {
    const key = directoryKey(directory)
    const existing = children.children[key]
    if (!existing || !children.mcp(key)) return Promise.resolve()
    return loadDirectoryCommands(key, existing[1]).catch((err) => {
      if (isRequestCancelled(err)) return
      showToast({
        variant: "error",
        title: language.t("toast.project.reloadFailed.title", { project: getFilename(key) }),
        description: formatServerError(err, language.t),
      })
    })
  }

  const refreshAgents = async (directory?: string) => {
    const directories = directory
      ? [directoryKey(directory)]
      : Object.keys(children.children)
          .map(directoryKey)
          .filter((item) => children.active(item))
    await Promise.all(
      directories.map(async (item) => {
        const existing = children.children[item]
        if (!existing) return
        await queryClient.invalidateQueries(queryOptionsApi.agents(item))
        const data = await queryClient.fetchQuery(queryOptionsApi.agents(item))
        existing[1]("agent", reconcile(data, { key: "name" }))
      }),
    )
  }

  async function loadSessions(directory: string, options?: { limit?: number }) {
    const key = directoryKey(directory)
    const pending = sessionLoads.get(key)
    if (pending) {
      await pending
      return loadSessions(directory, options)
    }

    children.pin(key)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(key)
    const retainedLimit = Math.max(store.limit, options?.limit ?? 0, meta?.limit ?? 0)
    if (meta && meta.limit >= retainedLimit) {
      const next = trimSessions(store.session, {
        limit: retainedLimit,
        permission: session.data.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
      }
      children.unpin(key)
      return
    }

    const limit = Math.max(retainedLimit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = queryClient
      .fetchQuery({
        ...queryOptionsApi.sessions(key),
        queryFn: () =>
          serverSDK
            .apiForGeneration()
            .then((api) => loadRootSessions({ api: api.session, directory, limit }))
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const limit = Math.max(store.limit, options?.limit ?? 0, sessionMeta.get(key)?.limit ?? 0)
              const childSessions = store.session.filter((s) => !!s.parentID)
              const next = trimSessions([...nonArchived, ...childSessions], {
                limit,
                permission: session.data.permission,
              })
              batch(() => {
                next.forEach(session.remember)
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(next, { key: "id" }))
              })
              sessionMeta.set(key, { limit })
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(key, promise)
    void promise.finally(() => {
      sessionLoads.delete(key)
      children.unpin(key)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      await bootstrapDirectory({
        directory,
        scope: serverSDK.scope,
        mcp: children.mcp(key),
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        api: serverSDK.api,
        apiForGeneration: serverSDK.apiForGeneration,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
        session,
        activeSessions: () => activeSessionsQuery.data,
        pendingRequestRevision: pendingRequestRevision(directory),
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const indexSession = (info: Parameters<typeof session.remember>[0]) => {
    const key = directoryKey(info.directory)
    const existing = children.children[key]
    if (!existing) return
    applyDirectorySessionCreated({
      info,
      store: existing[0],
      setStore: existing[1],
      limit: Math.max(existing[0].limit, sessionMeta.get(key)?.limit ?? 0),
      permission: session.data.permission,
    })
  }

  const unsub = serverSDK.event.listen((e) => {
    const directory = e.name
    const key = directoryKey(directory)
    const event = e.details
    const eventType: string = event.type
    const reconnecting = eventType === "server.connected" && serverSDK.eventGeneration() > 1
    const recent = !reconnecting && (bootingRoot || Date.now() - bootedAt < 1500)

    if (event.current) session.applyV2(event.current)
    session.apply(event)
    const server = ServerConnection.key(serverSDK.server)
    const removedTabs = sessionTabsRemovedFromServerEvent({ server, directory, event })
    if (removedTabs) notifySessionTabsRemoved(removedTabs)
    const homeSessionEvent = toHomeSessionEvent(event)
    if (homeSessionEvent) homeSessions.apply(homeSessionEvent)
    homeSessions.refresh(event.type)

    if (directory === "global") {
      if (eventType === "server.connected") {
        notifySessionTabsReconcile({ server })
        if (!recent) {
          void bootstrap.refetch()
          void activeSessionsQuery
            .refetch()
            .then((result) => {
              if (result.data === undefined) return
              // The global stream has no replay cursor, so every mounted transcript needs an authoritative refresh.
              const sessionIDs = new Set([...session.pinned(), ...reconcileActiveSessionStatuses(session, result.data)])
              return Promise.allSettled(
                [...sessionIDs].flatMap((sessionID) => [
                  session.sync(sessionID, { force: true }),
                  session.context.refresh(sessionID),
                ]),
              )
            })
            .catch((error) => console.error("Failed to recover sessions after server reconnect", error))
        } else if (activeSessionsQuery.data === undefined && !activeSessionsQuery.isFetching) {
          void activeSessionsQuery.refetch()
        }
      }
      const agentConfigDisposal = isAgentConfigDisposal(event)
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          void bootstrap.refetch()
        },
        refreshConfig: () => {
          void queryClient.invalidateQueries({ queryKey: [serverSDK.scope, "config"] })
        },
        refreshAgents: () => {
          void refreshAgents()
        },
        setGlobalProject: setProjects,
      })
      if (
        eventType === "config.updated" ||
        isProviderCatalogEvent(eventType) ||
        eventType === "agent.updated" ||
        eventType === "project.directories.updated"
      )
        bootstrap.refetch()
      if (isCommandCatalogEvent(eventType)) {
        for (const directory of Object.keys(children.children)) {
          if (!children.active(directory)) continue
          void refreshCommands(directory)
          queue.push(directory)
        }
      }
      if ((eventType === "server.connected" || eventType === "global.disposed") && !agentConfigDisposal) {
        if (recent) return
        for (const directory of Object.keys(children.children)) {
          if (!children.active(directory)) continue
          queue.push(directory)
        }
      }
      return
    }

    if (event.current?.type === "session.moved" || event.current?.type === "session.next.moved") {
      const info = session.get(event.current.data.sessionID)
      if (info) indexSession(info)
    }
    if (event.current?.type === "session.forked")
      void session
        .resolve(event.current.data.sessionID, { force: true })
        .then(indexSession)
        .catch(() => {})

    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    if (
      eventType === "permission.v2.asked" ||
      eventType === "permission.v2.replied" ||
      eventType === "question.v2.asked" ||
      eventType === "question.v2.replied" ||
      eventType === "question.v2.rejected"
    )
      bumpPendingRequestRevision(key, eventType)
    if (
      event.current?.type === "session.moved" ||
      event.current?.type === "session.next.moved" ||
      event.current?.type === "session.archived" ||
      event.current?.type === "session.forked" ||
      isCommandCatalogEvent(eventType) ||
      eventType === "config.updated" ||
      isProviderCatalogEvent(eventType) ||
      eventType === "agent.updated"
    )
      queue.push(key)
    if (eventType === "mcp.status.changed") void queryClient.invalidateQueries(queryOptionsApi.mcp(key))
    if (eventType === "mcp.resources.changed") void queryClient.invalidateQueries(queryOptionsApi.mcpResources(key))
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: (directory) => {
        if (children.active(directory)) queue.push(directory)
      },
      retainedLimit: sessionMeta.get(key)?.limit,
      sessionContent: false,
      permission: session.data.permission,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        if (!children.active(key)) return
        void queryClient.fetchQuery(queryOptionsApi.lsp(key))
      },
      loadReferences: () => {
        if (!children.active(key)) return
        void queryClient.fetchQuery(queryOptionsApi.references(key))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void serverSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void serverSDK.event.start()
      }, 0)
    }
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const refreshProviders = async () => {
    await refreshProviderQueries({
      bootstrap,
      queryClient,
      scope: serverSDK.scope,
    })
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: async (config: Config) => {
      const api = await serverSDK.apiForGeneration()
      return api.config.update({
        config: config as unknown as Parameters<ServerApi["config"]["update"]>[0]["config"],
      })
    },
  }))

  const updateConfig = async (config: Config, options?: ConfigUpdateOptions) => {
    const result = await updateConfigMutation.mutateAsync(config)
    if (options?.refreshProviders !== false) await refreshProviders()
    return result
  }

  const updateAgent = async (id: string, patch: AgentOverride) => {
    const before = globalStore.config.agent?.[id]
    const next = { ...agentOverride(globalStore.config, id), ...patch }
    setGlobalStore("config", "agent", id, normalizedAgentOverride(next))
    try {
      await updateConfig(
        { agent: { [id]: next } as unknown as NonNullable<Config["agent"]> },
        { refreshProviders: false },
      )
    } catch (error) {
      setGlobalStore("config", "agent", id, before)
      throw error
    }
  }

  const refreshMcp = async (directory: string) => {
    const key = directoryKey(directory)
    await Promise.all([
      queryClient.refetchQueries(queryOptionsApi.mcp(key)),
      queryClient.refetchQueries(queryOptionsApi.mcpResources(key)),
    ])
  }

  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    disableMcp: children.disableMcp,
    queryOptions: queryOptionsApi,
    // bootstrap,
    updateConfig,
    refreshProviders,
    agents: {
      update: updateAgent,
      refresh: refreshAgents,
    },
    project: projectApi,
    session,
    refreshSessionStatuses,
    homeSessions,
    mcp: {
      toggle: async (directory: string, name: string) => {
        const key = directoryKey(directory)
        const status = children.child(key, { bootstrap: false })[0].mcp[name]?.status
        if (!status) return
        const api = await serverSDK.apiForGeneration()
        await toggleMcp({
          status,
          connect: () => api.mcp.connect({ server: name, location: { directory: key } }),
          disconnect: () => api.mcp.disconnect({ server: name, location: { directory: key } }),
          authenticate: async () => {
            await api.mcp.authenticate({ name, location: { directory: key } })
          },
          refresh: () => refreshMcp(key),
        })
      },
      refresh: refreshMcp,
    },
    commands: {
      refresh: refreshCommands,
    },
  }
}

export function createServerSyncContext(serverSDK: ServerSDK) {
  const inner = createServerSyncContextInner(serverSDK)
  return Object.assign(inner, {
    ensureDirSyncContext: createRefCountMap(
      (dir) => createDirSyncContext(dir, inner, serverSDK),
      (dir) => inner.disableMcp(dir),
      directoryKey,
    ),
  })
}

export type ServerSync = ReturnType<typeof createServerSyncContext>

export const { use: useServerSync, provider: ServerSyncProvider } = createSimpleContext({
  name: "ServerSync",
  // Returns an accessor so the resolved server can change reactively without
  // re-instantiating the subtree (mirrors useServerSDK).
  init: (props: { server?: Accessor<ServerConnection.Any | undefined> }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSync>(() => {
      const conn = props.server?.() ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.ensureServerCtx(conn).sync
    })
  },
})

export function useQueryOptions() {
  const sync = useServerSync()
  return createMemo(() => sync().queryOptions)
}
