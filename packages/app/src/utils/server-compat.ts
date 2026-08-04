import type { ServerApi } from "./server"
import type { ServerProtocol, ServerProtocolResolver } from "./server-protocol"
import type { AgentPartInput, FilePartInput, OpencodeClient, Session, TextPartInput } from "@opencode-ai/sdk/v2/client"
import type {
  Project,
  ProjectCurrent,
  SessionCreateInput,
  SessionCreateOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionInfo,
  SessionPromptInput,
  SessionPromptOutput,
  SessionShellInput,
  SessionShellOutput,
} from "@opencode-ai/client/promise"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import type { Prompt } from "@opencode-ai/schema/prompt"

type LegacyClient = OpencodeClient
type LegacyFor = (directory?: string) => LegacyClient
type CompatibleModel = {
  id: string
  providerID: string
  variant?: string
  protocol?: CustomProvider.Protocol
}
type CompatibleCreateInput = Omit<SessionCreateInput, "model"> & { model?: CompatibleModel | null }
type CompatibleCommandInput = Omit<SessionCommandInput, "model"> & { model?: CompatibleModel | null }
type CompatibleSessionApi = Omit<
  ServerApi["session"],
  "create" | "prompt" | "command" | "shell" | "compact" | "todo" | "rename" | "archive" | "remove"
> & {
  create: (
    input?: CompatibleCreateInput,
    requestOptions?: Parameters<ServerApi["session"]["create"]>[1],
  ) => Promise<SessionCreateOutput>
  prompt: (input: CompatiblePromptInput) => Promise<SessionPromptOutput>
  command: (
    input: CompatibleCommandInput,
    requestOptions?: Parameters<ServerApi["session"]["command"]>[1],
  ) => Promise<SessionCommandOutput>
  shell: (input: SessionShellInput & LegacyPrompt & { resume?: boolean }) => Promise<SessionShellOutput>
  compact: (input: SessionCompactInput & { model?: LegacyPrompt["model"] }) => Promise<SessionCompactOutput>
  todo: (input: Parameters<ServerApi["session"]["todo"]>[0]) => ReturnType<ServerApi["session"]["todo"]>
  rename: (
    input: Parameters<ServerApi["session"]["rename"]>[0] & LegacyLocation,
  ) => ReturnType<ServerApi["session"]["rename"]>
  archive: (
    input: Parameters<ServerApi["session"]["archive"]>[0] & LegacyLocation,
  ) => ReturnType<ServerApi["session"]["archive"]>
  remove: (
    input: Parameters<ServerApi["session"]["remove"]>[0] & LegacyLocation,
  ) => ReturnType<ServerApi["session"]["remove"]>
}
type CompatiblePermissionApi = Omit<ServerApi["permission"], "reply"> & {
  reply: (
    input: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } },
  ) => ReturnType<ServerApi["permission"]["reply"]>
}
export type CompatibleApi = Omit<ServerApi, "session" | "permission"> & {
  readonly session: CompatibleSessionApi
  readonly permission: CompatiblePermissionApi
}
type LegacyPrompt = {
  agent?: string
  model?: { providerID: string; modelID: string; protocol?: CustomProvider.Protocol }
  variant?: string
  legacyParts?: (TextPartInput | FilePartInput | AgentPartInput)[]
}
type CompatiblePromptInput = SessionPromptInput &
  LegacyPrompt & {
    context?: Prompt["context"]
    expectedActiveAttemptID?: string
  }
type LegacyLocation = { directory?: string }
type CompatibleInput = {
  protocol: Promise<ServerProtocol> | (() => Promise<ServerProtocol>)
  current: ServerApi
  legacy: LegacyFor
  directory?: string
}

export type CompatibleImplementation = CompatibleApi | ServerApi
export type ServerGeneration = {
  protocol: ServerProtocol
  api: CompatibleImplementation
}
const compatibleResolvers = new WeakMap<object, (protocol: ServerProtocol) => CompatibleImplementation>()

function mime(uri: string) {
  const match = /^data:([^;,]+)/.exec(uri)
  return match?.[1] ?? "application/octet-stream"
}

