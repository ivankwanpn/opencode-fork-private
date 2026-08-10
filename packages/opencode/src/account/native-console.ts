import { ConsoleCapability } from "@opencode-ai/server/console-capability"
import { Effect, Layer, Option } from "effect"
import { Account } from "./account"
import { AccountID, OrgID } from "./schema"
import { Config } from "@/config/config"

export const layer = Layer.effect(
  ConsoleCapability.Service,
  Effect.gen(function* () {
    const account = yield* Account.Service
    const config = yield* Config.Service
    return ConsoleCapability.Service.of({
      get: () =>
        Effect.all([config.getConsoleState(), account.orgsByAccount()]).pipe(
          Effect.map(([state, groups]) => ({
            consoleManagedProviders: state.consoleManagedProviders,
            ...(state.activeOrgName ? { activeOrgName: state.activeOrgName } : {}),
            switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
          })),
          Effect.orDie,
        ),
      listOrgs: () =>
        Effect.all([account.orgsByAccount(), account.active()]).pipe(
          Effect.map(([groups, active]) => {
            const current = Option.getOrUndefined(active)
            return groups.flatMap((group) =>
              group.orgs.map((org) => ({
                accountID: group.account.id,
                accountEmail: group.account.email,
                accountUrl: group.account.url,
                orgID: org.id,
                orgName: org.name,
                active: !!current && current.id === group.account.id && current.active_org_id === org.id,
              })),
            )
          }),
          Effect.orDie,
        ),
      switchOrg: (input) =>
        Effect.gen(function* () {
          yield* account.use(AccountID.make(input.accountID), Option.some(OrgID.make(input.orgID)))
          return true
        }).pipe(Effect.orDie),
    })
  }),
)

export * as NativeConsole from "./native-console"
