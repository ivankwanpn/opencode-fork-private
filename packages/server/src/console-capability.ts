import { Console } from "@opencode-ai/schema/console"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly get: () => Effect.Effect<Console.State>
  readonly listOrgs: () => Effect.Effect<readonly Console.Org[]>
  readonly switchOrg: (input: { readonly accountID: string; readonly orgID: string }) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/ConsoleCapability") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    get: () => Effect.succeed({ consoleManagedProviders: [], switchableOrgCount: 0 }),
    listOrgs: () => Effect.succeed([]),
    switchOrg: () => Effect.succeed(false),
  }),
)

export * as ConsoleCapability from "./console-capability"