function sessionInfo(session: Session): SessionInfo {
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID,
    agent: session.agent,
    model: session.model && {
      id: session.model.id,
      providerID: session.model.providerID,
      variant: session.model.variant,
      ...("protocol" in session.model ? { protocol: session.model.protocol } : {}),
    },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: session.time,
    title: session.title,
    location: { directory: session.directory, workspaceID: session.workspaceID },
    subpath: session.path,
    revert: session.revert && {
      messageID: session.revert.messageID,
      partID: session.revert.partID,
      snapshot: session.revert.snapshot,
    },
  }
}

function projectInfo(project: Project): Awaited<ReturnType<ServerApi["project"]["update"]>> {
  return {
    ...project,
    vcs: project.vcs === "git" ? "git" : undefined,
    sandboxes: [...project.sandboxes],
  }
}

function unsupportedV1(operation: string): never {
  throw new Error(`${operation} is unavailable on a V1 server`)
}

export function createCompatibleApi(input: CompatibleInput): CompatibleApi {
  const v1 = createV1Api(input)
  const select = (protocol: ServerProtocol) => (protocol === "v1" ? v1 : input.current)
  const api = lazyApi(() => resolveProtocol(input.protocol).then(select), input.current)
  compatibleResolvers.set(api, select)
  return api
}

export function createV2OnlyApi(input: Pick<CompatibleInput, "protocol" | "current">): CompatibleApi {
  const select = (protocol: ServerProtocol) => {
    if (protocol !== "v2") throw new Error("V2 server protocol unavailable")
    return input.current
  }
  const api = lazyApi(() => resolveProtocol(input.protocol).then(select), input.current)
  compatibleResolvers.set(api, select)
  return api
}

export function resolveCompatibleApi(api: CompatibleApi, protocol: ServerProtocol): CompatibleImplementation {
  return compatibleResolvers.get(api)?.(protocol) ?? api
}

export function resolveCompatibleGeneration(api: CompatibleApi, protocol: ServerProtocol): ServerGeneration {
  return { protocol, api: resolveCompatibleApi(api, protocol) }
}

export function resolveCompatibleApiForProtocol(
  api: CompatibleApi,
  protocol: ServerProtocolResolver,
): Promise<CompatibleImplementation> {
  return resolveProtocol(protocol).then((value) => resolveCompatibleApi(api, value))
}

function resolveProtocol(input: CompatibleInput["protocol"]) {
  return typeof input === "function" ? input() : input
}

type LazyImplementation<T> = Promise<T> | (() => Promise<T>)

function resolveImplementation<T>(implementation: LazyImplementation<T>) {
  return typeof implementation === "function" ? implementation() : implementation
}

function lazyApi<T extends object>(implementation: LazyImplementation<T>, shape: T): T {
  const cache = new Map<PropertyKey, unknown>()
  return new Proxy(shape, {
    get(target, property, receiver) {
      const sample = Reflect.get(target, property, receiver)
      if (typeof sample === "function") {
        return (...args: unknown[]) =>
          resolveImplementation(implementation).then((value) => {
            const method = Reflect.get(value, property)
            if (typeof method !== "function") throw new Error(`API method unavailable: ${String(property)}`)
            return Reflect.apply(method, value, args)
          })
      }
      if (sample === null || typeof sample !== "object") return sample
      if (cache.has(property)) return cache.get(property)
      const nested = lazyApi(
        () =>
          resolveImplementation(implementation).then((value) => {
            const result = Reflect.get(value, property)
            if (result === null || typeof result !== "object") {
              throw new Error(`API namespace unavailable: ${String(property)}`)
            }
            return result
          }),
        sample,
      )
      cache.set(property, nested)
      return nested
    },
  })
}

