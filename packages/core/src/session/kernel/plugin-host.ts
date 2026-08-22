export * as KernelPluginHost from "./plugin-host"

import { Cause, Context, Duration, Effect, Exit, Layer, Option, Ref, Scope } from "effect"
import { Plugin } from "@opencode-ai/schema/plugin"
import { makeLocationNode } from "../../effect/app-node"
import { Location } from "../../location"
import { PluginRuntime } from "../../plugin/runtime"
import { Tool } from "../../tool/tool"
import { ToolRegistry } from "../../tool/registry"
import { Tools } from "../../tool/tools"

// ---------------------------------------------------------------------------
// Kernel seams
//
// The spec seams are the only plugin-visible extension points of kernel
// execution. Handlers are registered through an activation and are
// generation-fenced. Runs dispatch by seam kind:
//   transform - immutable frozen input, frozen output
//   observe   - isolated transient observation; handler failures are logged
//   decide    - deny-monotonic policy merge (may only narrow, never widen)
//   around    - at-most-once `next`, typed short circuit
//   advice    - read-only advisory; failures are ignored
// ---------------------------------------------------------------------------

export const SeamName = {
  requestTransform: "execution.request.transform",
  responseObserve: "execution.response.observe",
  turnObserve: "execution.turn.observe",
  toolExposureTransform: "tool.exposure.transform",
  toolPrepareDecide: "tool.prepare.decide",
  toolDispatchAround: "tool.dispatch.around",
  toolFinalizeTransform: "tool.finalize.transform",
  compactionPolicyDecide: "compaction.policy.decide",
  compactionSummaryTransform: "compaction.summary.transform",
  recoveryAdvice: "recovery.advice",
  statusObserve: "status.observe",
} as const
export type SeamName = (typeof SeamName)[keyof typeof SeamName]

export const SeamKind = {
  [SeamName.requestTransform]: "transform",
  [SeamName.toolExposureTransform]: "transform",
  [SeamName.toolFinalizeTransform]: "transform",
  [SeamName.compactionSummaryTransform]: "transform",
  [SeamName.responseObserve]: "observe",
  [SeamName.turnObserve]: "observe",
  [SeamName.statusObserve]: "observe",
  [SeamName.toolPrepareDecide]: "decide",
  [SeamName.compactionPolicyDecide]: "decide",
  [SeamName.toolDispatchAround]: "around",
  [SeamName.recoveryAdvice]: "advice",
} as const satisfies Record<SeamName, "transform" | "observe" | "decide" | "around" | "advice">
export type SeamKind = (typeof SeamKind)[keyof typeof SeamKind]

/** The manifest permission required to register a handler on each seam. */
export const SeamPermission = {
  [SeamName.requestTransform]: "session.context.transform",
  [SeamName.responseObserve]: "session.history.read",
  [SeamName.turnObserve]: "session.history.read",
  [SeamName.toolExposureTransform]: "tool.exposure.transform",
  [SeamName.toolPrepareDecide]: "tool.policy",
  [SeamName.toolDispatchAround]: "tool.execute.wrap",
  [SeamName.toolFinalizeTransform]: "tool.exposure.transform",
  [SeamName.compactionPolicyDecide]: "session.context.transform",
  [SeamName.compactionSummaryTransform]: "session.context.transform",
  [SeamName.recoveryAdvice]: "session.history.read",
  [SeamName.statusObserve]: "session.history.read",
} as const satisfies Record<SeamName, Plugin.Permission>

export class NextCalledError extends Error {
  readonly _tag = "NextCalledError"
  constructor(readonly pluginID: string = "plugin") {
    super(`around seam next called more than once by ${pluginID}`)
  }
}

export type SeamHandler<Event = unknown, Result = unknown> = (
  event: Event,
  next?: () => Effect.Effect<Result, NextCalledError>,
) => Effect.Effect<Result | void, NextCalledError> | void

type SeamEntry = {
  readonly name: SeamName
  readonly owner: PluginRuntime.Owner
  readonly generation: number
  readonly fence: Effect.Effect<boolean>
  readonly handler: SeamHandler
}

export interface Seams {
  readonly register: (input: {
    readonly name: SeamName
    readonly generation: number
    readonly owner: PluginRuntime.Owner
    readonly fence: Effect.Effect<boolean>
    readonly handler: SeamHandler
  }) => Effect.Effect<Effect.Effect<void>>
  readonly run: (name: SeamName, event: unknown) => Effect.Effect<unknown>
  /** Number of live (fence-passing) registrations for a seam. */
  readonly active: (name: SeamName) => Effect.Effect<number>
}

