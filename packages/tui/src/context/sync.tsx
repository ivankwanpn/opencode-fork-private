import type {
  Config,
  Todo,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
  SessionV2Info,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import path from "path"
import { useKV } from "./kv"
import { usePermission } from "./permission"
import { nativeSessionListQuery } from "./session-query"
import { useData } from "./data"

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

const mutable = <T,>(value: unknown): T => structuredClone(value) as T

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: SessionV2Info[]
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      config: {},
      status: "loading",
      permission: {},
      question: {},
      session: [],
      session_status: {},
      session_diff: {},
      todo: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()
    const data = useData()

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    async function listSessions() {
      const result = await sdk.native.sessions.list(
        nativeSessionListQuery({
          filter: sessionListQuery(),
          projectID: project.project(),
          workspaceID: project.workspace.current(),
          directory: project.instance.directory(),
          limit: 100,
        }),
      )
      const start = Date.now() - 30 * 24 * 60 * 60 * 1000
      return result.data
        .filter((session) => session.time.updated >= start)
        .map((session) => mutable<SessionV2Info>(session))
        .toSorted((a, b) => a.id.localeCompare(b.id))
    }

    function upsertSession(info: SessionV2Info) {
      const result = search(store.session, info.id, (session) => session.id)
      if (result.found) {
        setStore("session", result.index, reconcile(mutable<SessionV2Info>(info)))
        return
      }
      setStore(
        "session",
        produce((draft) => {
          draft.splice(result.index, 0, mutable<SessionV2Info>(info))
        }),
      )
    }

    event.subscribe((event, { directory, workspace }) => {
      switch (event.type) {
        case "server.instance.disposed":
          void bootstrap()
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          if (permission.mode === "auto") {
            void sdk.native.permissions.reply({
              sessionID: request.sessionID,
              requestID: request.id,
              reply: "once",
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const result = search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }
        case "session.updated": {
          void sdk.native.sessions
            .get({ sessionID: event.properties.info.id })
            .then((info) => upsertSession(mutable<SessionV2Info>(info)))
            .catch(() => undefined)
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.location.directory = event.properties.location.directory
              session.subpath = event.properties.subdirectory
              session.location.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "lsp.updated": {
          void sdk.native.lsp.status().then((x) => setStore("lsp", x.data))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const catalogPromise = Promise.all([data.location.catalog.refresh(), data.location.integration.refresh()])
      const capabilitiesPromise = sdk.native.capabilities.get().catch(() => undefined)
      const consoleStatePromise = sdk.native.console
        .get({ location: { workspace } })
        .then((x) => ({ ...x.data, consoleManagedProviders: [...x.data.consoleManagedProviders] }))
        .catch(() => emptyConsoleState)
      const agentsPromise = data.location.agent.refresh()
      const configPromise = sdk.native.config.get({ location: { workspace } }).then((result) => result.data as Config)
      await Promise.all([
        catalogPromise,
        capabilitiesPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const configResponse = configPromise
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            capabilitiesResponse,
            consoleStateResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const capabilities = responses[0]
            const consoleState = responses[1]
            const config = responses[2]
            const sessions = responses[3]

            batch(() => {
              setStore("capabilities", "experimentalBackgroundSubagents", capabilities?.backgroundSubagents === true)
              setStore("console_state", reconcile(consoleState))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue ? [] : [sessionListPromise.then((sessions) => setStore("session", reconcile(sessions)))]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            data.location.command.refresh(),
            sdk.native.lsp.status().then((x) => setStore("lsp", reconcile(x.data.map((item) => ({ ...item }))))),
            sdk.native.mcps.status().then((x) => setStore("mcp", reconcile(x.data))),
            sdk.native.mcps.resources().then((x) => setStore("mcp_resource", reconcile(x.data))),
            sdk.native.formatters
              .status({ location: { workspace } })
              .then((x) =>
                setStore("formatter", reconcile(x.data.map((item) => ({ ...item, extensions: [...item.extensions] })))),
              ),
            sdk.native.sessions.active().then((active) => {
              const status = Object.fromEntries(
                Object.keys(active).map((sessionID) => [sessionID, { type: "busy" as const }]),
              )
              setStore("session_status", reconcile(status))
            }),
            sdk.native.vcs.get({ location: { workspace } }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          console.error("tui bootstrap failed", {
            error: e instanceof Error ? e.message : String(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = (data.session.message.list(sessionID) ?? []).toSorted(
            (left, right) => left.time.created - right.time.created || left.id.localeCompare(right.id),
          )
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.type === "assistant" || last.type === "shell") return last.time.completed ? "idle" : "working"
          return last.type === "user" ? "working" : "idle"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const task = (async () => {
            const [session, , todo] = await Promise.all([
              sdk.native.sessions.get({ sessionID }),
              data.session.message.refresh(sessionID).catch(() => undefined),
              sdk.native.sessions.todo({ sessionID }),
            ])
            setStore(
              produce((draft) => {
                const match = search(draft.session, sessionID, (s) => s.id)
                const sessionInfo = mutable<SessionV2Info>(session)
                if (match.found) draft.session[match.index] = sessionInfo
                if (!match.found) draft.session.splice(match.index, 0, sessionInfo)
                draft.todo[sessionID] = [...todo]
                draft.session_diff[sessionID] = []
              }),
            )
            fullSyncedSessions.add(sessionID)
          })().finally(() => {
            syncingSessions.delete(sessionID)
          })
          syncingSessions.set(sessionID, task)
          return task
        },
      },
      bootstrap,
    }
    return result
  },
})
