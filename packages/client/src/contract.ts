import { makeDefaultApi } from "@opencode-ai/protocol/api"
import { InvalidRequestError, SessionNotFoundError } from "@opencode-ai/protocol/errors"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

class LocationMiddleware extends HttpApiMiddleware.Service<LocationMiddleware>()(
  "@opencode-ai/client/LocationMiddleware",
) {}

class SessionLocationMiddleware extends HttpApiMiddleware.Service<SessionLocationMiddleware>()(
  "@opencode-ai/client/SessionLocationMiddleware",
  { error: [InvalidRequestError, SessionNotFoundError] },
) {}

export const ClientApi = makeDefaultApi({
  locationMiddleware: LocationMiddleware,
  sessionLocationMiddleware: SessionLocationMiddleware,
})

export const groupNames = {
  "server.health": "health",
  "server.location": "location",
  "server.path": "path",
  "server.agent": "agents",
  "server.session": "sessions",
  "server.message": "messages",
  "server.model": "models",
  "server.provider": "providers",
  "server.integration": "integrations",
  "server.credential": "credentials",
  "server.permission": "permissions",
  "server.fs": "files",
  "server.command": "commands",
  "server.skill": "skills",
  "server.event": "events",
  "server.pty": "ptys",
  "server.question": "questions",
  "server.reference": "references",
  "server.projectCopy": "projectCopies",
  "server.mcp": "mcps",
  "server.lsp": "lsp",
  "server.project": "projects",
  "server.worktree": "worktrees",
  "server.capability": "capabilities",
  "server.vcs": "vcs",
  "server.formatter": "formatters",
  "server.console": "console",
  "server.config": "config",
  "server.workspace": "workspaces",
  "server.controlPlane": "controlPlane",
} as const

export const endpointNames = {
  "provider.custom.discover": "discoverCustom",
  "provider.custom.configure": "configureCustom",
  "session.messages": "list",
  "session.input.list": "inputList",
  "session.input.get": "inputGet",
  "session.input.promote": "inputPromote",
  "session.input.cancel": "inputCancel",
  "integration.connect.key": "connectKey",
  "integration.connect.oauth": "connectOauth",
  "integration.attempt.status": "attemptStatus",
  "integration.attempt.complete": "attemptComplete",
  "integration.attempt.cancel": "attemptCancel",
  "permission.request.list": "listRequests",
  "permission.saved.list": "listSaved",
  "permission.saved.remove": "removeSaved",
  "question.request.list": "listRequests",
  "console.org.list": "listOrgs",
  "console.org.switch": "switchOrg",
  "workspace.adapter.list": "listAdapters",
  "workspace.syncList": "syncList",
} as const

export const omitEndpoints = new Set(["pty.connect", "pty.connectToken"])