function freeze<A>(value: A): A {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  return Object.freeze(value)
}

/** Deny is monotonic: a decision may only narrow, never widen. */
export function denyMonotonic(current: Record<string, unknown>, proposed: Record<string, unknown>) {
  const merged = { ...proposed }
  if (
    "concurrency" in current &&
    "concurrency" in proposed &&
    (current.concurrency === "exclusive" || proposed.concurrency === "exclusive")
  )
    merged.concurrency = "exclusive"
  if (
    "permitted" in current &&
    "permitted" in proposed &&
    (current.permitted === false || proposed.permitted === false)
  )
    merged.permitted = false
  return merged
}

export function makeSeams(): Seams {
  const registrations = new Map<SeamName, readonly SeamEntry[]>()

  return {
    register: Effect.fn("KernelSeam.register")(function* (input) {
      const entry: SeamEntry = {
        name: input.name,
        owner: input.owner,
        generation: input.generation,
        fence: input.fence,
        handler: input.handler,
      }
      const dispose = Effect.sync(() => {
        const current = registrations.get(input.name) ?? []
        const next = current.filter((item) => item !== entry)
        if (next.length > 0) registrations.set(input.name, next)
        else registrations.delete(input.name)
      })
      registrations.set(input.name, [...(registrations.get(input.name) ?? []), entry])
      return dispose
    }),
    run: Effect.fn("KernelSeam.run")(function* (
      name: SeamName,
      event: unknown,
    ): Effect.fn.Return<unknown> {
      // Evaluate every fence: an Effect object is always truthy, so a stale
      // registration filtered before evaluation would run after disable.
      const snapshot: SeamEntry[] = []
      for (const entry of registrations.get(name) ?? []) {
        if (yield* entry.fence) snapshot.push(entry)
      }
      // Handler failures surface as defects: a transform that mutates its
      // frozen input or throws rejects the seam run instead of silently
      // forwarding a corrupt value.
      const invoke = (entry: SeamEntry, value: unknown): Effect.Effect<unknown> =>
        Effect.suspend(() => {
          const result = entry.handler(value)
          return Effect.isEffect(result) ? result : Effect.succeed(result)
        }).pipe(Effect.catchCause((cause) => Effect.die(cause)))
      switch (SeamKind[name]) {
        case "transform": {
          let current = freeze(event)
          for (const entry of snapshot) current = freeze(yield* invoke(entry, current))
          return current
        }
        case "observe": {
          for (const entry of snapshot) {
            yield* invoke(entry, event).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Plugin seam observation failed", { seam: name, cause: Cause.pretty(cause) }),
              ),
            )
          }
          return event
        }
        case "decide": {
          let current = freeze(event) as Record<string, unknown>
          for (const entry of snapshot) {
            const proposed = (yield* invoke(entry, current)) as Record<string, unknown> | undefined
            if (proposed !== undefined) current = freeze(denyMonotonic(current, proposed))
          }
          return current
        }
        case "around": {
          // Compose outermost-first; each handler's `next` calls the next
          // inner handler and may be invoked at most once per handler.
          let composed: () => Effect.Effect<unknown, NextCalledError> = () => Effect.succeed(undefined)
          for (const entry of [...snapshot].reverse()) {
            const inner = composed
            composed = () => {
              let called = false
              const next = (): Effect.Effect<unknown, NextCalledError> => {
                if (called) return Effect.fail(new NextCalledError(entry.owner.id))
                called = true
                return inner()
              }
              const result = entry.handler(event, next)
              return (Effect.isEffect(result) ? result : Effect.succeed(result)) as Effect.Effect<
                unknown,
                NextCalledError
              >
            }
          }
          yield* composed().pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Plugin around seam failed", { seam: name, cause: Cause.pretty(cause) }),
            ),
          )
          return event
        }
        case "advice": {
          let current = freeze(event)
          for (const entry of snapshot) {
            yield* invoke(entry, current).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Plugin recovery advice failed", { seam: name, cause: Cause.pretty(cause) }),
              ),
            )
          }
          return current
        }
      }
    }),
    active: Effect.fn("KernelSeam.active")(function* (name) {
      let count = 0
      for (const entry of registrations.get(name) ?? []) if (yield* entry.fence) count += 1
      return count
    }),
  }
}

// ---------------------------------------------------------------------------
// Service registry
// ---------------------------------------------------------------------------

