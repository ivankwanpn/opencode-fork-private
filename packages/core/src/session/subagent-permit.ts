export * as SubagentPermit from "./subagent-permit"

import { Context, Effect, Layer, Ref, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"

export class SubagentLimitReached extends Schema.TaggedErrorClass<SubagentLimitReached>()(
  "Subagent.SubagentLimitReached",
  { limit: Schema.Number },
) {}

export type Reservation = {
  readonly kind: "new" | "existing"
  readonly key: string
}

export interface Interface {
  readonly acquire: (key: string) => Effect.Effect<Reservation, SubagentLimitReached>
  readonly release: (key: string) => Effect.Effect<void>
  readonly active: Effect.Effect<ReadonlySet<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubagentPermit") {}

export const make = (options: { readonly limit: number | undefined }) =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<Set<string>>(new Set())
    const acquire = Effect.fn("SubagentPermit.acquire")((key: string) =>
      Ref.modify(ref, (active): readonly [Reservation | SubagentLimitReached, Set<string>] => {
        if (active.has(key)) return [{ kind: "existing" as const, key }, active]
        if (options.limit !== undefined && active.size >= options.limit)
          return [new SubagentLimitReached({ limit: options.limit }), active]
        const next = new Set(active)
        next.add(key)
        return [{ kind: "new" as const, key }, next]
      }).pipe(
        Effect.flatMap((result) =>
          result instanceof SubagentLimitReached ? Effect.fail(result) : Effect.succeed(result),
        ),
      ),
    )
    const release = Effect.fn("SubagentPermit.release")((key: string) =>
      Ref.update(ref, (active) => {
        const next = new Set(active)
        next.delete(key)
        return next
      }),
    )
    const active = Ref.get(ref)
    return Service.of({ acquire, release, active })
  })

export const layer = (limit: number | undefined) => Layer.effect(Service, make({ limit }))

export const node = makeGlobalNode({ service: Service, layer: layer(undefined), deps: [] })
