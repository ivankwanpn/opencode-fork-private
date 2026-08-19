import { Binary } from "@opencode-ai/core/util/binary"
import { produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type {
  PermissionV2Request,
  Project,
  QuestionV2Request,
  Session,
  SessionNextSessionSnapshot,
  SessionNextStatusInfo,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import type { EventSessionNextDiff } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import type { State, VcsCache } from "./types"
import { trimSessions } from "./session-trim"
import { dropSessionCaches } from "./session-cache"
import { diffs as list } from "@/utils/diffs"
import { projectSessionInfo } from "@/utils/session-snapshot"

const SESSION_CONTENT_EVENTS = new Set([
  "session.next.diff",
  "todo.updated",
  "session.next.status",
  "permission.v2.asked",
  "permission.v2.replied",
  "question.v2.asked",
  "question.v2.replied",
  "question.v2.rejected",
])

export function isAgentConfigDisposal(event: { type: string; properties?: unknown }) {
  if (event.type !== "global.disposed") return false
  if (!event.properties || typeof event.properties !== "object" || Array.isArray(event.properties)) return false
  return (event.properties as Record<string, unknown>).reason === "agent-config"
}

export function applyGlobalEvent(input: {
  event: { type: string; properties?: unknown }
  project: Project[]
  setGlobalProject: (next: Project[] | ((draft: Project[]) => Project[])) => void
  refresh: () => void
  refreshConfig?: () => void
  refreshAgents?: () => void
}) {
  if (input.event.type === "global.disposed") {
    if (isAgentConfigDisposal(input.event)) {
      input.refreshConfig?.()
      input.refreshAgents?.()
      return
    }
    input.refresh()
    return
  }

  if (input.event.type === "server.connected") {
    input.refresh()
    return
  }

  if (input.event.type !== "project.updated") return
  const properties = input.event.properties as Project
  const result = Binary.search(input.project, properties.id, (s) => s.id)
  if (result.found) {
    input.setGlobalProject(
      produce((draft) => {
        draft[result.index] = { ...draft[result.index], ...properties }
      }),
    )
    return
  }
  input.setGlobalProject(
    produce((draft) => {
      draft.splice(result.index, 0, properties)
    }),
  )
}

function cleanupSessionCaches(
  setStore: SetStoreFunction<State>,
  sessionID: string,
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, [sessionID])
    }),
  )
}

export function cleanupDroppedSessionCaches(
  store: Store<State>,
  setStore: SetStoreFunction<State>,
  next: Session[],
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  const keep = new Set(next.map((item) => item.id))
  const stale = [
    ...Object.keys(store.message),
    ...Object.keys(store.session_diff),
    ...Object.keys(store.todo),
    ...Object.keys(store.permission),
    ...Object.keys(store.question),
    ...Object.keys(store.session_status),
    ...Object.values(store.part)
      .map((parts) => parts?.find((part) => !!part?.sessionID)?.sessionID)
      .filter((sessionID): sessionID is string => !!sessionID),
  ].filter((sessionID, index, list) => !keep.has(sessionID) && list.indexOf(sessionID) === index)
  if (stale.length === 0) return
  for (const sessionID of stale) {
    setSessionTodo?.(sessionID, undefined)
  }
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, stale)
    }),
  )
}