export interface ServiceRegistry {
  /** Provide a service; waiting dependents activate when all requirements are met. */
  readonly provide: (id: string, value: unknown) => Effect.Effect<void>
  /** Withdraw a service; dependents with unmet requirements are disposed and re-wait. */
  readonly retract: (id: string) => Effect.Effect<void>
  readonly has: (id: string) => Effect.Effect<boolean>
  readonly get: (id: string) => Effect.Effect<Option.Option<unknown>>
  readonly list: () => Effect.Effect<ReadonlyArray<string>>
}

// ---------------------------------------------------------------------------
// Contribution model
// ---------------------------------------------------------------------------

export interface ContributionDecl {
  readonly id: string
  readonly description?: string
}

export interface SeamContribution {
  readonly name: SeamName
  readonly handler: SeamHandler
}

export interface HookContribution {
  readonly name: PluginRuntime.HookName
  readonly callback: (event: unknown) => Effect.Effect<void> | void
}

export interface ServiceContribution {
  readonly id: string
  /** The value provided to dependents. Produced by the mount. */
  readonly value: unknown
}

export interface PluginContribution {
  readonly services?: ReadonlyArray<ServiceContribution>
  readonly tools?: Readonly<Record<string, Tool.AnyTool>>
  readonly hooks?: ReadonlyArray<HookContribution>
  readonly seams?: ReadonlyArray<SeamContribution>
  readonly commands?: ReadonlyArray<ContributionDecl>
  readonly skills?: ReadonlyArray<ContributionDecl>
  readonly agents?: ReadonlyArray<ContributionDecl>
  readonly mcp?: ReadonlyArray<ContributionDecl>
  readonly lsp?: ReadonlyArray<ContributionDecl>
  readonly ui?: ReadonlyArray<{ readonly id: string; readonly kind: "command" | "panel"; readonly description?: string }>
}

/** Late registration surface. Every handle is generation-fenced: after the
 * activation is disabled or disposed, handles reject with a fenced error. */
export interface RegisterSurface {
  readonly tool: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<Effect.Effect<void>, Plugin.ActivationError, Scope.Scope>
  readonly hook: (
    name: PluginRuntime.HookName,
    callback: (event: unknown) => Effect.Effect<void> | void,
  ) => Effect.Effect<Effect.Effect<void>, Plugin.ActivationError, Scope.Scope>
  readonly seam: (
    name: SeamName,
    handler: SeamHandler,
  ) => Effect.Effect<Effect.Effect<void>, Plugin.ActivationError, Scope.Scope>
}

export interface PluginContext {
  readonly manifest: Plugin.Manifest
  readonly location: Location.Ref
  readonly services: ServiceRegistry
  readonly register: RegisterSurface
}

export interface PluginModule {
  readonly manifest: Plugin.Manifest
  readonly mount: (context: PluginContext) => Effect.Effect<PluginContribution, Plugin.ActivationError, Scope.Scope>
}

export interface OwnedContribution {
  readonly kind: Plugin.Capability | "service"
  readonly id: string
}

export interface Activation {
  readonly id: Plugin.ID
  readonly version: string
  readonly generation: number
  readonly state: Effect.Effect<Plugin.ActivationState>
  readonly dispose: Effect.Effect<void>
}

export interface Options {
  readonly mountDeadline?: Duration.Input
  readonly disposeDeadline?: Duration.Input
}

