import type {
  CommandRuntimeHookSpec,
  PermissionHookSpec,
  SessionHookSpec,
  ShellHookSpec,
  ToolHookSpec,
} from "../effect/runtime.js"
import type { Registration } from "./registration.js"

export interface RuntimeHooks<Spec> {
  hook<Name extends keyof Spec & string>(
    name: Name,
    callback: (event: Spec[Name]) => Promise<void> | void,
  ): Promise<Registration>
}

export type SessionDomain = RuntimeHooks<SessionHookSpec>
export type PermissionDomain = RuntimeHooks<PermissionHookSpec>
export type ShellDomain = RuntimeHooks<ShellHookSpec>
export type ToolDomain = RuntimeHooks<ToolHookSpec>
export type CommandRuntimeDomain = RuntimeHooks<CommandRuntimeHookSpec>

export type {
  ChatContext,
  ChatParams,
  CommandRuntimeHookSpec,
  MutableValue,
  PermissionHookSpec,
  ProviderContext,
  SessionHookSpec,
  ShellHookSpec,
  ToolHookSpec,
  ToolResult,
} from "../effect/runtime.js"
