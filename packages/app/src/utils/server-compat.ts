import type { ServerApi } from "./server"
import type { ServerProtocol, ServerProtocolResolver } from "./server-protocol"
import type { AgentPartInput, FilePartInput, TextPartInput } from "@opencode-ai/sdk/v2/client"
import type {
  SessionCreateInput,
  SessionCreateOutput,
  SessionCommandInput,
  SessionCommandOutput,
  SessionCompactInput,
  SessionCompactOutput,
  SessionPromptInput,
  SessionPromptOutput,
  SessionShellInput,
  SessionShellOutput,
} from "@opencode-ai/client/promise"
import type { CustomProvider } from "@opencode-ai/schema/custom-provider"
import type { Prompt } from "@opencode-ai/schema/prompt"

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
}

export type CompatibleImplementation = CompatibleApi | ServerApi
export type ServerGeneration = {
  protocol: ServerProtocol
  api: CompatibleImplementation
}
const compatibleResolvers = new WeakMap<object, (protocol: ServerProtocol) => CompatibleImplementation>()

export function createV2OnlyApi(input: CompatibleInput): CompatibleApi {
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