export interface Interface {
  readonly install: (module: PluginModule, options?: { readonly group?: string }) => Effect.Effect<Activation>
  /** Detach every owned contribution; the activation stays listed as disabled. */
  readonly disable: (id: Plugin.ID) => Effect.Effect<void>
  /** Disable and forget the activation entirely. */
  readonly dispose: (id: Plugin.ID) => Effect.Effect<void>
  readonly has: (id: Plugin.ID) => Effect.Effect<boolean>
  readonly snapshot: () => Effect.Effect<ReadonlyArray<Plugin.ActivationInfo>>
  readonly ownedContributions: (generation: number) => Effect.Effect<ReadonlyArray<OwnedContribution>>
  readonly services: ServiceRegistry
  readonly seams: Seams
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/KernelPluginHost") {}

type ActivationRecord = {
  readonly id: string
  readonly module: PluginModule
  readonly generation: number
  readonly group?: string
  readonly fence: Ref.Ref<number>
  readonly state: Ref.Ref<Plugin.ActivationState>
  readonly scope: Ref.Ref<Option.Option<Scope.Scope>>
  readonly seamDisposers: Effect.Effect<void>[]
}

const defaultMountDeadline = Duration.seconds(8)
const defaultDisposeDeadline = Duration.seconds(5)

export const make = Effect.fn("KernelPluginHost.make")(function* (options?: Options) {
  const mountDeadline = options?.mountDeadline ?? defaultMountDeadline
  const disposeDeadline = options?.disposeDeadline ?? defaultDisposeDeadline
  const tools = yield* Tools.Service
  const runtime = yield* PluginRuntime.Service
  const location = yield* Location.Service
  const locationRef = Location.Ref.make({ directory: location.directory })

  const sourceScope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(sourceScope, Exit.void))

  const serviceValues = new Map<string, unknown>()
  const ownedServices = new Map<string, ReadonlyArray<string>>()
  const waiters = new Map<string, Set<ActivationRecord>>()
  const records = new Map<string, ActivationRecord>()
  const ownedByGeneration = new Map<number, OwnedContribution[]>()
  const disposing = new Set<string>()
  const seams = makeSeams()
  let nextGeneration = 0

  const clearOwned = (generation: number) => {
    ownedByGeneration.delete(generation)
  }

  const unregisterWaiters = (record: ActivationRecord) => {
    for (const set of waiters.values()) set.delete(record)
  }

  const requirementsSatisfied = (record: ActivationRecord) =>
    record.module.manifest.requires.every((requirement) => requirement.optional || serviceValues.has(requirement.id))

  const recordOwned = (record: ActivationRecord, kind: Plugin.Capability | "service", id: string) => {
    const owned = ownedByGeneration.get(record.generation) ?? []
    if (!owned.some((item) => item.kind === kind && item.id === id)) owned.push({ kind, id })
    ownedByGeneration.set(record.generation, owned)
  }

  const publish = Effect.fn("KernelPluginHost.publish")(function* (id: string): Effect.fn.Return<void> {
    const pending = waiters.get(id)
    if (!pending) return
    waiters.delete(id)
    for (const record of pending) yield* activate(record)
  })

  const retractService = Effect.fn("KernelPluginHost.retractService")(
    function* (id: string): Effect.fn.Return<void> {
      serviceValues.delete(id)
      for (const record of records.values()) {
        if (disposing.has(record.id)) continue
        if (!record.module.manifest.requires.some((requirement) => !requirement.optional && requirement.id === id))
          continue
        if (requirementsSatisfied(record)) continue
        const state = yield* Ref.get(record.state)
        if (state === "ready" || state === "activating") {
          yield* disposeRecord(record)
        }
        unregisterWaiters(record)
        yield* Ref.set(record.state, "waiting_dependency")
        const set = waiters.get(id) ?? new Set()
        set.add(record)
        waiters.set(id, set)
      }
    },
  )

  const disposeRecord = Effect.fn("KernelPluginHost.disposeRecord")(
    function* (record: ActivationRecord): Effect.fn.Return<void> {
    if (disposing.has(record.id)) return
    disposing.add(record.id)
    yield* Ref.set(record.fence, -1)
    yield* Ref.set(record.state, "disposing")
    yield* Effect.forEach(record.seamDisposers, (disposal) => disposal, { discard: true })
    for (const serviceID of ownedServices.get(record.id) ?? []) {
      yield* retractService(serviceID).pipe(Effect.ignore)
    }
    const child = yield* Ref.get(record.scope)
    if (Option.isSome(child)) {
      yield* Scope.close(child.value, Exit.void).pipe(
        Effect.timeoutOption(disposeDeadline),
        Effect.tap((option) => {
          if (Option.isNone(option)) {
            return Effect.logWarning("Plugin disposal reclamation deadline exceeded", {
              id: record.id,
              deadlineMilliseconds: Duration.toMillis(disposeDeadline),
            })
          }
          return Effect.void
        }),
      )
    }
    yield* Ref.set(record.scope, Option.none())
    yield* Ref.set(record.fence, -1)
    clearOwned(record.generation)
    disposing.delete(record.id)
  })

  const gatePermission = Effect.fn("KernelPluginHost.gatePermission")(function* (
    record: ActivationRecord,
    permission: Plugin.Permission,
  ) {
    if (!record.module.manifest.permissions.includes(permission))
      return yield* Effect.fail({ type: "permission" as const, permission })
    return
  })

  const checkFence = Effect.fn("KernelPluginHost.checkFence")(function* (record: ActivationRecord) {
    const fence = yield* Ref.get(record.fence)
    if (fence !== record.generation)
      return yield* Effect.fail({ type: "fenced" as const, generation: record.generation })
    return
  })

  const gateCapability = Effect.fn("KernelPluginHost.gateCapability")(function* (
    record: ActivationRecord,
    capability: Plugin.Capability,
  ) {
    if (!record.module.manifest.capabilities.includes(capability))
      return yield* Effect.fail({ type: "mount" as const, message: `missing capability: ${capability}` })
    return
  })

  const registerTools = Effect.fn("KernelPluginHost.registerTools")(function* (
    record: ActivationRecord,
    contributed: Readonly<Record<string, Tool.AnyTool>>,
  ) {
    yield* tools.contribute({
      source: { type: "plugin", id: record.id },
      state: "ready",
      tools: contributed,
    })
    for (const id of Object.keys(contributed)) recordOwned(record, "tool", id)
  })

  const registerHook = Effect.fn("KernelPluginHost.registerHook")(function* (
    record: ActivationRecord,
    hook: HookContribution,
  ) {
    yield* runtime.hook(hook.name, hook.callback as (event: never) => Effect.Effect<void> | void)
    recordOwned(record, "hook", hook.name)
  })

  const registerSeam = Effect.fn("KernelPluginHost.registerSeam")(function* (
    record: ActivationRecord,
    seam: SeamContribution,
  ) {
    yield* gatePermission(record, SeamPermission[seam.name])
    const dispose = yield* seams.register({
      name: seam.name,
      generation: record.generation,
      owner: { id: record.id, order: record.generation },
      fence: Ref.get(record.fence).pipe(Effect.map((value) => value === record.generation)),
      handler: seam.handler,
    })
    recordOwned(record, "hook", seam.name)
    return dispose
  })

  const registerContext = (record: ActivationRecord): RegisterSurface => ({
    tool: (contributed) =>
      Effect.gen(function* () {
        yield* gatePermission(record, "tool.register")
        yield* checkFence(record)
        yield* registerTools(record, contributed).pipe(
          Effect.mapError((error) => ({ type: "mount" as const, message: error.message })),
        )
        return Effect.void
      }),
    hook: (name, callback) =>
      Effect.gen(function* () {
        yield* gateCapability(record, "hook")
        yield* checkFence(record)
        yield* registerHook(record, { name, callback })
        return Effect.void
      }),
    seam: (name, handler) =>
      Effect.gen(function* () {
        yield* gateCapability(record, "hook")
        yield* checkFence(record)
        return yield* registerSeam(record, { name, handler })
      }),
  })

  const moduleMount = Effect.fn("KernelPluginHost.moduleMount")(
    function* (record: ActivationRecord, child: Scope.Scope): Effect.fn.Return<void, unknown, Scope.Scope> {
      const context: PluginContext = {
        manifest: record.module.manifest,
        location: locationRef,
        services,
        register: registerContext(record),
      }
      const contribution = yield* record.module.mount(context)
      for (const service of contribution.services ?? []) {
        yield* gateCapability(record, "service")
        serviceValues.set(service.id, service.value)
        const owned = ownedServices.get(record.id) ?? []
        if (!owned.includes(service.id)) ownedServices.set(record.id, [...owned, service.id])
        recordOwned(record, "service", service.id)
        yield* publish(service.id).pipe(Effect.ignore)
      }
      if (contribution.tools) {
        yield* gatePermission(record, "tool.register")
        yield* gateCapability(record, "tool")
        yield* registerTools(record, contribution.tools).pipe(Scope.provide(child))
      }
      for (const hook of contribution.hooks ?? []) {
        yield* gateCapability(record, "hook")
        yield* registerHook(record, hook).pipe(Scope.provide(child))
      }
      for (const seam of contribution.seams ?? []) {
        yield* gateCapability(record, "hook")
        const dispose = yield* registerSeam(record, seam)
        record.seamDisposers.push(dispose)
      }
      for (const [decls, capability] of [
        [contribution.commands ?? [], "command"],
        [contribution.skills ?? [], "skill"],
        [contribution.agents ?? [], "agent"],
        [contribution.mcp ?? [], "mcp"],
        [contribution.lsp ?? [], "lsp"],
        [contribution.ui ?? [], "ui"],
      ] as const) {
        if (decls.length === 0) continue
        yield* gateCapability(record, capability)
        for (const decl of decls) recordOwned(record, capability, decl.id)
      }
      return
    },
  )

  const activate = Effect.fn("KernelPluginHost.activate")(
    function* (record: ActivationRecord): Effect.fn.Return<void> {
    unregisterWaiters(record)
    if (!requirementsSatisfied(record)) {
      yield* Ref.set(record.state, "waiting_dependency")
      for (const requirement of record.module.manifest.requires) {
        if (requirement.optional || serviceValues.has(requirement.id)) continue
        const set = waiters.get(requirement.id) ?? new Set()
        set.add(record)
        waiters.set(requirement.id, set)
      }
      return
    }
    yield* Ref.set(record.state, "activating")
    const child = yield* Scope.fork(sourceScope)
    yield* Ref.set(record.scope, Option.some(child))
    yield* Ref.set(record.fence, record.generation)
    const mounted = yield* moduleMount(record, child)
      .pipe(Scope.provide(child))
      .pipe(Effect.timeoutOption(mountDeadline))
      .pipe(
        Effect.match({
          onFailure: (error) => ({ error }),
          onSuccess: (option) =>
            Option.isSome(option)
              ? { value: option.value }
              : {
                  error: {
                    type: "deadline" as const,
                    operation: "mount" as const,
                    durationMilliseconds: Duration.toMillis(mountDeadline),
                  },
                },
        }),
      )
    if ("error" in mounted) {
      yield* Effect.logWarning("KernelPluginHost activate failed", { error: mounted.error })
      yield* Ref.set(record.state, "failed")
      yield* Scope.close(child, Exit.void).pipe(Effect.ignore)
      return
    }
    yield* Ref.set(record.state, "ready")
  })

  const services: ServiceRegistry = {
    provide: Effect.fn("KernelPluginHost.services.provide")(
      function* (id: string, value: unknown): Effect.fn.Return<void> {
        serviceValues.set(id, value)
        yield* publish(id)
      },
    ),
    retract: Effect.fn("KernelPluginHost.services.retract")(function* (id: string): Effect.fn.Return<void> {
      yield* retractService(id)
    }),
    has: (id) => Effect.sync(() => serviceValues.has(id)),
    get: (id) =>
      Effect.sync(() => {
        const value = serviceValues.get(id)
        return value === undefined ? Option.none() : Option.some(value)
      }),
    list: () => Effect.sync(() => Array.from(serviceValues.keys())),
  }

  const disposeOne = Effect.fn("KernelPluginHost.disposeOne")(
    function* (id: string): Effect.fn.Return<void> {
      const record = records.get(id)
      if (!record) return
      yield* disposeRecord(record)
      yield* Ref.set(record.state, "disabled")
    },
  )

  const install = Effect.fn("KernelPluginHost.install")(
    function* (
      module: PluginModule,
      options?: { readonly group?: string },
    ): Effect.fn.Return<Activation> {
      const record: ActivationRecord = {
        id: module.manifest.id as string,
        module,
        generation: ++nextGeneration,
        ...(options?.group === undefined ? {} : { group: options.group }),
        fence: yield* Ref.make(0),
        state: yield* Ref.make<Plugin.ActivationState>("resolving"),
        scope: yield* Ref.make(Option.none<Scope.Scope>()),
        seamDisposers: [],
      }
      records.set(record.id, record)
      yield* activate(record)
      return {
        id: record.id as Plugin.ID,
        version: module.manifest.version,
        generation: record.generation,
        state: Ref.get(record.state),
        dispose: disposeOne(record.id),
      }
    },
  )

  const disable = Effect.fn("KernelPluginHost.disable")(function* (id: string): Effect.fn.Return<void> {
    yield* disposeOne(id)
  })

  return Service.of({
    install,
    disable,
    dispose: disposeOne,
    has: (id) => Effect.sync(() => records.has(id)),
    snapshot: () =>
      Effect.gen(function* () {
        const result: Plugin.ActivationInfo[] = []
        for (const record of records.values()) {
          result.push({
            id: record.id as Plugin.ID,
            version: record.module.manifest.version,
            generation: record.generation,
            state: yield* Ref.get(record.state),
            runtime: record.module.manifest.runtime,
            ...(record.group === undefined ? {} : { group: record.group }),
          })
        }
        return result.toSorted((left, right) => left.generation - right.generation)
      }),
    ownedContributions: (generation) => Effect.sync(() => ownedByGeneration.get(generation) ?? []),
    services,
    seams,
  })
})

const layer = Layer.effect(Service, make())

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, PluginRuntime.node, ToolRegistry.toolsNode],
})
