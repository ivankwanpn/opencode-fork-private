export * as Tools from "./tools"

import { Context, Effect, Scope } from "effect"
import type { ToolCatalog } from "./catalog"
import { Tool } from "./tool"

export type Contribution = {
  readonly source: ToolCatalog.SourceRef
  readonly state: ToolCatalog.SourceState
  readonly message?: string
  readonly permissions?: ReadonlyArray<string>
  readonly tools: Readonly<Record<string, Tool.AnyTool>>
}

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  readonly contribute: (input: Contribution) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}

/** Narrow registration-only Location capability. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Tools") {}
