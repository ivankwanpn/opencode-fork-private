import type { OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { createCustomProviderApi, type CustomProviderApi } from "./custom-provider-api"
import { OpenCode } from "../../../client/src"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): ServerApi {
  const clientOptions = {
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  }
  const current = OpenCode.make(clientOptions)
  const custom = createCustomProviderApi(clientOptions)
  const prompt = async (
    value: Parameters<OpenCodeClient["session"]["prompt"]>[0] & {
      context?: Parameters<CurrentClient["sessions"]["prompt"]>[0]["prompt"]["context"]
      expectedActiveAttemptID?: string
      model?: { providerID: string; modelID: string; protocol?: CustomProvider.Protocol }
      variant?: string
    },
    requestOptions?: Parameters<OpenCodeClient["session"]["prompt"]>[1],
  ) => {
    const result = await current.sessions.prompt(
      {
        sessionID: value.sessionID,
        id: value.id,
        prompt: {
          text: value.text,
          context: value.context,
          files: value.files?.map((file) => ({
            uri: file.uri,
            name: file.name,
            description: file.description,
            source: file.mention,
          })),
          agents: value.agents?.map((agent) => ({
            name: agent.name,
            source: agent.mention,
          })),
        },
        model: value.model
          ? {
              id: value.model.modelID,
              providerID: value.model.providerID,
              variant: value.variant,
              protocol: value.model.protocol,
            }
          : undefined,
        delivery: value.delivery,
        expectedActiveAttemptID: value.expectedActiveAttemptID,
        resume: value.resume,
      },
      requestOptions,
    )
    return {
      admittedSeq: result.admittedSeq,
      id: result.id,
      sessionID: result.sessionID,
      timeCreated: result.timeCreated,
      type: "user",
      data: { text: value.text },
      delivery: result.delivery,
    }
  }

  const connectToken: OpenCodeClient["pty"]["connectToken"] = async (value, requestOptions) => {
    const url = new URL(`/api/pty/${encodeURIComponent(value.ptyID)}/connect-token`, input.server.url)
    if (value.location?.directory !== undefined)
      url.searchParams.set("location[directory]", value.location.directory)
    if (value.location?.workspace !== undefined)
      url.searchParams.set("location[workspace]", value.location.workspace)
    const headers = new Headers(clientOptions.headers)
    for (const [key, header] of new Headers(requestOptions?.headers)) headers.set(key, header)
    headers.set("x-opencode-ticket", value["x-opencode-ticket"] ?? "1")
    const response = await (input.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      signal: requestOptions?.signal,
      headers,
    })
    const result: unknown = await response.json()
    if (!response.ok) throw result
    return result as Awaited<ReturnType<OpenCodeClient["pty"]["connectToken"]>>
  }

  const shell = (
    value: Parameters<OpenCodeClient["session"]["shell"]>[0] & {
      agent?: string
      model?: { providerID: string; modelID: string; protocol?: CustomProvider.Protocol }
      variant?: string
      resume?: boolean
    },
    requestOptions?: Parameters<OpenCodeClient["session"]["shell"]>[1],
  ) =>
    current.sessions.shell(
      {
        sessionID: value.sessionID,
        id: value.id,
        userID: undefined,
        command: value.command,
        agent: value.agent,
        model: value.model
          ? {
              id: value.model.modelID,
              providerID: value.model.providerID,
              variant: value.variant,
              protocol: value.model.protocol,
            }
          : undefined,
        resume: value.resume,
      },
      requestOptions,
    )

  const rename: OpenCodeClient["session"]["rename"] = (value, requestOptions) =>
    current.sessions.update({ sessionID: value.sessionID, title: value.title }, requestOptions).then(() => undefined)
  const archive: OpenCodeClient["session"]["archive"] = (value, requestOptions) =>
    current.sessions.update({ sessionID: value.sessionID, archived: Date.now() }, requestOptions).then(() => undefined)
  const listMcp: OpenCodeClient["mcp"]["list"] = async (value, requestOptions) => {
    const result = await current.mcps.status(value, requestOptions)
    return {
      location: result.location,
      data: Object.entries(result.data).map(([name, status]) => ({ name, status })),
    }
  }
  const connectMcp: OpenCodeClient["mcp"]["connect"] = (value, requestOptions) =>
    current.mcps.connect({ name: value.server, location: value.location }, requestOptions)
  const disconnectMcp: OpenCodeClient["mcp"]["disconnect"] = (value, requestOptions) =>
    current.mcps.disconnect({ name: value.server, location: value.location }, requestOptions)
  const authenticateMcp: CurrentClient["mcps"]["authenticate"] = (value, requestOptions) =>
    current.mcps.authenticate(value, requestOptions)
  const catalogMcp: OpenCodeClient["mcp"]["resource"]["catalog"] = async (value, requestOptions) => {
    const result = await current.mcps.resources(value, requestOptions)
    return {
      location: result.location,
      data: {
        resources: Object.values(result.data).map((resource) => ({
          name: resource.name,
          uri: resource.uri,
          description: resource.description,
          mimeType: resource.mimeType,
          server: resource.client,
        })),
        templates: [],
      },
    }
  }
  const readFile: ServerApi["file"]["read"] = async (value, requestOptions) => {
    const result = await current.files.read(
      { path: value.path, location: value.location },
      requestOptions,
    )
    return {
      location: result.location,
      data: {
        type: result.data.encoding === "utf8" ? "text" : "binary",
        content: result.data.content,
        encoding: result.data.encoding === "base64" ? "base64" : undefined,
        mimeType: result.data.mime,
      },
    }
  }
  const projectInfo = (value: Awaited<ReturnType<CurrentClient["projects"]["update"]>>) => ({
    ...value,
    sandboxes: [...value.sandboxes],
  })
  const projectList: ServerApi["project"]["list"] = async (requestOptions) =>
    (await current.projects.list(requestOptions)).map(projectInfo)
  const projectCurrent: ServerApi["project"]["current"] = (value, requestOptions) =>
    current.projects.current(value, requestOptions)
  const projectUpdate: ServerApi["project"]["update"] = async (value, requestOptions) =>
    projectInfo(await current.projects.update(value, requestOptions))
  const projectDirectories: ServerApi["project"]["directories"] = async (value, requestOptions) =>
    (await current.projects.directories(value, requestOptions)).data.map((item) => ({ ...item }))
  const projectInitGit: ServerApi["project"]["initGit"] = async (value, requestOptions) =>
    projectInfo(await current.projects.initGit(value, requestOptions))

  return {
    health: current.health,
    location: current.location,
    agent: current.agents,
    session: {
      ...current.sessions,
      rename,
      archive,
      prompt,
      shell,
      revert: {
        stage: current.sessions.stage,
        clear: current.sessions.clear,
        commit: current.sessions.commit,
      },
    },
    message: current.messages,
    model: current.models,
    provider: current.providers,
    plugins: current["server.plugins"],
    integration: {
      list: current.integrations.list,
      get: current.integrations.get,
      connect: {
        key: current.integrations.connectKey,
      },
      oauth: {
        connect: current.integrations.connectOauth,
        status: current.integrations.attemptStatus,
        complete: current.integrations.attemptComplete,
        cancel: current.integrations.attemptCancel,
      },
    },
    credential: current.credentials,
    permission: {
      request: {
        list: current.permissions.listRequests,
      },
      saved: {
        list: current.permissions.listSaved,
        remove: current.permissions.removeSaved,
      },
      create: current.permissions.create,
      list: current.permissions.list,
      get: current.permissions.get,
      reply: current.permissions.reply,
    },
    file: {
      ...current.files,
      read: readFile,
    },
    command: current.commands,
    skill: current.skills,
    mcp: {
      list: listMcp,
      connect: connectMcp,
      disconnect: disconnectMcp,
      authenticate: authenticateMcp,
      resource: {
        catalog: catalogMcp,
      },
    },
    worktree: current.worktrees,
    project: {
      list: projectList,
      current: projectCurrent,
      update: projectUpdate,
      directories: projectDirectories,
      initGit: projectInitGit,
    },
    vcs: current.vcs,
    path: current.path,
    event: {
      subscribe: current.events.subscribe,
    },
    pty: {
      ...current.ptys,
      connectToken,
    },
    question: {
      request: {
        list: current.questions.listRequests,
      },
      list: current.questions.list,
      reply: current.questions.reply,
      reject: current.questions.reject,
    },
    reference: current.references,
    projectCopy: current.projectCopies,
    config: current.config,
    lsp: current.lsp,
    providers: {
      list: current.providers.list,
      get: current.providers.get,
      ...custom,
    },
  } as unknown as ServerApi
}