export function applyDirectoryEvent(input: {
  event: { type: string; properties?: unknown }
  store: Store<State>
  setStore: SetStoreFunction<State>
  push: (directory: string) => void
  directory: string
  loadLsp: () => void
  loadReferences?: () => void
  vcsCache?: VcsCache
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
  retainedLimit?: number
  sessionContent?: boolean
  permission?: State["permission"]
}) {
  const event = input.event
  if (input.sessionContent === false && SESSION_CONTENT_EVENTS.has(event.type)) return
  const limit = Math.max(input.store.limit, input.retainedLimit ?? 0)
  switch (event.type) {
    case "server.instance.disposed": {
      input.push(input.directory)
      return
    }
    case "session.next.created": {
      const info = projectSessionInfo((event.properties as { info: SessionNextSessionSnapshot }).info)
      applyDirectorySessionCreated({
        info,
        store: input.store,
        setStore: input.setStore,
        limit,
        permission: input.permission,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.next.updated": {
      const info = projectSessionInfo((event.properties as { info: SessionNextSessionSnapshot }).info)
      const result = Binary.search(input.store.session, info.id, (s) => s.id)
      if (info.time.archived) {
        if (!result.found) break
        if (input.store.session[result.index]!.time.archived === info.time.archived) break
        input.setStore(
          "session",
          produce((draft) => {
            draft.splice(result.index, 1)
          }),
        )
        cleanupSessionCaches(input.setStore, info.id, input.setSessionTodo)
        if (info.parentID) break
        input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
        break
      }
      if (result.found) {
        input.setStore("session", result.index, reconcile(info))
        break
      }
      const next = input.store.session.slice()
      next.splice(result.index, 0, info)
      const trimmed = trimSessions(next, { limit, permission: input.permission ?? input.store.permission })
      input.setStore("session", reconcile(trimmed, { key: "id" }))
      cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
      break
    }
    case "session.next.deleted": {
      const properties = event.properties as { sessionID: string; info: SessionNextSessionSnapshot }
      const sessionID = properties.sessionID
      const result = Binary.search(input.store.session, sessionID, (s) => s.id)
      const info = projectSessionInfo(properties.info)
      if (result.found) {
        input.setStore(
          "session",
          produce((draft) => {
            draft.splice(result.index, 1)
          }),
        )
      }
      cleanupSessionCaches(input.setStore, sessionID, input.setSessionTodo)
      if (info?.parentID) break
      input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
      break
    }
    case "session.renamed": {
      const properties = event.properties as { sessionID: string; title: string }
      const result = Binary.search(input.store.session, properties.sessionID, (session) => session.id)
      if (!result.found) break
      input.setStore("session", result.index, (session) => ({
        ...session,
        title: properties.title,
        time: { ...session.time, updated: Date.now() },
      }))
      break
    }
    case "session.usage.updated": {
      const properties = event.properties as Pick<Session, "cost" | "tokens"> & { sessionID: string }
      const result = Binary.search(input.store.session, properties.sessionID, (session) => session.id)
      if (!result.found) break
      input.setStore("session", result.index, (session) => ({
        ...session,
        cost: properties.cost,
        tokens: properties.tokens,
      }))
      break
    }
    case "session.archived": {
      const properties = event.properties as { sessionID: string }
      const result = Binary.search(input.store.session, properties.sessionID, (session) => session.id)
      if (!result.found) break
      const info = input.store.session[result.index]
      input.setStore(
        "session",
        produce((draft) => void draft.splice(result.index, 1)),
      )
      cleanupSessionCaches(input.setStore, properties.sessionID)
      if (!info?.parentID) input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
      break
    }
    case "session.moved": {
      const properties = event.properties as {
        sessionID: string
        location: { directory: string; workspaceID?: string }
        projectID?: string
        subpath?: string
      }
      const result = Binary.search(input.store.session, properties.sessionID, (session) => session.id)
      if (!result.found) break
      if (properties.location.directory === input.directory) {
        input.setStore("session", result.index, (session) => ({
          ...session,
          projectID: properties.projectID ?? session.projectID,
          workspaceID: properties.location.workspaceID,
          directory: properties.location.directory,
          path: properties.subpath,
          time: { ...session.time, updated: Date.now() },
        }))
        break
      }
      const info = input.store.session[result.index]
      input.setStore(
        "session",
        produce((draft) => void draft.splice(result.index, 1)),
      )
      if (!info?.parentID) input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
      break
    }
    case "session.next.diff": {
      const props = event.properties as EventSessionNextDiff["properties"]
      input.setStore("session_diff", props.sessionID, reconcile(list(props.diff) as FileDiffInfo[], { key: "file" }))
      break
    }
    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      input.setStore("todo", props.sessionID, reconcile(props.todos, { key: "id" }))
      input.setSessionTodo?.(props.sessionID, props.todos)
      break
    }
    case "session.next.status": {
      const props = event.properties as { sessionID: string; status: SessionNextStatusInfo }
      input.setStore("session_status", props.sessionID, reconcile(props.status))
      break
    }
    case "vcs.branch.updated": {
      const props = event.properties as { branch?: string }
      if (input.store.vcs?.branch === props.branch) break
      const next = { ...input.store.vcs, branch: props.branch }
      input.setStore("vcs", next)
      if (input.vcsCache) input.vcsCache.setStore("value", next)
      break
    }
    case "permission.v2.asked": {
      const permission = event.properties as PermissionV2Request
      const permissions = input.store.permission[permission.sessionID]
      if (!permissions) {
        input.setStore("permission", permission.sessionID, [permission])
        break
      }
      const result = Binary.search(permissions, permission.id, (p) => p.id)
      if (result.found) {
        input.setStore("permission", permission.sessionID, result.index, reconcile(permission))
        break
      }
      input.setStore(
        "permission",
        permission.sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, permission)
        }),
      )
      break
    }
    case "permission.v2.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      const permissions = input.store.permission[props.sessionID]
      if (!permissions) break
      const result = Binary.search(permissions, props.requestID, (p) => p.id)
      if (!result.found) break
      input.setStore(
        "permission",
        props.sessionID,
        produce((draft) => {
          draft.splice(result.index, 1)
        }),
      )
      break
    }
    case "question.v2.asked": {
      const question = event.properties as QuestionV2Request
      const questions = input.store.question[question.sessionID]
      if (!questions) {
        input.setStore("question", question.sessionID, [question])
        break
      }
      const result = Binary.search(questions, question.id, (q) => q.id)
      if (result.found) {
        input.setStore("question", question.sessionID, result.index, reconcile(question))
        break
      }
      input.setStore(
        "question",
        question.sessionID,
        produce((draft) => {
          draft.splice(result.index, 0, question)
        }),
      )
      break
    }
    case "question.v2.replied":
    case "question.v2.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      const questions = input.store.question[props.sessionID]
      if (!questions) break
      const result = Binary.search(questions, props.requestID, (q) => q.id)
      if (!result.found) break
      input.setStore(
        "question",
        props.sessionID,
        produce((draft) => {
          draft.splice(result.index, 1)
        }),
      )
      break
    }
    case "lsp.updated": {
      input.loadLsp()
      break
    }
    case "reference.updated": {
      input.loadReferences?.()
      break
    }
  }
}

export function applyDirectorySessionCreated(input: {
  info: Session
  store: Store<State>
  setStore: SetStoreFunction<State>
  limit: number
  permission?: State["permission"]
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (session) => session.id)
  if (result.found) {
    input.setStore("session", result.index, reconcile(input.info))
    return
  }
  const next = input.store.session.slice()
  next.splice(result.index, 0, input.info)
  const trimmed = trimSessions(next, {
    limit: input.limit,
    permission: input.permission ?? input.store.permission,
  })
  input.setStore("session", reconcile(trimmed, { key: "id" }))
  cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
  if (!input.info.parentID) input.setStore("sessionTotal", (value) => value + 1)
}
