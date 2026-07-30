import type {
  Message,
  ModelV2Info,
  Part,
  PermissionV2Request,
  ProviderV2Info,
  UserMessage,
} from "@opencode-ai/sdk/v2/types"
import type { Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

export interface MutableValue<Value> {
  get(): Value
  set(value: Value): void
  update(transform: (value: Value) => Value): void
}

export interface RuntimeHooks<Spec> {
  hook<Name extends keyof Spec & string>(
    name: Name,
    callback: (event: Spec[Name]) => Effect.Effect<void> | void,
  ): Effect.Effect<Registration, never, Scope.Scope>
}

export type ProviderContext = {
  readonly source: "env" | "config" | "custom" | "api"
  readonly info: ProviderV2Info
  readonly options: Record<string, unknown>
}

export type ChatContext = {
  readonly sessionID: string
  readonly agent: string
  readonly model: ModelV2Info
  readonly provider: ProviderContext
  readonly message: UserMessage
}

export type ChatParams = {
  readonly temperature?: number
  readonly topP?: number
  readonly topK?: number
  readonly maxOutputTokens?: number
  readonly options: Record<string, unknown>
}

export interface SessionHookSpec {
  readonly "message.before": {
    readonly sessionID: string
    readonly agent?: string
    readonly model?: { readonly providerID: string; readonly modelID: string; readonly variant?: string }
    readonly messageID?: string
    readonly message: MutableValue<UserMessage>
    readonly parts: MutableValue<readonly Part[]>
  }
  readonly "chat.params": ChatContext & {
    readonly params: MutableValue<ChatParams>
  }
  readonly "chat.headers": ChatContext & {
    readonly headers: MutableValue<Record<string, string>>
  }
  readonly "chat.messages.transform": {
    readonly messages: MutableValue<ReadonlyArray<{ readonly info: Message; readonly parts: readonly Part[] }>>
  }
  readonly "chat.system.transform": {
    readonly sessionID?: string
    readonly model: ModelV2Info
    readonly system: MutableValue<readonly string[]>
  }
  readonly compacting: {
    readonly sessionID: string
    readonly options: MutableValue<{ readonly context: readonly string[]; readonly prompt?: string }>
  }
  readonly "compaction.autocontinue": ChatContext & {
    readonly overflow: boolean
    readonly enabled: MutableValue<boolean>
  }
  readonly "text.complete": {
    readonly sessionID: string
    readonly messageID: string
    readonly partID: string
    readonly text: MutableValue<string>
  }
}

export type SessionDomain = RuntimeHooks<SessionHookSpec>

export interface PermissionHookSpec {
  readonly ask: {
    readonly request: PermissionV2Request
    readonly status: MutableValue<"ask" | "deny" | "allow">
  }
}

export type PermissionDomain = RuntimeHooks<PermissionHookSpec>

export interface ShellHookSpec {
  readonly env: {
    readonly cwd: string
    readonly sessionID?: string
    readonly callID?: string
    readonly env: MutableValue<Record<string, string>>
  }
}

export type ShellDomain = RuntimeHooks<ShellHookSpec>

export type ToolResult = {
  readonly title?: string
  readonly output: unknown
  readonly metadata?: unknown
}

export interface ToolHookSpec {
  readonly "execute.before": {
    readonly tool: string
    readonly sessionID: string
    readonly callID: string
    readonly args: MutableValue<unknown>
  }
  readonly "execute.after": {
    readonly tool: string
    readonly sessionID: string
    readonly callID: string
    readonly args: unknown
    readonly result: MutableValue<ToolResult>
  }
  readonly definition: {
    readonly toolID: string
    readonly definition: MutableValue<{ readonly description: string; readonly parameters: unknown }>
  }
}

export type ToolDomain = RuntimeHooks<ToolHookSpec>

export interface CommandRuntimeHookSpec {
  readonly "execute.before": {
    readonly command: string
    readonly sessionID: string
    readonly arguments: string
    readonly parts: MutableValue<readonly Part[]>
  }
}

export type CommandRuntimeDomain = RuntimeHooks<CommandRuntimeHookSpec>
