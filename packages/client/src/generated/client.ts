import type {
  HealthGetOutput,
  LocationGetInput,
  LocationGetOutput,
  LocationDisposeInput,
  LocationDisposeOutput,
  PathGetInput,
  PathGetOutput,
  AgentsListInput,
  AgentsListOutput,
  SessionsListInput,
  SessionsListOutput,
  SessionsCreateInput,
  SessionsCreateOutput,
  SessionsActiveOutput,
  SessionsGetInput,
  SessionsGetOutput,
  SessionsChildrenInput,
  SessionsChildrenOutput,
  SessionsTodoInput,
  SessionsTodoOutput,
  SessionsForkInput,
  SessionsForkOutput,
  SessionsUpdateInput,
  SessionsUpdateOutput,
  SessionsRemoveInput,
  SessionsRemoveOutput,
  SessionsShareInput,
  SessionsShareOutput,
  SessionsUnshareInput,
  SessionsUnshareOutput,
  SessionsSwitchAgentInput,
  SessionsSwitchAgentOutput,
  SessionsSwitchModelInput,
  SessionsSwitchModelOutput,
  SessionsPromptInput,
  SessionsPromptOutput,
  SessionsDiffInput,
  SessionsDiffOutput,
  SessionsInputListInput,
  SessionsInputListOutput,
  SessionsInputGetInput,
  SessionsInputGetOutput,
  SessionsInputPromoteInput,
  SessionsInputPromoteOutput,
  SessionsInputCancelInput,
  SessionsInputCancelOutput,
  SessionsBackgroundInput,
  SessionsBackgroundOutput,
  SessionsCommandInput,
  SessionsCommandOutput,
  SessionsShellInput,
  SessionsShellOutput,
  SessionsCompactInput,
  SessionsCompactOutput,
  SessionsWaitInput,
  SessionsWaitOutput,
  SessionsStageInput,
  SessionsStageOutput,
  SessionsClearInput,
  SessionsClearOutput,
  SessionsCommitInput,
  SessionsCommitOutput,
  SessionsContextInput,
  SessionsContextOutput,
  SessionsHistoryInput,
  SessionsHistoryOutput,
  SessionsEventsInput,
  SessionsEventsOutput,
  SessionsInterruptInput,
  SessionsInterruptOutput,
  SessionsMessageInput,
  SessionsMessageOutput,
  MessagesListInput,
  MessagesListOutput,
  ModelsListInput,
  ModelsListOutput,
  ProvidersCatalogInput,
  ProvidersCatalogOutput,
  ProvidersListInput,
  ProvidersListOutput,
  ProvidersGetInput,
  ProvidersGetOutput,
  ProvidersDiscoverCustomInput,
  ProvidersDiscoverCustomOutput,
  ProvidersConfigureCustomInput,
  ProvidersConfigureCustomOutput,
  IntegrationsListInput,
  IntegrationsListOutput,
  IntegrationsGetInput,
  IntegrationsGetOutput,
  IntegrationsConnectKeyInput,
  IntegrationsConnectKeyOutput,
  IntegrationsConnectOauthInput,
  IntegrationsConnectOauthOutput,
  IntegrationsAttemptStatusInput,
  IntegrationsAttemptStatusOutput,
  IntegrationsAttemptCompleteInput,
  IntegrationsAttemptCompleteOutput,
  IntegrationsAttemptCancelInput,
  IntegrationsAttemptCancelOutput,
  CredentialsUpdateInput,
  CredentialsUpdateOutput,
  CredentialsRemoveInput,
  CredentialsRemoveOutput,
  PermissionsListRequestsInput,
  PermissionsListRequestsOutput,
  PermissionsListSavedInput,
  PermissionsListSavedOutput,
  PermissionsRemoveSavedInput,
  PermissionsRemoveSavedOutput,
  PermissionsCreateInput,
  PermissionsCreateOutput,
  PermissionsListInput,
  PermissionsListOutput,
  PermissionsGetInput,
  PermissionsGetOutput,
  PermissionsReplyInput,
  PermissionsReplyOutput,
  FilesReadInput,
  FilesReadOutput,
  FilesListInput,
  FilesListOutput,
  FilesFindInput,
  FilesFindOutput,
  CommandsListInput,
  CommandsListOutput,
  SkillsListInput,
  SkillsListOutput,
  McpsStatusInput,
  McpsStatusOutput,
  McpsResourcesInput,
  McpsResourcesOutput,
  McpsConnectInput,
  McpsConnectOutput,
  McpsDisconnectInput,
  McpsDisconnectOutput,
  McpsAuthenticateInput,
  McpsAuthenticateOutput,
  LspStatusInput,
  LspStatusOutput,
  ProjectsListOutput,
  ProjectsInitGitInput,
  ProjectsInitGitOutput,
  ProjectsCurrentInput,
  ProjectsCurrentOutput,
  ProjectsUpdateInput,
  ProjectsUpdateOutput,
  ProjectsDirectoriesInput,
  ProjectsDirectoriesOutput,
  WorktreesCreateInput,
  WorktreesCreateOutput,
  WorktreesRemoveInput,
  WorktreesRemoveOutput,
  WorktreesResetInput,
  WorktreesResetOutput,
  CapabilitiesGetOutput,
  VcsGetInput,
  VcsGetOutput,
  VcsStatusInput,
  VcsStatusOutput,
  VcsDiffInput,
  VcsDiffOutput,
  FormattersStatusInput,
  FormattersStatusOutput,
  ConsoleGetInput,
  ConsoleGetOutput,
  ConsoleListOrgsInput,
  ConsoleListOrgsOutput,
  ConsoleSwitchOrgInput,
  ConsoleSwitchOrgOutput,
  ConfigGetInput,
  ConfigGetOutput,
  ConfigUpdateInput,
  ConfigUpdateOutput,
  WorkspacesListAdaptersInput,
  WorkspacesListAdaptersOutput,
  WorkspacesListInput,
  WorkspacesListOutput,
  WorkspacesCreateInput,
  WorkspacesCreateOutput,
  WorkspacesRemoveInput,
  WorkspacesRemoveOutput,
  WorkspacesStatusInput,
  WorkspacesStatusOutput,
  WorkspacesSyncListInput,
  WorkspacesSyncListOutput,
  WorkspacesStartInput,
  WorkspacesStartOutput,
  WorkspacesWarpInput,
  WorkspacesWarpOutput,
  ControlPlaneMoveSessionInput,
  ControlPlaneMoveSessionOutput,
  ServerPluginsListOutput,
  ServerPluginsAddInput,
  ServerPluginsAddOutput,
  ServerPluginsRefreshInput,
  ServerPluginsRefreshOutput,
  ServerPluginsRemoveInput,
  ServerPluginsRemoveOutput,
  ServerPluginsInstallInput,
  ServerPluginsInstallOutput,
  ServerPluginsUninstallInput,
  ServerPluginsUninstallOutput,
  ServerPluginsEnableInput,
  ServerPluginsEnableOutput,
  ServerPluginsDisableInput,
  ServerPluginsDisableOutput,
  EventsSubscribeOutput,
  PtysShellsInput,
  PtysShellsOutput,
  PtysListInput,
  PtysListOutput,
  PtysCreateInput,
  PtysCreateOutput,
  PtysGetInput,
  PtysGetOutput,
  PtysUpdateInput,
  PtysUpdateOutput,
  PtysRemoveInput,
  PtysRemoveOutput,
  QuestionsListRequestsInput,
  QuestionsListRequestsOutput,
  QuestionsListInput,
  QuestionsListOutput,
  QuestionsReplyInput,
  QuestionsReplyOutput,
  QuestionsRejectInput,
  QuestionsRejectOutput,
  ReferencesListInput,
  ReferencesListOutput,
  ProjectCopiesGenerateNameInput,
  ProjectCopiesGenerateNameOutput,
  ProjectCopiesCreateInput,
  ProjectCopiesCreateOutput,
  ProjectCopiesRemoveInput,
  ProjectCopiesRemoveOutput,
  ProjectCopiesRefreshInput,
  ProjectCopiesRefreshOutput,
} from "./types"
import { ClientError } from "./client-error"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly headers?: HeadersInit
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: HeadersInit
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    const url = new URL(descriptor.path, options.baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        signal: requestOptions?.signal,
        headers,
        body: descriptor.body === undefined ? undefined : JSON.stringify(descriptor.body),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status)) throw await json(response)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status } })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  const sse = <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): AsyncIterable<A> => ({
    async *[Symbol.asyncIterator]() {
      const response = await execute(descriptor, requestOptions)
      if (response.status !== descriptor.successStatus) await responseError(response, descriptor)
      if (!isContentType(response, "text/event-stream")) {
        try {
          await response.body?.cancel()
        } catch {}
        throw new ClientError("UnsupportedContentType")
      }
      if (response.body === null) throw new ClientError("MalformedResponse")
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        while (true) {
          let next
          try {
            next = await reader.read()
          } catch (cause) {
            throw new ClientError("Transport", { cause })
          }
          buffer += decoder.decode(next.value, { stream: !next.done })
          if (buffer.length > 1_048_576) throw new ClientError("MalformedResponse")
          const trailingCarriageReturn = !next.done && buffer.endsWith("\r")
          if (trailingCarriageReturn) buffer = buffer.slice(0, -1)
          buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
          if (trailingCarriageReturn) buffer += "\r"
          if (next.done && buffer !== "") buffer += "\n\n"
          let boundary = buffer.indexOf("\n\n")
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = block
              .split("\n")
              .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []))
              .join("\n")
            if (data !== "") {
              try {
                yield JSON.parse(data) as A
              } catch (cause) {
                throw new ClientError("MalformedResponse", { cause })
              }
            }
            boundary = buffer.indexOf("\n\n")
          }
          if (next.done) return
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        reader.releaseLock()
      }
    },
  })

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/api/health`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    location: {
      get: (input?: LocationGetInput, requestOptions?: RequestOptions) =>
        request<LocationGetOutput>(
          {
            method: "GET",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      dispose: (input?: LocationDisposeInput, requestOptions?: RequestOptions) =>
        request<LocationDisposeOutput>(
          {
            method: "DELETE",
            path: `/api/location`,
            query: { location: input?.["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    path: {
      get: (input?: PathGetInput, requestOptions?: RequestOptions) =>
        request<PathGetOutput>(
          {
            method: "GET",
            path: `/api/path`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    agents: {
      list: (input?: AgentsListInput, requestOptions?: RequestOptions) =>
        request<AgentsListOutput>(
          {
            method: "GET",
            path: `/api/agent`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    sessions: {
      list: (input?: SessionsListInput, requestOptions?: RequestOptions) =>
        request<SessionsListOutput>(
          {
            method: "GET",
            path: `/api/session`,
            query: {
              workspace: input?.["workspace"],
              limit: input?.["limit"],
              order: input?.["order"],
              search: input?.["search"],
              parentID: input?.["parentID"],
              directory: input?.["directory"],
              project: input?.["project"],
              subpath: input?.["subpath"],
              cursor: input?.["cursor"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: SessionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session`,
            body: {
              id: input?.["id"],
              agent: input?.["agent"],
              model: input?.["model"],
              location: input?.["location"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      active: (requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsActiveOutput }>(
          {
            method: "GET",
            path: `/api/session/active`,
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: SessionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      children: (input: SessionsChildrenInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsChildrenOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/children`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      todo: (input: SessionsTodoInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsTodoOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/todo`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      fork: (input: SessionsForkInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsForkOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/fork`,
            body: { messageID: input["messageID"] },
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      update: (input: SessionsUpdateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsUpdateOutput }>(
          {
            method: "PATCH",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            body: { title: input["title"], archived: input["archived"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      remove: (input: SessionsRemoveInput, requestOptions?: RequestOptions) =>
        request<SessionsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      share: (input: SessionsShareInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsShareOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/share`,
            successStatus: 200,
            declaredStatuses: [503, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      unshare: (input: SessionsUnshareInput, requestOptions?: RequestOptions) =>
        request<SessionsUnshareOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/share`,
            successStatus: 204,
            declaredStatuses: [503, 404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchAgent: (input: SessionsSwitchAgentInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchAgentOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/agent`,
            body: { agent: input["agent"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      switchModel: (input: SessionsSwitchModelInput, requestOptions?: RequestOptions) =>
        request<SessionsSwitchModelOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/model`,
            body: { model: input["model"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      prompt: (input: SessionsPromptInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsPromptOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/prompt`,
            body: {
              id: input["id"],
              prompt: input["prompt"],
              model: input["model"],
              delivery: input["delivery"],
              expectedActiveAttemptID: input["expectedActiveAttemptID"],
              resume: input["resume"],
            },
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      diff: (input: SessionsDiffInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsDiffOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/diff`,
            query: { messageID: input["messageID"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputList: (input: SessionsInputListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsInputListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input`,
            query: { delivery: input["delivery"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputGet: (input: SessionsInputGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsInputGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input/${encodeURIComponent(input.inputID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputPromote: (input: SessionsInputPromoteInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsInputPromoteOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input/${encodeURIComponent(input.inputID)}/promote`,
            successStatus: 200,
            declaredStatuses: [409, 404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      inputCancel: (input: SessionsInputCancelInput, requestOptions?: RequestOptions) =>
        request<SessionsInputCancelOutput>(
          {
            method: "DELETE",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/input/${encodeURIComponent(input.inputID)}`,
            successStatus: 204,
            declaredStatuses: [409, 404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      background: (input: SessionsBackgroundInput, requestOptions?: RequestOptions) =>
        request<SessionsBackgroundOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/background`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      command: (input: SessionsCommandInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsCommandOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/command`,
            body: {
              id: input["id"],
              command: input["command"],
              arguments: input["arguments"],
              agent: input["agent"],
              model: input["model"],
              files: input["files"],
              delivery: input["delivery"],
              expectedActiveAttemptID: input["expectedActiveAttemptID"],
              resume: input["resume"],
              commit: input["commit"],
            },
            successStatus: 200,
            declaredStatuses: [409, 400, 404, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      shell: (input: SessionsShellInput, requestOptions?: RequestOptions) =>
        request<SessionsShellOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/shell`,
            body: {
              id: input["id"],
              userID: input["userID"],
              command: input["command"],
              agent: input["agent"],
              model: input["model"],
              resume: input["resume"],
            },
            successStatus: 204,
            declaredStatuses: [503, 404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      compact: (input: SessionsCompactInput, requestOptions?: RequestOptions) =>
        request<SessionsCompactOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/compact`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      wait: (input: SessionsWaitInput, requestOptions?: RequestOptions) =>
        request<SessionsWaitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/wait`,
            successStatus: 204,
            declaredStatuses: [404, 503, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      stage: (input: SessionsStageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsStageOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/stage`,
            body: { messageID: input["messageID"], files: input["files"] },
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      clear: (input: SessionsClearInput, requestOptions?: RequestOptions) =>
        request<SessionsClearOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/clear`,
            successStatus: 204,
            declaredStatuses: [404, 500, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      commit: (input: SessionsCommitInput, requestOptions?: RequestOptions) =>
        request<SessionsCommitOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/revert/commit`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      context: (input: SessionsContextInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsContextOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/context`,
            successStatus: 200,
            declaredStatuses: [404, 500, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      history: (input: SessionsHistoryInput, requestOptions?: RequestOptions) =>
        request<SessionsHistoryOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/history`,
            query: { limit: input["limit"], after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      events: (input: SessionsEventsInput, requestOptions?: RequestOptions): AsyncIterable<SessionsEventsOutput> =>
        sse<SessionsEventsOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/event`,
            query: { after: input["after"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
      interrupt: (input: SessionsInterruptInput, requestOptions?: RequestOptions) =>
        request<SessionsInterruptOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/interrupt`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      message: (input: SessionsMessageInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: SessionsMessageOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message/${encodeURIComponent(input.messageID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
    },
    messages: {
      list: (input: MessagesListInput, requestOptions?: RequestOptions) =>
        request<MessagesListOutput>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/message`,
            query: { limit: input["limit"], order: input["order"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 404, 500, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    models: {
      list: (input?: ModelsListInput, requestOptions?: RequestOptions) =>
        request<ModelsListOutput>(
          {
            method: "GET",
            path: `/api/model`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    providers: {
      catalog: (input?: ProvidersCatalogInput, requestOptions?: RequestOptions) =>
        request<ProvidersCatalogOutput>(
          {
            method: "GET",
            path: `/api/provider/catalog`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: ProvidersListInput, requestOptions?: RequestOptions) =>
        request<ProvidersListOutput>(
          {
            method: "GET",
            path: `/api/provider`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ProvidersGetInput, requestOptions?: RequestOptions) =>
        request<ProvidersGetOutput>(
          {
            method: "GET",
            path: `/api/provider/${encodeURIComponent(input.providerID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      discoverCustom: (input: ProvidersDiscoverCustomInput, requestOptions?: RequestOptions) =>
        request<ProvidersDiscoverCustomOutput>(
          {
            method: "POST",
            path: `/api/provider/custom/discover`,
            query: { location: input["location"] },
            body: {
              protocol: input["protocol"],
              baseURL: input["baseURL"],
              apiKey: input["apiKey"],
              headers: input["headers"],
            },
            successStatus: 200,
            declaredStatuses: [400, 502, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
      configureCustom: (input: ProvidersConfigureCustomInput, requestOptions?: RequestOptions) =>
        request<ProvidersConfigureCustomOutput>(
          {
            method: "POST",
            path: `/api/provider/custom/configure`,
            query: { location: input["location"] },
            body: {
              providerID: input["providerID"],
              name: input["name"],
              protocol: input["protocol"],
              update: input["update"],
              baseURL: input["baseURL"],
              apiKey: input["apiKey"],
              headers: input["headers"],
              models: input["models"],
            },
            successStatus: 200,
            declaredStatuses: [400, 409, 500, 503, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    integrations: {
      list: (input?: IntegrationsListInput, requestOptions?: RequestOptions) =>
        request<IntegrationsListOutput>(
          {
            method: "GET",
            path: `/api/integration`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: IntegrationsGetInput, requestOptions?: RequestOptions) =>
        request<IntegrationsGetOutput>(
          {
            method: "GET",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connectKey: (input: IntegrationsConnectKeyInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectKeyOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/key`,
            query: { location: input["location"] },
            body: { key: input["key"], label: input["label"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      connectOauth: (input: IntegrationsConnectOauthInput, requestOptions?: RequestOptions) =>
        request<IntegrationsConnectOauthOutput>(
          {
            method: "POST",
            path: `/api/integration/${encodeURIComponent(input.integrationID)}/connect/oauth`,
            query: { location: input["location"] },
            body: { methodID: input["methodID"], inputs: input["inputs"], label: input["label"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      attemptStatus: (input: IntegrationsAttemptStatusInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptStatusOutput>(
          {
            method: "GET",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      attemptComplete: (input: IntegrationsAttemptCompleteInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCompleteOutput>(
          {
            method: "POST",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}/complete`,
            query: { location: input["location"] },
            body: { code: input["code"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      attemptCancel: (input: IntegrationsAttemptCancelInput, requestOptions?: RequestOptions) =>
        request<IntegrationsAttemptCancelOutput>(
          {
            method: "DELETE",
            path: `/api/integration/attempt/${encodeURIComponent(input.attemptID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    credentials: {
      update: (input: CredentialsUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialsUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            body: { label: input["label"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      remove: (input: CredentialsRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/credential/${encodeURIComponent(input.credentialID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    permissions: {
      listRequests: (input?: PermissionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<PermissionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/permission/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listSaved: (input?: PermissionsListSavedInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListSavedOutput }>(
          {
            method: "GET",
            path: `/api/permission/saved`,
            query: { projectID: input?.["projectID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      removeSaved: (input: PermissionsRemoveSavedInput, requestOptions?: RequestOptions) =>
        request<PermissionsRemoveSavedOutput>(
          {
            method: "DELETE",
            path: `/api/permission/saved/${encodeURIComponent(input.id)}`,
            successStatus: 204,
            declaredStatuses: [401, 400],
            empty: true,
          },
          requestOptions,
        ),
      create: (input: PermissionsCreateInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsCreateOutput }>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            body: {
              id: input["id"],
              action: input["action"],
              resources: input["resources"],
              save: input["save"],
              metadata: input["metadata"],
              source: input["source"],
              agent: input["agent"],
            },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      list: (input: PermissionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      get: (input: PermissionsGetInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: PermissionsGetOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: PermissionsReplyInput, requestOptions?: RequestOptions) =>
        request<PermissionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/permission/${encodeURIComponent(input.requestID)}/reply`,
            body: { reply: input["reply"], message: input["message"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    files: {
      read: (input: FilesReadInput, requestOptions?: RequestOptions) =>
        request<FilesReadOutput>(
          {
            method: "GET",
            path: `/api/fs/read`,
            query: { location: input["location"], path: input["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: FilesListInput, requestOptions?: RequestOptions) =>
        request<FilesListOutput>(
          {
            method: "GET",
            path: `/api/fs/list`,
            query: { location: input?.["location"], path: input?.["path"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      find: (input: FilesFindInput, requestOptions?: RequestOptions) =>
        request<FilesFindOutput>(
          {
            method: "GET",
            path: `/api/fs/find`,
            query: { location: input["location"], query: input["query"], type: input["type"], limit: input["limit"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    commands: {
      list: (input?: CommandsListInput, requestOptions?: RequestOptions) =>
        request<CommandsListOutput>(
          {
            method: "GET",
            path: `/api/command`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    skills: {
      list: (input?: SkillsListInput, requestOptions?: RequestOptions) =>
        request<SkillsListOutput>(
          {
            method: "GET",
            path: `/api/skill`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    mcps: {
      status: (input?: McpsStatusInput, requestOptions?: RequestOptions) =>
        request<McpsStatusOutput>(
          {
            method: "GET",
            path: `/api/mcp`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      resources: (input?: McpsResourcesInput, requestOptions?: RequestOptions) =>
        request<McpsResourcesOutput>(
          {
            method: "GET",
            path: `/api/mcp/resource`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      connect: (input: McpsConnectInput, requestOptions?: RequestOptions) =>
        request<McpsConnectOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.name)}/connect`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
      disconnect: (input: McpsDisconnectInput, requestOptions?: RequestOptions) =>
        request<McpsDisconnectOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.name)}/disconnect`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
      authenticate: (input: McpsAuthenticateInput, requestOptions?: RequestOptions) =>
        request<McpsAuthenticateOutput>(
          {
            method: "POST",
            path: `/api/mcp/${encodeURIComponent(input.name)}/authenticate`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    lsp: {
      status: (input?: LspStatusInput, requestOptions?: RequestOptions) =>
        request<LspStatusOutput>(
          {
            method: "GET",
            path: `/api/lsp`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projects: {
      list: (requestOptions?: RequestOptions) =>
        request<ProjectsListOutput>(
          { method: "GET", path: `/api/project`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
      initGit: (input?: ProjectsInitGitInput, requestOptions?: RequestOptions) =>
        request<ProjectsInitGitOutput>(
          {
            method: "POST",
            path: `/api/project/git/init`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      current: (input?: ProjectsCurrentInput, requestOptions?: RequestOptions) =>
        request<ProjectsCurrentOutput>(
          {
            method: "GET",
            path: `/api/project/current`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ProjectsUpdateInput, requestOptions?: RequestOptions) =>
        request<ProjectsUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/project/${encodeURIComponent(input.projectID)}`,
            body: { name: input["name"], icon: input["icon"], commands: input["commands"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      directories: (input: ProjectsDirectoriesInput, requestOptions?: RequestOptions) =>
        request<ProjectsDirectoriesOutput>(
          {
            method: "GET",
            path: `/api/project/${encodeURIComponent(input.projectID)}/directory`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    worktrees: {
      create: (input?: WorktreesCreateInput, requestOptions?: RequestOptions) =>
        request<WorktreesCreateOutput>(
          {
            method: "POST",
            path: `/api/worktree`,
            query: { location: input?.["location"] },
            body: { name: input?.["name"], startCommand: input?.["startCommand"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: WorktreesRemoveInput, requestOptions?: RequestOptions) =>
        request<WorktreesRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/worktree`,
            query: { location: input["location"] },
            body: { directory: input["directory"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      reset: (input: WorktreesResetInput, requestOptions?: RequestOptions) =>
        request<WorktreesResetOutput>(
          {
            method: "POST",
            path: `/api/worktree/reset`,
            query: { location: input["location"] },
            body: { directory: input["directory"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
    },
    capabilities: {
      get: (requestOptions?: RequestOptions) =>
        request<CapabilitiesGetOutput>(
          { method: "GET", path: `/api/capability`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    vcs: {
      get: (input?: VcsGetInput, requestOptions?: RequestOptions) =>
        request<VcsGetOutput>(
          {
            method: "GET",
            path: `/api/vcs`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      status: (input?: VcsStatusInput, requestOptions?: RequestOptions) =>
        request<VcsStatusOutput>(
          {
            method: "GET",
            path: `/api/vcs/status`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      diff: (input: VcsDiffInput, requestOptions?: RequestOptions) =>
        request<VcsDiffOutput>(
          {
            method: "GET",
            path: `/api/vcs/diff`,
            query: { location: input["location"], mode: input["mode"], context: input["context"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    formatters: {
      status: (input?: FormattersStatusInput, requestOptions?: RequestOptions) =>
        request<FormattersStatusOutput>(
          {
            method: "GET",
            path: `/api/formatter`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    console: {
      get: (input?: ConsoleGetInput, requestOptions?: RequestOptions) =>
        request<ConsoleGetOutput>(
          {
            method: "GET",
            path: `/api/console`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      listOrgs: (input?: ConsoleListOrgsInput, requestOptions?: RequestOptions) =>
        request<ConsoleListOrgsOutput>(
          {
            method: "GET",
            path: `/api/console/org`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      switchOrg: (input: ConsoleSwitchOrgInput, requestOptions?: RequestOptions) =>
        request<ConsoleSwitchOrgOutput>(
          {
            method: "POST",
            path: `/api/console/org`,
            query: { location: input["location"] },
            body: { accountID: input["accountID"], orgID: input["orgID"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    config: {
      get: (input?: ConfigGetInput, requestOptions?: RequestOptions) =>
        request<ConfigGetOutput>(
          {
            method: "GET",
            path: `/api/config`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ConfigUpdateInput, requestOptions?: RequestOptions) =>
        request<ConfigUpdateOutput>(
          {
            method: "PATCH",
            path: `/api/config`,
            body: { config: input["config"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    workspaces: {
      listAdapters: (input?: WorkspacesListAdaptersInput, requestOptions?: RequestOptions) =>
        request<WorkspacesListAdaptersOutput>(
          {
            method: "GET",
            path: `/api/workspace/adapter`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: WorkspacesListInput, requestOptions?: RequestOptions) =>
        request<WorkspacesListOutput>(
          {
            method: "GET",
            path: `/api/workspace`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: WorkspacesCreateInput, requestOptions?: RequestOptions) =>
        request<WorkspacesCreateOutput>(
          {
            method: "POST",
            path: `/api/workspace`,
            query: { location: input["location"] },
            body: { id: input["id"], type: input["type"], branch: input["branch"], extra: input["extra"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: WorkspacesRemoveInput, requestOptions?: RequestOptions) =>
        request<WorkspacesRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/workspace/${encodeURIComponent(input.workspaceID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      status: (input?: WorkspacesStatusInput, requestOptions?: RequestOptions) =>
        request<WorkspacesStatusOutput>(
          {
            method: "GET",
            path: `/api/workspace/status`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      syncList: (input?: WorkspacesSyncListInput, requestOptions?: RequestOptions) =>
        request<WorkspacesSyncListOutput>(
          {
            method: "POST",
            path: `/api/workspace/sync`,
            query: { location: input?.["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      start: (input?: WorkspacesStartInput, requestOptions?: RequestOptions) =>
        request<WorkspacesStartOutput>(
          {
            method: "POST",
            path: `/api/workspace/start`,
            query: { location: input?.["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      warp: (input: WorkspacesWarpInput, requestOptions?: RequestOptions) =>
        request<WorkspacesWarpOutput>(
          {
            method: "POST",
            path: `/api/workspace/warp`,
            query: { location: input["location"] },
            body: {
              workspaceID: input["workspaceID"],
              sessionID: input["sessionID"],
              copyChanges: input["copyChanges"],
            },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    controlPlane: {
      moveSession: (input: ControlPlaneMoveSessionInput, requestOptions?: RequestOptions) =>
        request<ControlPlaneMoveSessionOutput>(
          {
            method: "POST",
            path: `/api/control-plane/session/move`,
            body: {
              sessionID: input["sessionID"],
              destination: input["destination"],
              moveChanges: input["moveChanges"],
            },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    "server.plugins": {
      list: (requestOptions?: RequestOptions) =>
        request<ServerPluginsListOutput>(
          { method: "GET", path: `/api/plugins`, successStatus: 200, declaredStatuses: [503, 401, 400], empty: false },
          requestOptions,
        ),
      add: (input: ServerPluginsAddInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsAddOutput>(
          {
            method: "POST",
            path: `/api/plugins/marketplace`,
            body: { source: input["source"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      refresh: (input: ServerPluginsRefreshInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsRefreshOutput>(
          {
            method: "POST",
            path: `/api/plugins/marketplace/refresh`,
            body: { name: input["name"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ServerPluginsRemoveInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/plugins/marketplace`,
            body: { name: input["name"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      install: (input: ServerPluginsInstallInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsInstallOutput>(
          {
            method: "POST",
            path: `/api/plugins/install`,
            body: { id: input["id"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      uninstall: (input: ServerPluginsUninstallInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsUninstallOutput>(
          {
            method: "POST",
            path: `/api/plugins/uninstall`,
            body: { id: input["id"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      enable: (input: ServerPluginsEnableInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsEnableOutput>(
          {
            method: "POST",
            path: `/api/plugins/enable`,
            body: { id: input["id"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      disable: (input: ServerPluginsDisableInput, requestOptions?: RequestOptions) =>
        request<ServerPluginsDisableOutput>(
          {
            method: "POST",
            path: `/api/plugins/disable`,
            body: { id: input["id"] },
            successStatus: 200,
            declaredStatuses: [503, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    events: {
      subscribe: (requestOptions?: RequestOptions): AsyncIterable<EventsSubscribeOutput> =>
        sse<EventsSubscribeOutput>(
          { method: "GET", path: `/api/event`, successStatus: 200, declaredStatuses: [401, 400], empty: false },
          requestOptions,
        ),
    },
    ptys: {
      shells: (input?: PtysShellsInput, requestOptions?: RequestOptions) =>
        request<PtysShellsOutput>(
          {
            method: "GET",
            path: `/api/pty/shells`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input?: PtysListInput, requestOptions?: RequestOptions) =>
        request<PtysListOutput>(
          {
            method: "GET",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input?: PtysCreateInput, requestOptions?: RequestOptions) =>
        request<PtysCreateOutput>(
          {
            method: "POST",
            path: `/api/pty`,
            query: { location: input?.["location"] },
            body: {
              command: input?.["command"],
              args: input?.["args"],
              cwd: input?.["cwd"],
              title: input?.["title"],
              env: input?.["env"],
            },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: PtysGetInput, requestOptions?: RequestOptions) =>
        request<PtysGetOutput>(
          {
            method: "GET",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: PtysUpdateInput, requestOptions?: RequestOptions) =>
        request<PtysUpdateOutput>(
          {
            method: "PUT",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            body: { title: input["title"], size: input["size"] },
            successStatus: 200,
            declaredStatuses: [404, 401, 400],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: PtysRemoveInput, requestOptions?: RequestOptions) =>
        request<PtysRemoveOutput>(
          {
            method: "DELETE",
            path: `/api/pty/${encodeURIComponent(input.ptyID)}`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [404, 401, 400],
            empty: true,
          },
          requestOptions,
        ),
    },
    questions: {
      listRequests: (input?: QuestionsListRequestsInput, requestOptions?: RequestOptions) =>
        request<QuestionsListRequestsOutput>(
          {
            method: "GET",
            path: `/api/question/request`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      list: (input: QuestionsListInput, requestOptions?: RequestOptions) =>
        request<{ readonly data: QuestionsListOutput }>(
          {
            method: "GET",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question`,
            successStatus: 200,
            declaredStatuses: [404, 400, 401],
            empty: false,
          },
          requestOptions,
        ).then((value) => value.data),
      reply: (input: QuestionsReplyInput, requestOptions?: RequestOptions) =>
        request<QuestionsReplyOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reply`,
            body: { answers: input["answers"] },
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
      reject: (input: QuestionsRejectInput, requestOptions?: RequestOptions) =>
        request<QuestionsRejectOutput>(
          {
            method: "POST",
            path: `/api/session/${encodeURIComponent(input.sessionID)}/question/${encodeURIComponent(input.requestID)}/reject`,
            successStatus: 204,
            declaredStatuses: [404, 400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
    references: {
      list: (input?: ReferencesListInput, requestOptions?: RequestOptions) =>
        request<ReferencesListOutput>(
          {
            method: "GET",
            path: `/api/reference`,
            query: { location: input?.["location"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
    },
    projectCopies: {
      generateName: (input: ProjectCopiesGenerateNameInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesGenerateNameOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/name`,
            query: { location: input["location"] },
            body: { context: input["context"] },
            successStatus: 200,
            declaredStatuses: [401, 400],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ProjectCopiesCreateInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesCreateOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { strategy: input["strategy"], directory: input["directory"], name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ProjectCopiesRemoveInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRemoveOutput>(
          {
            method: "DELETE",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy`,
            query: { location: input["location"] },
            body: { directory: input["directory"], force: input["force"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
      refresh: (input: ProjectCopiesRefreshInput, requestOptions?: RequestOptions) =>
        request<ProjectCopiesRefreshOutput>(
          {
            method: "POST",
            path: `/experimental/project/${encodeURIComponent(input.projectID)}/copy/refresh`,
            query: { location: input["location"] },
            successStatus: 204,
            declaredStatuses: [400, 401],
            empty: true,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType")
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