function createV1Api(input: CompatibleInput): CompatibleApi {
  const directory = (location?: { directory?: string }) => location?.directory ?? input.directory
  const legacy = (location?: { directory?: string }) => input.legacy(directory(location))
  const located = <T>(data: T, value?: { directory?: string }) => ({
    location: {
      directory: directory(value) ?? "",
      project: { id: "", directory: directory(value) ?? "" },
    },
    data,
  })

  return {
    ...input.current,
    message: {
      ...input.current.message,
      list: async () => unsupportedV1("V2 message history"),
    },
    plugins: {
      list: async () => unsupportedV1("Plugin management"),
      add: async () => unsupportedV1("Plugin management"),
      refresh: async () => unsupportedV1("Plugin management"),
      remove: async () => unsupportedV1("Plugin management"),
      install: async () => unsupportedV1("Plugin management"),
      uninstall: async () => unsupportedV1("Plugin management"),
      enable: async () => unsupportedV1("Plugin management"),
      disable: async () => unsupportedV1("Plugin management"),
    } as ServerApi["plugins"],
    session: {
      ...input.current.session,
      async list(
        value?: Parameters<ServerApi["session"]["list"]>[0],
        options?: Parameters<ServerApi["session"]["list"]>[1],
      ) {
        if (!value?.directory && value?.search !== undefined) {
          const result = await legacy().experimental.session.list(
            {
              roots: value.parentID === null ? true : undefined,
              search: value.search,
              limit: value.limit,
            },
            options,
          )
          return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
        }
        const result = await legacy({ directory: value?.directory }).session.list({
          directory: value?.directory,
          roots: value?.parentID === null ? true : undefined,
          search: value?.search,
          limit: value?.limit,
        })
        return { data: (result.data ?? []).map(sessionInfo), cursor: {} }
      },
      async create(value?: Parameters<ServerApi["session"]["create"]>[0]) {
        const result = await legacy(value?.location ?? undefined).session.create({
          directory: directory(value?.location ?? undefined),
        })
        if (!result.data) throw new Error("Failed to create session")
        return sessionInfo(result.data)
      },
      async get(value: Parameters<ServerApi["session"]["get"]>[0]) {
        const result = await legacy().session.get(value)
        if (!result.data) throw new Error(`Session not found: ${value.sessionID}`)
        return sessionInfo(result.data)
      },
      async active() {
        const result = await legacy().session.status()
        return Object.fromEntries(
          Object.entries(result.data ?? {}).flatMap(([sessionID, status]) =>
            status.type === "idle" ? [] : [[sessionID, { type: "running" as const }]],
          ),
        )
      },
      async todo(value: Parameters<ServerApi["session"]["todo"]>[0]) {
        const result = await legacy().session.todo({ sessionID: value.sessionID })
        return result.data ?? []
      },
      async rename(value: Parameters<ServerApi["session"]["rename"]>[0] & LegacyLocation) {
        await legacy(value).session.update({ sessionID: value.sessionID, title: value.title })
      },
      async archive(value: Parameters<ServerApi["session"]["archive"]>[0] & LegacyLocation) {
        await legacy(value).session.update({ sessionID: value.sessionID, time: { archived: Date.now() } })
      },
      async remove(value: Parameters<ServerApi["session"]["remove"]>[0] & LegacyLocation) {
        await legacy(value).session.delete(value)
      },
      async share(value: Parameters<ServerApi["session"]["share"]>[0]) {
        const result = await legacy().session.share({ sessionID: value.sessionID })
        const url = result.data?.share?.url
        if (!url) throw new Error(`Failed to share session: ${value.sessionID}`)
        return { url }
      },
      async unshare(value: Parameters<ServerApi["session"]["unshare"]>[0]) {
        await legacy().session.unshare({ sessionID: value.sessionID })
      },
      async fork(value: Parameters<ServerApi["session"]["fork"]>[0]) {
        const result = await legacy().session.fork(value)
        if (!result.data) throw new Error("Failed to fork session")
        return sessionInfo(result.data)
      },
      async interrupt(value: Parameters<ServerApi["session"]["interrupt"]>[0]) {
        await legacy().session.abort(value)
      },
      switchAgent: async () => unsupportedV1("Session agent switching"),
      switchModel: async () => unsupportedV1("Session model switching"),
      async prompt(value: CompatiblePromptInput) {
        await legacy().session.promptAsync({
          sessionID: value.sessionID,
          messageID: value.id ?? undefined,
          agent: value.agent,
          model: value.model,
          variant: value.variant,
          parts: value.legacyParts ?? [
            { type: "text", text: value.text },
            ...(value.files ?? []).map((file) => ({
              type: "file" as const,
              mime: file.mention ? "text/plain" : mime(file.uri),
              url: file.uri,
              filename: file.name,
              source: file.mention
                ? {
                    type: "file" as const,
                    text: { value: file.mention.text, start: file.mention.start, end: file.mention.end },
                    path: file.uri,
                  }
                : undefined,
            })),
            ...(value.agents ?? []).map((agent) => ({
              type: "agent" as const,
              name: agent.name,
              source: agent.mention
                ? { value: agent.mention.text, start: agent.mention.start, end: agent.mention.end }
                : undefined,
            })),
          ],
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: value.text },
          delivery: "steer",
        }
      },
      async command(value: SessionCommandInput) {
        await legacy().session.command({
          sessionID: value.sessionID,
          messageID: value.id ?? undefined,
          command: value.command,
          arguments: value.arguments ?? "",
          agent: value.agent ?? undefined,
          model: value.model ? `${value.model.providerID}/${value.model.id}` : undefined,
          variant: value.model?.variant,
          parts: value.files?.map((file) => ({
            type: "file" as const,
            mime: mime(file.uri),
            url: file.uri,
            filename: file.name,
          })),
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "user",
          data: { text: `/${value.command} ${value.arguments ?? ""}`.trim() },
          delivery: value.delivery ?? "steer",
        }
      },
      async shell(value: SessionShellInput & LegacyPrompt) {
        await legacy().session.shell({
          sessionID: value.sessionID,
          command: value.command,
          agent: value.agent,
          model: value.model,
        })
      },
      compact: async (value: SessionCompactInput & { model?: LegacyPrompt["model"] }) => {
        if (!value.model) throw new Error("A model is required to compact a V1 session")
        await legacy().session.summarize({
          sessionID: value.sessionID,
          providerID: value.model.providerID,
          modelID: value.model.modelID,
        })
        return {
          admittedSeq: 0,
          id: value.id ?? "",
          sessionID: value.sessionID,
          timeCreated: Date.now(),
          type: "compaction",
        }
      },
      inputList: async () => unsupportedV1("Durable session follow-up inputs"),
      inputGet: async () => unsupportedV1("Durable session follow-up inputs"),
      inputPromote: async () => unsupportedV1("Durable session follow-up inputs"),
      inputCancel: async () => unsupportedV1("Durable session follow-up inputs"),
      background: async () => unsupportedV1("Background session execution"),
      wait: async () => unsupportedV1("Durable session waiting"),
      context: async () => unsupportedV1("V2 session context"),
      revert: {
        stage: async (value: Parameters<ServerApi["session"]["revert"]["stage"]>[0]) => {
          await legacy().session.revert(value)
          return { messageID: value.messageID }
        },
        clear: async (value: Parameters<ServerApi["session"]["revert"]["clear"]>[0]) => {
          await legacy().session.unrevert(value)
        },
        commit: async () => unsupportedV1("V2 session revert commit"),
      },
    },
    project: {
      ...input.current.project,
      async list() {
        return ((await legacy().project.list()).data ?? []).map(projectInfo)
      },
      async current(value?: Parameters<ServerApi["project"]["current"]>[0]) {
        const result = await legacy(value?.location).project.current()
        if (!result.data) throw new Error("Project not found")
        return { id: result.data.id, directory: result.data.worktree } satisfies ProjectCurrent
      },
      async initGit(value?: Parameters<ServerApi["project"]["initGit"]>[0]) {
        const result = await legacy(value?.location).project.initGit()
        if (!result.data) throw new Error("Failed to initialize git repository")
        return projectInfo(result.data)
      },
      async update(value: Parameters<ServerApi["project"]["update"]>[0]) {
        const project = (await legacy().project.list()).data?.find((item) => item.id === value.projectID)
        const result = await legacy({ directory: project?.worktree }).project.update({
          ...value,
          directory: project?.worktree,
        })
        if (!result.data) throw new Error(`Project not found: ${value.projectID}`)
        return projectInfo(result.data)
      },
      async directories(value: Parameters<ServerApi["project"]["directories"]>[0]) {
        const result = await legacy(value.location).worktree.list()
        return (result.data ?? []).map((item) => ({ directory: item }))
      },
    },
    worktree: {
      ...input.current.worktree,
      async create(value?: Parameters<ServerApi["worktree"]["create"]>[0]) {
        const result = await legacy(value?.location).worktree.create({
          worktreeCreateInput: {
            name: value?.name,
            startCommand: value?.startCommand,
          },
        })
        if (!result.data) throw new Error("Failed to create worktree")
        return result.data
      },
      async remove(value: Parameters<ServerApi["worktree"]["remove"]>[0]) {
        const result = await legacy(value.location).worktree.remove({
          worktreeRemoveInput: { directory: value.directory },
        })
        return result.data ?? false
      },
      async reset(value: Parameters<ServerApi["worktree"]["reset"]>[0]) {
        const result = await legacy(value.location).worktree.reset({
          worktreeResetInput: { directory: value.directory },
        })
        return result.data ?? false
      },
    },
    location: {
      ...input.current.location,
      async dispose(value?: Parameters<ServerApi["location"]["dispose"]>[0]) {
        await legacy(value?.location).instance.dispose()
      },
    },
    path: {
      ...input.current.path,
      async get(value?: Parameters<ServerApi["path"]["get"]>[0]) {
        const result = await legacy(value?.location).path.get()
        if (!result.data) throw new Error("Path unavailable")
        return result.data
      },
    },
    lsp: {
      ...input.current.lsp,
      async status(value?: Parameters<ServerApi["lsp"]["status"]>[0]) {
        const result = await legacy(value?.location).lsp.status()
        return located(result.data ?? [], value?.location)
      },
    },
    vcs: {
      ...input.current.vcs,
      async get(value?: Parameters<ServerApi["vcs"]["get"]>[0]) {
        const result = await legacy(value?.location).vcs.get()
        return located({ branch: result.data?.branch, defaultBranch: result.data?.default_branch }, value?.location)
      },
      async status(value?: Parameters<ServerApi["vcs"]["status"]>[0]) {
        const result = await legacy(value?.location).vcs.status()
        return located(result.data ?? [], value?.location)
      },
      async diff(value: Parameters<ServerApi["vcs"]["diff"]>[0]) {
        const result = await legacy(value.location).vcs.diff({
          mode: value.mode === "working" ? "git" : value.mode,
          context: value.context,
        })
        return located(
          (result.data ?? []).map((file) => ({
            file: file.file,
            patch: file.patch ?? "",
            additions: file.additions,
            deletions: file.deletions,
            status: file.status ?? "modified",
          })),
          value.location,
        )
      },
    },
    file: {
      ...input.current.file,
      async read(value: Parameters<ServerApi["file"]["read"]>[0]) {
        const result = await legacy(value.location).file.read({ path: value.path })
        if (!result.data) throw new Error(`File not found: ${value.path}`)
        return located(result.data, value.location)
      },
      async list(value?: Parameters<ServerApi["file"]["list"]>[0]) {
        const result = await legacy(value?.location).file.list({ path: value?.path ?? "" })
        return located(result.data ?? [], value?.location)
      },
      async find(value: Parameters<ServerApi["file"]["find"]>[0]) {
        const result = await legacy(value.location).find.files({
          query: value.query,
          dirs: value.type === undefined ? undefined : value.type === "directory" ? "true" : "false",
          limit: value.limit,
        })
        return located(
          (result.data ?? []).map((path) => ({ path, type: value.type ?? "file" })),
          value.location,
        )
      },
    },
    config: {
      ...input.current.config,
      async get(value?: Parameters<ServerApi["config"]["get"]>[0]) {
        const result = await legacy(value?.location).global.config.get()
        return located((result.data ?? {}) as Awaited<ReturnType<ServerApi["config"]["get"]>>["data"], value?.location)
      },
      async update(value: Parameters<ServerApi["config"]["update"]>[0]) {
        const result = await legacy().global.config.update({
          config: value.config as unknown as NonNullable<
            Parameters<LegacyClient["global"]["config"]["update"]>[0]
          >["config"],
        })
        return located((result.data ?? value.config) as unknown as typeof value.config)
      },
    },
    mcp: {
      ...input.current.mcp,
      async list(value?: Parameters<ServerApi["mcp"]["list"]>[0]) {
        const result = await legacy(value?.location).mcp.status()
        return located(
          Object.entries(result.data ?? {}).map(([name, status]) => ({ name, status })),
          value?.location,
        ) as Awaited<ReturnType<ServerApi["mcp"]["list"]>>
      },
      async connect(value: Parameters<ServerApi["mcp"]["connect"]>[0]) {
        await legacy(value.location).mcp.connect({ name: value.server })
      },
      async disconnect(value: Parameters<ServerApi["mcp"]["disconnect"]>[0]) {
        await legacy(value.location).mcp.disconnect({ name: value.server })
      },
      async authenticate(value: Parameters<ServerApi["mcp"]["authenticate"]>[0]) {
        const result = await legacy(value.location).mcp.auth.authenticate({ name: value.name })
        if (!result.data) throw new Error(`Failed to authenticate MCP server: ${value.name}`)
        return located(result.data, value.location)
      },
      resource: {
        ...input.current.mcp.resource,
        async catalog(value?: Parameters<ServerApi["mcp"]["resource"]["catalog"]>[0]) {
          const result = await legacy(value?.location).experimental.resource.list()
          return located(
            {
              resources: Object.values(result.data ?? {}).map((resource) => ({
                ...resource,
                server: resource.client,
              })),
              templates: [],
            },
            value?.location,
          ) as Awaited<ReturnType<ServerApi["mcp"]["resource"]["catalog"]>>
        },
      },
    },
    integration: {
      ...input.current.integration,
      async get(value: Parameters<ServerApi["integration"]["get"]>[0]) {
        const client = legacy(value.location)
        const results = await Promise.all([client.provider.auth(), client.provider.list()])
        const methods = (results[0].data?.[value.integrationID] ?? []).map((method, index) =>
          method.type === "api"
            ? { type: "key" as const, label: method.label }
            : { type: "oauth" as const, id: String(index), label: method.label, prompts: method.prompts },
        )
        const connected = results[1].data?.connected.includes(value.integrationID) ?? false
        return located(
          {
            id: value.integrationID,
            name: value.integrationID,
            methods,
            connections: connected
              ? [{ type: "credential" as const, id: value.integrationID, label: value.integrationID }]
              : [],
          },
          value.location,
        )
      },
      connect: {
        ...input.current.integration.connect,
        key: async (value: Parameters<ServerApi["integration"]["connect"]["key"]>[0]) => {
          await legacy(value.location).auth.set({
            providerID: value.integrationID,
            auth: { type: "api", key: value.key },
          })
        },
      },
      oauth: {
        ...input.current.integration.oauth,
        connect: async (value: Parameters<ServerApi["integration"]["oauth"]["connect"]>[0]) => {
          const method = Number(value.methodID)
          const result = await legacy(value.location).provider.oauth.authorize(
            { providerID: value.integrationID, method, inputs: value.inputs },
            { throwOnError: true },
          )
          if (!result.data) throw new Error("Failed to start OAuth authorization")
          return located(
            {
              attemptID: `${value.integrationID}:${method}`,
              url: result.data.url,
              instructions: result.data.instructions,
              mode: result.data.method,
              time: { created: Date.now(), expires: Date.now() + 10 * 60 * 1000 },
            },
            value.location,
          )
        },
        complete: async (value: Parameters<ServerApi["integration"]["oauth"]["complete"]>[0]) => {
          const method = Number(value.attemptID.split(":").at(-1))
          await legacy(value.location).provider.oauth.callback(
            { providerID: value.integrationID, method, code: value.code },
            { throwOnError: true },
          )
        },
        status: async (value: Parameters<ServerApi["integration"]["oauth"]["status"]>[0]) => {
          const method = Number(value.attemptID.split(":").at(-1))
          await legacy(value.location).provider.oauth.callback(
            { providerID: value.integrationID, method },
            { throwOnError: true },
          )
          return located(
            { status: "complete" as const, time: { created: Date.now(), expires: Date.now() } },
            value.location,
          )
        },
        // V1 has no cancellable OAuth attempt. Cleanup is local because the
        // legacy authorize endpoint does not expose a matching operation.
        cancel: async () => undefined,
      },
    },
    credential: {
      ...input.current.credential,
      async remove(value: Parameters<ServerApi["credential"]["remove"]>[0]) {
        await legacy(value.location).auth.remove({ providerID: value.credentialID })
      },
    },
    pty: {
      ...input.current.pty,
      async shells(value?: Parameters<ServerApi["pty"]["shells"]>[0]) {
        return located((await legacy(value?.location).pty.shells()).data ?? [], value?.location)
      },
      async list(value?: Parameters<ServerApi["pty"]["list"]>[0]) {
        return located((await legacy(value?.location).pty.list()).data ?? [], value?.location)
      },
      async create(value?: Parameters<ServerApi["pty"]["create"]>[0]) {
        const result = await legacy(value?.location).pty.create({
          command: value?.command,
          args: value?.args ? [...value.args] : undefined,
          cwd: value?.cwd,
          title: value?.title,
          env: value?.env,
        })
        if (!result.data) throw new Error("Failed to create terminal")
        return located(result.data, value?.location)
      },
      async get(value: Parameters<ServerApi["pty"]["get"]>[0]) {
        const result = await legacy(value.location).pty.get({ ptyID: value.ptyID })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async update(value: Parameters<ServerApi["pty"]["update"]>[0]) {
        const result = await legacy(value.location).pty.update({
          ptyID: value.ptyID,
          title: value.title,
          size: value.size,
        })
        if (!result.data) throw new Error(`Terminal not found: ${value.ptyID}`)
        return located(result.data, value.location)
      },
      async remove(value: Parameters<ServerApi["pty"]["remove"]>[0]) {
        await legacy(value.location).pty.remove({ ptyID: value.ptyID })
      },
      async connectToken(value: Parameters<ServerApi["pty"]["connectToken"]>[0]) {
        const result = await legacy(value.location).pty.connectToken({ ptyID: value.ptyID })
        if (!result.data) throw new Error(`Failed to connect terminal: ${value.ptyID}`)
        return located(result.data, value.location)
      },
    },
    permission: {
      ...input.current.permission,
      request: {
        ...input.current.permission.request,
        async list(value?: Parameters<ServerApi["permission"]["request"]["list"]>[0]) {
          const result = await legacy(value?.location).permission.list({
            directory: directory(value?.location),
          })
          return located(
            (result.data ?? []).map((request) => ({
              id: request.id,
              sessionID: request.sessionID,
              action: request.permission,
              resources: request.patterns,
              save: request.always,
              metadata: request.metadata,
              source: request.tool && {
                type: "tool" as const,
                messageID: request.tool.messageID,
                callID: request.tool.callID,
              },
            })),
            value?.location,
          ) as Awaited<ReturnType<ServerApi["permission"]["request"]["list"]>>
        },
      },
      async reply(value: Parameters<ServerApi["permission"]["reply"]>[0] & { location?: { directory?: string } }) {
        await legacy(value.location).permission.respond({
          sessionID: value.sessionID,
          permissionID: value.requestID,
          response: value.reply,
          directory: directory(value.location),
        })
      },
    },
    question: {
      ...input.current.question,
      request: {
        ...input.current.question.request,
        async list(value?: Parameters<ServerApi["question"]["request"]["list"]>[0]) {
          const result = await legacy(value?.location).question.list()
          return located(result.data ?? [], value?.location) as Awaited<
            ReturnType<ServerApi["question"]["request"]["list"]>
          >
        },
      },
      async reply(value: Parameters<ServerApi["question"]["reply"]>[0]) {
        await legacy().question.reply({
          requestID: value.requestID,
          answers: value.answers.map((answer) => [...answer]),
        })
      },
      async reject(value: Parameters<ServerApi["question"]["reject"]>[0]) {
        await legacy().question.reject({ requestID: value.requestID })
      },
    },
  }
}