type CurrentClient = ReturnType<typeof OpenCode.make>
type CompatibleProjectInfo = Omit<Awaited<ReturnType<CurrentClient["projects"]["update"]>>, "sandboxes"> & {
  readonly sandboxes: string[]
}
type CompatibleProjectApi = Omit<OpenCodeClient["project"], "list" | "update"> & {
  readonly list: (
    requestOptions?: Parameters<OpenCodeClient["project"]["list"]>[0],
  ) => Promise<CompatibleProjectInfo[]>
  readonly update: (
    input: Parameters<OpenCodeClient["project"]["update"]>[0],
    requestOptions?: Parameters<OpenCodeClient["project"]["update"]>[1],
  ) => Promise<CompatibleProjectInfo>
  readonly initGit: (
    input?: Parameters<CurrentClient["projects"]["initGit"]>[0],
    requestOptions?: Parameters<CurrentClient["projects"]["initGit"]>[1],
  ) => Promise<CompatibleProjectInfo>
}
type CompatibleLocationApi = OpenCodeClient["location"] & Pick<CurrentClient["location"], "dispose">
type CompatibleMcpApi = OpenCodeClient["mcp"] & {
  readonly authenticate: CurrentClient["mcps"]["authenticate"]
}

export type ServerApi = Omit<OpenCodeClient, "file" | "session" | "location" | "project" | "worktree"> & {
  readonly session: OpenCodeClient["session"] &
    Pick<
      CurrentClient["sessions"],
      "share" | "unshare" | "inputList" | "inputGet" | "inputPromote" | "inputCancel" | "todo"
    >
  readonly location: CompatibleLocationApi
  readonly mcp: CompatibleMcpApi
  readonly project: CompatibleProjectApi
  readonly worktree: CurrentClient["worktrees"]
  readonly file: Omit<OpenCodeClient["file"], "read"> & {
    readonly read: (
      input: Parameters<OpenCodeClient["file"]["read"]>[0],
      requestOptions?: Parameters<OpenCodeClient["file"]["read"]>[1],
    ) => Promise<{
      readonly location: Awaited<ReturnType<CurrentClient["files"]["read"]>>["location"]
      readonly data: {
        readonly type: "text" | "binary"
        readonly content: string
        readonly encoding?: "base64"
        readonly mimeType?: string
      }
    }>
  }
  readonly providers: OpenCodeClient["provider"] & CustomProviderApi
  readonly plugins: CurrentClient["server.plugins"]
  readonly config: CurrentClient["config"]
  readonly lsp: CurrentClient["lsp"]
}
